import { extractContentOrReasoning, extractJsonObject, groqFetch, type GroqChatResponse } from "@/lib/groq";
import { oneMinAiStructured } from "@/lib/oneMinAi";
import {
  hashArtworkSource,
  validateSceneV1,
  type AnaSceneV1,
  type SceneValidationResult,
} from "@/lib/anaSceneV1";

const FALLBACK_MODEL = "openai/gpt-oss-120b";

export interface SceneAuthoringInput {
  workId: string;
  title: string;
  artForm: string;
  proposal?: string;
  brief?: string;
  artworkText: string;
}

export interface SceneCompanionResult {
  ok: boolean;
  scene?: AnaSceneV1;
  sceneHash?: string;
  sourceHash: string;
  correspondence?: string;
  provider?: "1minai" | "groq";
  error?: string;
}

function seedForSourceHash(sourceHash: string): number {
  const parsed = Number.parseInt(sourceHash.slice("sha256:".length, "sha256:".length + 8), 16) >>> 0;
  return parsed === 0 ? 0x6d2b79f5 : parsed;
}

function scenePrompt(input: SceneAuthoringInput, seed: number): string {
  return `Create the bounded ANA scene-v1 companion for this existing generative artwork.

TITLE: ${input.title}
FORM: ${input.artForm}
PROPOSAL: ${input.proposal ?? "—"}
BRIEF: ${input.brief ?? "—"}

The companion must be an honest, recognizable interpretation of the same composition and motion,
not a generic replacement. It will run locally on small OLED/TFT screens. The original HTML remains
the canonical web artwork and is included below only as artistic reference.

Return exactly one JSON object with keys "correspondence" and "scene". The correspondence is one
plain sentence explaining how the scene maps to the HTML. The scene must use this exact closed schema:
{
  "schema":"ana-scene-v1",
  "rendererVersion":1,
  "seed":${seed},
  "tickRate":5,
  "durationTicks":1..50,
  "loopCount":1..3,
  "backgroundIndex":0..palette.length-1,
  "palette":[1..8 RGB565 integers, each 0..65535],
  "clear":"solid",
  "entities":[1..24 entities]
}

Each entity has exactly: {"id":0..23,"primitive":...,"colorIndex":...,"geometry":...,"motion":...}.
Entity ids must be unique. Array order is paint/z order.

Geometry, with normalized integer coordinates 0..65535:
- point: {"type":"point","x":u16,"y":u16,"size":1..4}
- line: {"type":"line","x1":u16,"y1":u16,"x2":u16,"y2":u16,"width":1..4}
- rect: {"type":"rect","x0":u16,"y0":u16,"x1":u16,"y1":u16,"fill":boolean}
- circle: {"type":"circle","cx":u16,"cy":u16,"r":1..32767,"fill":boolean}
- polyline: {"type":"polyline","points":[2..16 {"x":u16,"y":u16}],"closed":boolean,"width":1..4}

Motion, exactly one per entity:
- {"type":"static"}
- {"type":"linear","dx":i16,"dy":i16,"edge":"wrap"}
- {"type":"oscillate-x","amplitude":0..32767,"period":2..durationTicks,"phase":0..period-1}
- {"type":"oscillate-y","amplitude":0..32767,"period":2..durationTicks,"phase":0..period-1}
- {"type":"orbit","radiusX":0..32767,"radiusY":0..32767,"period":2..durationTicks,"phase":0..period-1}

All values must be JSON integers: no floats, strings containing numbers, extra keys, text, code, URLs,
or comments. Oscillation/orbit geometry plus amplitude/radius must remain fully inside 0..65535.
Prefer 6..16 clear entities over filling the maximum. Use the exact seed ${seed}.

CANONICAL HTML ARTWORK:
${input.artworkText}`;
}

function parseCandidate(raw: string | null, expectedSeed: number): {
  validation?: SceneValidationResult;
  correspondence?: string;
  error?: string;
} {
  if (!raw) return { error: "empty model response" };
  const parsed = extractJsonObject(raw);
  const correspondence = typeof parsed.correspondence === "string"
    ? parsed.correspondence.trim().normalize("NFC").slice(0, 500)
    : "";
  const validation = validateSceneV1(parsed.scene);
  if (!validation.valid || !validation.scene) return { validation, correspondence, error: validation.errors.join("; ") };
  if (validation.scene.seed !== expectedSeed) return { validation, correspondence, error: `scene.seed must be ${expectedSeed}` };
  if (!correspondence) return { validation, error: "correspondence must be a non-empty sentence" };
  return { validation, correspondence };
}

export async function generateSceneCompanion(input: SceneAuthoringInput): Promise<SceneCompanionResult> {
  const sourceHash = hashArtworkSource(input.artworkText);
  const seed = seedForSourceHash(sourceHash);
  const messages = [{ role: "user" as const, content: scenePrompt(input, seed) }];

  const primaryRaw = await oneMinAiStructured(messages);
  const primary = parseCandidate(primaryRaw, seed);
  if (primary.validation?.valid && primary.validation.scene && primary.validation.sceneHash && primary.correspondence) {
    return {
      ok: true,
      scene: primary.validation.scene,
      sceneHash: primary.validation.sceneHash,
      sourceHash,
      correspondence: primary.correspondence,
      provider: "1minai",
    };
  }

  try {
    const response = await groqFetch({
      model: FALLBACK_MODEL,
      messages,
      max_completion_tokens: 5_000,
      temperature: 0.6,
      reasoning_effort: "low",
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 240);
      return { ok: false, sourceHash, error: `scene generation failed: 1min.ai ${primary.error}; Groq HTTP ${response.status}: ${detail}` };
    }
    const data = await response.json() as GroqChatResponse;
    const fallback = parseCandidate(extractContentOrReasoning(data), seed);
    if (fallback.validation?.valid && fallback.validation.scene && fallback.validation.sceneHash && fallback.correspondence) {
      return {
        ok: true,
        scene: fallback.validation.scene,
        sceneHash: fallback.validation.sceneHash,
        sourceHash,
        correspondence: fallback.correspondence,
        provider: "groq",
      };
    }
    return { ok: false, sourceHash, error: `scene generation failed: 1min.ai ${primary.error}; Groq ${fallback.error}` };
  } catch (error) {
    return {
      ok: false,
      sourceHash,
      error: `scene generation failed: 1min.ai ${primary.error}; Groq ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
