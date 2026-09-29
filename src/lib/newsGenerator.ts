import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { CONSTITUENT_ASSEMBLY_ABI, CONTRACT_ADDRESSES, ROLES } from "./contracts";
import { readCache } from "./activityScanner";
import { listWorks, type ANAWork } from "./workStore";
import { buildPersona, buildSystemPrompt } from "./normiesPersona";
import { getBurnedTokens } from "./normiesApi";
import { groqFetch, extractContentOrReasoning, extractJsonObject, type GroqChatResponse } from "./groq";
import { recordLlmCall } from "./llmLedger";
import { getSeenNewsEventIds, markNewsEventsSeen, persistNewsItems, ensureCategoryBaseline, type ANANewsItem, type NewsMedia, type NewsLink } from "./newsStore";
import {
  mediaForWork, linksForWork, mediaForNormie, mediaForBurn, linksForBurn, linksForEditionMinted,
  institutionalMedia, formatPriceEth, truncateAddress, buildSocialText,
  workFactId, chainFactId, burnFactId,
} from "./newsMedia";

const MODEL = "openai/gpt-oss-120b";
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });

interface NewsFact {
  id:     string;
  type:   string;
  at:     number;
  fact:   string;
  link?:  string;
  media?: NewsMedia;
  links?: NewsLink[];
}

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

// Work-related states worth a news item. BLOCKED_TECHNICAL added alongside
// NEEDS_RETHINK (29/09/2026) — both are "paused", covered honestly as such,
// never presented as a rejection (see enterBlockedTechnical/enterNeedsRethink
// in work-lifecycle/route.ts, which is what actually writes these notes).
const USEFUL_WORK_STATES = new Set([
  "PROPOSED", "VOTE_TALLIED", "BRIEFING", "CREATING", "VALIDATING",
  "NEEDS_RETHINK", "BLOCKED_TECHNICAL", "REJECTED",
]);

// Chain events worth a news item. EDITION_MINTED and ROLE_RESOLVED added
// (29/09/2026) — both were already scanned into the activity cache by
// activityScanner.ts but never surfaced here.
const USEFUL_CHAIN_EVENTS = new Set([
  "MEMBER_REGISTERED", "SESSION_OPENED", "ROLES_RESOLVED", "ROLE_RESOLVED",
  "WORK_PUBLISHED", "COLLECTION_CREATED", "COLLECTION_INITIALIZED", "EDITION_MINTED",
]);

