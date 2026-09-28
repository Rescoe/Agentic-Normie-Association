import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { CONSTITUENT_ASSEMBLY_ABI, CONTRACT_ADDRESSES, ROLES } from "./contracts";
import { readCache } from "./activityScanner";
import { listWorks } from "./workStore";
import { buildPersona, buildSystemPrompt } from "./normiesPersona";
import { groqFetch, extractContentOrReasoning, extractJsonObject, type GroqChatResponse } from "./groq";
import { recordLlmCall } from "./llmLedger";
import { getSeenNewsEventIds, markNewsEventsSeen, saveNews, type ANANewsItem } from "./newsStore";

const MODEL = "openai/gpt-oss-120b";
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });

interface NewsFact { id: string; type: string; at: number; fact: string; link?: string }

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function currentRapporteur(): Promise<{ tokenId: number; name: string } | null> {
  const address = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}` | undefined;
  if (!address) return null;
  try {
    const [tokenId] = await client.readContract({
      address, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "getLeader",
      args: [ROLES.RAPPORTEUR as `0x${string}`],
    }) as [bigint, bigint];
    if (tokenId === 0n) return null;
    const persona = await buildPersona(Number(tokenId));
    return { tokenId: Number(tokenId), name: persona.name };
  } catch { return null; }
}

async function collectFacts(): Promise<NewsFact[]> {
  const [works, cache] = await Promise.all([listWorks(), readCache()]);
  const facts: NewsFact[] = [];
  const usefulStates = new Set(["PROPOSED", "VOTE_TALLIED", "BRIEFING", "CREATING", "VALIDATING", "NEEDS_RETHINK", "REJECTED"]);
  for (const work of works) {
    for (const entry of work.stateHistory ?? []) {
      if (!usefulStates.has(entry.state)) continue;
      const detail = entry.state === "VOTE_TALLIED"
        ? `Vote result: ${work.voteResult ?? "pending"}; ${work.yesCount ?? 0} yes, ${work.noCount ?? 0} no, ${work.absCount ?? 0} abstain.`
        : entry.state === "BRIEFING" && work.rapporteurName ? `Rapporteur: ${work.rapporteurName}.` : "";
      facts.push({
        id: `work:${work.id}:${entry.state}:${entry.at}`,
        type: `WORK_${entry.state}`,
        at: entry.at,
        fact: `Work "${work.title}" entered ${entry.state}. Proposed by ${work.proposedByName}. ${detail}`.trim(),
        link: "https://agentic-normie-association.xyz/galerie",
      });
    }
  }
  for (const event of cache?.events ?? []) {
    if (!["MEMBER_REGISTERED", "SESSION_OPENED", "ROLES_RESOLVED", "WORK_PUBLISHED", "COLLECTION_CREATED", "COLLECTION_INITIALIZED"].includes(event.type)) continue;
    facts.push({
      id: `chain:${event.id}`,
      type: event.type,
      at: (event.timestamp ?? 0) * 1000,
      fact: `${event.type} occurred on Base at block ${event.blockNumber}. Token ${event.tokenId ?? "unknown"}; session ${event.sessionId ?? "unknown"}; work ${event.workId ?? "unknown"}. Transaction ${event.txHash}.`,
      link: `https://basescan.org/tx/${event.txHash}`,
    });
  }
  return facts.sort((a, b) => b.at - a.at);
}

export async function generateNews(): Promise<{ generated: number; reason?: string }> {
  const rapporteur = await currentRapporteur();
  if (!rapporteur) return { generated: 0, reason: "no elected Rapporteur" };
  const seen = await getSeenNewsEventIds();
  const allFacts = await collectFacts();
  const pending = allFacts.filter(f => !seen.has(f.id));
  // Bootstrap with the four freshest events, not months of historical noise.
  // Older facts become the baseline and future runs only report genuinely new events.
  if (seen.size === 0 && pending.length > 4) await markNewsEventsSeen(pending.slice(4).map(f => f.id));
  const unseen = pending.slice(0, 4).reverse();
  if (!unseen.length) return { generated: 0, reason: "no new significant event" };

  const persona = await buildPersona(rapporteur.tokenId);
  const prompt = `${buildSystemPrompt(persona, [], { longForm: true })}\n\nYou are ANA's elected Rapporteur and institutional correspondent. Turn each FACT below into one concise public news item in English. Stay strictly factual: never invent a person, result, date, price, transaction or claim. Write for humans unfamiliar with ANA. socialText must stand alone on X or Bluesky, be at most 260 characters including the supplied link, and avoid generic hype. Return strict JSON only:\n{"items":[{"sourceEventId":"exact id","title":"max 90 chars","body":"2-3 factual sentences","socialText":"max 260 chars"}]}\n\nFACTS:\n${unseen.map(f => JSON.stringify(f)).join("\n")}`;
  const response = await groqFetch({
    model: MODEL,
    messages: [{ role: "system", content: "You are the elected Rapporteur of ANA. Strict JSON, English only." }, { role: "user", content: prompt }],
    max_tokens: 900, temperature: 0.55,
  });
  await recordLlmCall({ provider: "groq", model: MODEL, task: "news", success: response.ok });
  if (!response.ok) return { generated: 0, reason: `LLM ${response.status}` };
  const data = await response.json() as GroqChatResponse;
  const parsed = extractJsonObject(extractContentOrReasoning(data));
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const factMap = new Map(unseen.map(f => [f.id, f]));
  const now = Date.now();
  const items: ANANewsItem[] = rawItems.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    const sourceEventId = String(value.sourceEventId ?? "");
    const fact = factMap.get(sourceEventId);
    const title = cleanText(value.title, 90);
    const body = cleanText(value.body, 700);
    let socialText = cleanText(value.socialText, 260);
    if (!fact || title.length < 5 || body.length < 20 || socialText.length < 20) return [];
    if (fact.link && !socialText.includes(fact.link)) {
      const suffix = ` ${fact.link}`;
      socialText = socialText.slice(0, 260 - suffix.length).trimEnd() + suffix;
    }
    return [{
      id: `${fact.at}-${rapporteur.tokenId}-${index}`,
      sourceEventId, eventType: fact.type, title, body, socialText, link: fact.link,
      eventAt: fact.at, publishedAt: now, authorTokenId: rapporteur.tokenId,
      authorName: rapporteur.name, authorRole: "Rapporteur" as const,
    }];
  });
  if (!items.length) return { generated: 0, reason: "invalid LLM output" };
  await saveNews(items);
  await markNewsEventsSeen(items.map(item => item.sourceEventId));
  return { generated: items.length };
}
