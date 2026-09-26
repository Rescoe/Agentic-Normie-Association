/**
 * creativeFingerprint.ts — a compact structured record per published work
 * (theme, form, structure, palette, movement, interaction, emotion,
 * references, what to avoid, critique, lesson), plus free/deterministic
 * similarity checks against it before a new work is briefed or published.
 *
 * This is deliberately NOT a duplicate of the existing "past works" text
 * blocks already injected into propose-work/briefing/curation prompts
 * (proposeWork.ts, work-lifecycle's stepBriefing/stepValidating) — those
 * give the LLM a reading list; this gives CODE something it can measure
 * (Jaccard similarity over structured fields) without another LLM call, so a
 * near-duplicate can be caught even if the model doesn't self-police it.
 *
 * Extraction of theme/form/etc from a finished work is itself a small LLM
 * call (see extractFingerprintFields) — kept separate from the main
 * creation/curation calls so a fingerprint failure never blocks publishing.
 */
import { query, USE_NEON } from "./db";
import { jaccardSimilarity } from "./topicEngine";
import { groqFetch, extractJsonObject, extractContentOrReasoning, type GroqChatResponse } from "./groq";
import { recordLlmCall } from "./llmLedger";

export interface CreativeFingerprint {
  workId:       string;
  theme:        string;
  form:         string;
  structure:    string;
  palette:      string;
  movementType: string;
  interaction:  string;
  emotion:      string;
  refs:         string[];
  avoid:        string[];
  critique:     string;
  lesson:       string;
  keywords:     string[];
  createdAt:    number;
}

const localFingerprints = new Map<string, CreativeFingerprint>();

function fingerprintText(fp: Pick<CreativeFingerprint, "theme" | "structure" | "palette" | "movementType" | "interaction" | "emotion" | "keywords">): string {
  return [fp.theme, fp.structure, fp.palette, fp.movementType, fp.interaction, fp.emotion, ...fp.keywords].filter(Boolean).join(" ");
}

export async function saveFingerprint(fp: CreativeFingerprint): Promise<void> {
  if (USE_NEON) {
    await query(
      `INSERT INTO creative_fingerprints (work_id, theme, form, structure, palette, movement_type, interaction, emotion, refs, avoid, critique, lesson, keywords, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (work_id) DO UPDATE SET
         theme=$2, form=$3, structure=$4, palette=$5, movement_type=$6, interaction=$7, emotion=$8,
         refs=$9, avoid=$10, critique=$11, lesson=$12, keywords=$13`,
      [fp.workId, fp.theme, fp.form, fp.structure, fp.palette, fp.movementType, fp.interaction, fp.emotion,
       JSON.stringify(fp.refs), JSON.stringify(fp.avoid), fp.critique, fp.lesson, JSON.stringify(fp.keywords), fp.createdAt],
    );
  } else {
    localFingerprints.set(fp.workId, fp);
  }
}

export async function listFingerprints(excludeWorkId?: string): Promise<CreativeFingerprint[]> {
  if (USE_NEON) {
    const rows = await query<{
      work_id: string; theme: string; form: string; structure: string; palette: string;
      movement_type: string; interaction: string; emotion: string; refs: unknown; avoid: unknown;
      critique: string; lesson: string; keywords: unknown; created_at: number;
    }>("SELECT * FROM creative_fingerprints ORDER BY created_at DESC LIMIT 100");
    return rows
      .filter(r => r.work_id !== excludeWorkId)
      .map(r => ({
        workId: r.work_id, theme: r.theme ?? "", form: r.form ?? "", structure: r.structure ?? "",
        palette: r.palette ?? "", movementType: r.movement_type ?? "", interaction: r.interaction ?? "",
        emotion: r.emotion ?? "", refs: Array.isArray(r.refs) ? r.refs as string[] : [],
        avoid: Array.isArray(r.avoid) ? r.avoid as string[] : [], critique: r.critique ?? "", lesson: r.lesson ?? "",
        keywords: Array.isArray(r.keywords) ? r.keywords as string[] : [], createdAt: Number(r.created_at),
      }));
  }
  return [...localFingerprints.values()].filter(f => f.workId !== excludeWorkId);
}

export interface SimilarityResult {
  mostSimilarWorkId: string | null;
  score:             number; // 0..1
}

/** Compares a candidate's structured text against every stored fingerprint (word-Jaccard, no embeddings). */
export async function findMostSimilarFingerprint(
  candidate: Pick<CreativeFingerprint, "theme" | "structure" | "palette" | "movementType" | "interaction" | "emotion" | "keywords">,
  excludeWorkId?: string,
): Promise<SimilarityResult> {
  const existing = await listFingerprints(excludeWorkId);
  if (existing.length === 0) return { mostSimilarWorkId: null, score: 0 };
  const candidateText = fingerprintText(candidate);
  let best = { mostSimilarWorkId: null as string | null, score: 0 };
  for (const fp of existing) {
    const score = jaccardSimilarity(candidateText, fingerprintText(fp));
    if (score > best.score) best = { mostSimilarWorkId: fp.workId, score };
  }
  return best;
}

// Above this Jaccard score, a new work is considered too close to an existing
// one on structural grounds alone — used as an extra signal alongside (not
// instead of) the curator's own "tooSimilarToExisting" LLM judgment.
export const FINGERPRINT_SIMILARITY_THRESHOLD = 0.55;

/**
 * Extracts a compact fingerprint from a published work's brief+artwork via
 * one small Groq call. Never throws — a failure here must not block
 * publishing; callers get null and simply skip saving a fingerprint for that
 * work (it just won't be checked against later, which is a lesser harm than
 * blocking or crashing the pipeline over a non-essential feature).
 */
export async function extractFingerprintFields(params: {
  title: string; brief: string; artworkExcerpt: string; artForm?: string;
}): Promise<Omit<CreativeFingerprint, "workId" | "createdAt"> | null> {
  try {
    const res = await groqFetch({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: "You extract compact structured metadata from a finished artwork for ANA's internal deduplication registry. Respond with strict JSON only." },
        {
          role: "user",
          content: `Title: ${params.title}\nForm: ${params.artForm ?? "text"}\nBrief: ${params.brief.slice(0, 500)}\nExcerpt: ${params.artworkExcerpt.slice(0, 400)}\n\n` +
            `Respond with ONLY this JSON object:\n{"theme":"","structure":"","palette":"","movementType":"","interaction":"","emotion":"","refs":[],"keywords":[]}`,
        },
      ],
      max_tokens: 300, temperature: 0.3,
    });
    const success = res.ok;
    await recordLlmCall({ provider: "groq", model: "openai/gpt-oss-120b", task: "fingerprint", success });
    if (!success) return null;
    const data = await res.json() as GroqChatResponse;
    const parsed = extractJsonObject(extractContentOrReasoning(data)) as Record<string, unknown>;
    return {
      theme:        String(parsed.theme ?? ""),
      form:         params.artForm ?? "text",
      structure:    String(parsed.structure ?? ""),
      palette:      String(parsed.palette ?? ""),
      movementType: String(parsed.movementType ?? ""),
      interaction:  String(parsed.interaction ?? ""),
      emotion:      String(parsed.emotion ?? ""),
      refs:         Array.isArray(parsed.refs) ? parsed.refs.map(String) : [],
      avoid:        [],
      critique:     "",
      lesson:       "",
      keywords:     Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
    };
  } catch (e) {
    console.error("[creativeFingerprint] extraction failed (non-fatal):", e);
    await recordLlmCall({ provider: "groq", model: "openai/gpt-oss-120b", task: "fingerprint", success: false });
    return null;
  }
}