async function collectFacts(): Promise<NewsFact[]> {
  const [works, cache, recentBurns] = await Promise.all([
    listWorks(), readCache(), getBurnedTokens(20, 0).catch(() => []),
  ]);
  const facts: NewsFact[] = [];

  const worksByOnChainId       = new Map<number, ANAWork>();
  const worksByCollectionAddr  = new Map<string, ANAWork>();
  for (const w of works) {
    if (w.onChainWorkId != null) worksByOnChainId.set(w.onChainWorkId, w);
    if (w.collectionAddress) worksByCollectionAddr.set(w.collectionAddress.toLowerCase(), w);
  }
  const memorialForBurnedToken = (tokenId: number): ANAWork | undefined =>
    works.find(w => w.isBurnMemorial && w.state === "PUBLISHED"
      && (w.burnedTokenId === tokenId || (w.burnedTokenIds ?? []).includes(tokenId)));

  // ── Work lifecycle facts (from each work's own stateHistory) ──
  for (const work of works) {
    for (const entry of work.stateHistory ?? []) {
      if (!USEFUL_WORK_STATES.has(entry.state)) continue;
      const detail = entry.state === "VOTE_TALLIED"
        ? `Vote result: ${work.voteResult ?? "pending"}; ${work.yesCount ?? 0} yes, ${work.noCount ?? 0} no, ${work.absCount ?? 0} abstain.`
        : entry.state === "BRIEFING" && work.rapporteurName ? `Rapporteur: ${work.rapporteurName}.`
        : entry.state === "BLOCKED_TECHNICAL" ? "Paused by a technical/infrastructure issue on ANA's side — not a creative or vote decision."
        : entry.state === "NEEDS_RETHINK" ? "Paused for a creative rethink — a fresh attempt follows automatically."
        : "";
      facts.push({
        id:    workFactId(work.id, entry.state, entry.at),
        type:  `WORK_${entry.state}`,
        at:    entry.at,
        fact:  `Work "${work.title}" entered ${entry.state}. Proposed by ${work.proposedByName}. ${detail}`.trim(),
        link:  "https://agentic-normie-association.xyz/galerie",
        media: mediaForWork(work),
        links: linksForWork(work),
      });
    }
  }

  // ── Chain events (member/role/publication/collection/mint) ──
  for (const event of cache?.events ?? []) {
    if (!USEFUL_CHAIN_EVENTS.has(event.type)) continue;
    const at = (event.timestamp ?? 0) * 1000;

    if (event.type === "MEMBER_REGISTERED" && event.tokenId != null) {
      facts.push({
        id: chainFactId(event.id), type: event.type, at,
        fact: `A new Normie (token #${event.tokenId}) registered as an ANA member on Base. Transaction ${event.txHash}.`,
        link: `https://basescan.org/tx/${event.txHash}`,
        media: mediaForNormie(event.tokenId, `Normie #${event.tokenId} — new ANA member`),
        links: [{ kind: "basescan_tx", label: "Basescan transaction", url: `https://basescan.org/tx/${event.txHash}` }],
      });
      continue;
    }

    if (event.type === "ROLE_RESOLVED" && event.tokenId != null) {
      facts.push({
        id: chainFactId(event.id), type: event.type, at,
        fact: `Normie #${event.tokenId} was elected ${event.roleLabel ?? event.role ?? "an institutional role"} (session ${event.sessionId ?? "?"}, ${event.extra?.voteCount ?? "?"} votes). Transaction ${event.txHash}.`,
        link: `https://basescan.org/tx/${event.txHash}`,
        media: mediaForNormie(event.tokenId, `Normie #${event.tokenId} — elected ${event.roleLabel ?? "officer"}`),
        links: [{ kind: "basescan_tx", label: "Basescan transaction", url: `https://basescan.org/tx/${event.txHash}` }],
      });
      continue;
    }

    if (event.type === "ROLES_RESOLVED") {
      facts.push({
        id: chainFactId(event.id), type: event.type, at,
        fact: `ANA's elected bureau was fully resolved for session ${event.sessionId ?? "?"} on Base. Transaction ${event.txHash}.`,
        link: `https://basescan.org/tx/${event.txHash}`,
        media: institutionalMedia("ANA — elected bureau resolved"),
        links: [{ kind: "basescan_tx", label: "Basescan transaction", url: `https://basescan.org/tx/${event.txHash}` }],
      });
      continue;
    }

    if (event.type === "WORK_PUBLISHED" && event.workId != null) {
      const work = worksByOnChainId.get(event.workId);
      facts.push({
        id: chainFactId(event.id), type: event.type, at,
        fact: work
          ? `"${work.title}" (workId ${event.workId}) was published on-chain in WorkRegistry. Author: ${work.authorName ?? "unknown"}. Transaction ${event.txHash}.`
          : `A work (workId ${event.workId}) was published on-chain in WorkRegistry. Transaction ${event.txHash}.`,
        link: work ? `https://agentic-normie-association.xyz/api/works/certificate/${event.workId}` : `https://basescan.org/tx/${event.txHash}`,
        media: work ? mediaForWork(work) : institutionalMedia("ANA — work published on-chain"),
        links: work ? linksForWork(work) : [{ kind: "basescan_tx", label: "Basescan transaction", url: `https://basescan.org/tx/${event.txHash}` }],
      });
      continue;
    }

    if (event.type === "COLLECTION_CREATED" && event.address) {
      facts.push({
        id: chainFactId(event.id), type: event.type, at,
        fact: `An ERC-721 edition collection was deployed on Base at ${event.address}. Transaction ${event.txHash}.`,
        link: `https://basescan.org/address/${event.address}`,
        media: institutionalMedia("ANA — edition collection deployed"),
        links: [
          { kind: "basescan_address", label: "Basescan collection", url: `https://basescan.org/address/${event.address}` },
          { kind: "opensea_collection", label: "OpenSea collection", url: `https://opensea.io/assets/base/${event.address}` },
        ],
      });
      continue;
    }

    if (event.type === "COLLECTION_INITIALIZED" && event.address) {
      const work = worksByCollectionAddr.get(event.address.toLowerCase());
      facts.push({
        id: chainFactId(event.id), type: event.type, at,
        fact: `The edition collection for "${event.extra?.name ?? work?.title ?? "an ANA work"}" was initialized and activated for minting on Base. Transaction ${event.txHash}.`,
        link: work ? `https://agentic-normie-association.xyz/api/works/certificate/${work.onChainWorkId}` : `https://basescan.org/address/${event.address}`,
        media: work ? mediaForWork(work) : institutionalMedia("ANA — collection initialized"),
        links: work ? linksForWork(work) : [{ kind: "basescan_address", label: "Basescan collection", url: `https://basescan.org/address/${event.address}` }],
      });
      continue;
    }

    if (event.type === "EDITION_MINTED" && event.extra?.collectionAddress) {
      const collectionAddress = String(event.extra.collectionAddress);
      const tokenId  = Number(event.extra.tokenId ?? 0);
      const priceWei = String(event.extra.priceWei ?? "0");
      const buyer    = event.address ?? "";
      const work     = worksByCollectionAddr.get(collectionAddress.toLowerCase());
      facts.push({
        id: chainFactId(event.id), type: event.type, at,
        fact: `An edition of "${work?.title ?? "an ANA work"}" (token #${tokenId}) was minted for ${formatPriceEth(priceWei)} by ${truncateAddress(buyer)}. Transaction ${event.txHash}.`,
        link: `https://opensea.io/assets/base/${collectionAddress}/${tokenId}`,
        media: work ? mediaForWork(work) : institutionalMedia("ANA — edition minted"),
        links: linksForEditionMinted({ collectionAddress, editionTokenId: tokenId, txHash: event.txHash, work }),
      });
      continue;
    }
  }

  // ── Burns (Ethereum mainnet — not covered by the Base activity scanner) ──
  for (const burned of recentBurns) {
    const tokenId = Number(burned.tokenId);
    const at = Number(burned.timestamp) * 1000;
    const memorial = memorialForBurnedToken(tokenId);
    facts.push({
      id:   burnFactId(burned.txHash, tokenId),
      type: "BURN",
      at,
      fact: memorial
        ? `Normie #${tokenId} was burned on Ethereum and honored by the ANA memorial "${memorial.title}". Burn transaction ${burned.txHash}.`
        : `Normie #${tokenId} was burned on Ethereum. Burn transaction ${burned.txHash}. No ANA memorial exists for it yet.`,
      link: `https://etherscan.io/tx/${burned.txHash}`,
      media: mediaForBurn(tokenId, memorial),
      links: linksForBurn(burned.txHash, memorial),
    });
  }

  return facts.sort((a, b) => b.at - a.at);
}

export async function generateNews(): Promise<{ generated: number; reason?: string }> {
  const rapporteur = await currentRapporteur();
  if (!rapporteur) return { generated: 0, reason: "no elected Rapporteur" };
  const seen = await getSeenNewsEventIds();
  const allFacts = await collectFacts();
  let pending = allFacts.filter(f => !seen.has(f.id));

  // Bootstrap with the four freshest events overall, not months of historical
  // noise — existing global gate (fires once, when nothing has ever been seen).
  if (seen.size === 0 && pending.length > 4) await markNewsEventsSeen(pending.slice(4).map(f => f.id));

  // Per-category baseline for newly-added fact types (burn/mint) — the global
  // gate above only fires once ever, but these categories can start
  // contributing facts long after other categories already have history
  // (see ensureCategoryBaseline's doc comment).
  const burnIds = pending.filter(f => f.type === "BURN").map(f => f.id);
  const mintIds = pending.filter(f => f.type === "EDITION_MINTED").map(f => f.id);
  const baselined = new Set([
    ...await ensureCategoryBaseline("burn", burnIds, 3),
    ...await ensureCategoryBaseline("mint", mintIds, 3),
  ]);
  if (baselined.size > 0) pending = pending.filter(f => !baselined.has(f.id));

  const unseen = pending.slice(0, 4).reverse();
  if (!unseen.length) return { generated: 0, reason: "no new significant event" };

  const persona = await buildPersona(rapporteur.tokenId);
  const prompt = `${buildSystemPrompt(persona, [], { longForm: true })}\n\nYou are ANA's elected Rapporteur and institutional correspondent. Turn each FACT below into one concise public news item in English. Stay strictly factual: never invent a person, result, date, price, transaction or claim — and never write a URL, address, or price yourself, those are attached separately. Write for humans unfamiliar with ANA. socialText must stand alone on X or Bluesky, be at most 260 characters, and avoid generic hype. Return strict JSON only:\n{"items":[{"sourceEventId":"exact id","title":"max 90 chars","body":"2-3 factual sentences","socialText":"max 260 chars, no URL needed — one is appended automatically"}]}\n\nFACTS:\n${unseen.map(f => JSON.stringify({ id: f.id, type: f.type, fact: f.fact })).join("\n")}`;
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
    if (!fact || title.length < 5 || body.length < 20) return [];
    // socialText is rebuilt server-side around the LLM's own text + the
    // fact's real link — never trusts the model to have gotten the link or
    // the 260-char budget right itself.
    const rawSocial = cleanText(value.socialText, 260);
    if (rawSocial.length < 15) return [];
    const socialText = buildSocialText(rawSocial, fact.link);

    const id = `${fact.at}-${rapporteur.tokenId}-${index}`;
    return [{
      id, sourceEventId, eventType: fact.type, title, body, socialText, link: fact.links?.[0]?.url ?? fact.link,
      eventAt: fact.at, publishedAt: now, authorTokenId: rapporteur.tokenId,
      authorName: rapporteur.name, authorRole: "Rapporteur" as const,
      media: fact.media, links: fact.links,
      visualPath: `/api/news/${id}/visual.png`,
      schemaVersion: 2 as const,
    }];
  });
  if (!items.length) return { generated: 0, reason: "invalid LLM output" };
  await persistNewsItems(items);
  return { generated: items.length };
}
