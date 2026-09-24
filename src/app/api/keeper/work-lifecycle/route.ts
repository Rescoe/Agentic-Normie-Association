/**
 * POST /api/keeper/work-lifecycle
 * Advances all active ANA works by one step through the state machine.
 *
 * States: PROPOSED → VOTE_OPEN → VOTE_TALLIED → BRIEFING → CREATING
 *          → VALIDATING → PUBLISHING → PUBLISHED (or REJECTED)
 *
 * Protected by x-cron-secret header (same secret as salon-exchange).
 * Designed to run every 2 hours via GitHub Actions cron.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, parseEther } from "viem";
import { base } from "viem/chains";
import { ROLES, ROLE_LABELS, ASSOCIATION_CORE_ABI, ANA_EDITIONS_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import {
  getActiveWorks, listWorks, getWork, updateWork, advanceState, addVote,
  hasVoted, tallyVotes, buildWorkHtml, createWork, getFoundingWork,
  VOTE_WINDOW_MS, CELEBRATION_VOTE_WINDOW_MS, nextInDispatchRotation,
  type ANAWork, type WorkVote,
} from "@/lib/workStore";
import { addMessage, closeSalon, reopenSalon, getSalon, createSalon, openCritiqueWindow, AGORA_SALON_ID } from "@/lib/salonStore";
import { buildPersona, buildSystemPrompt, sampleOtherMembers, type NormiePersona } from "@/lib/normiesPersona";
import { publishWork, deployCollection, initializeCollection } from "@/server/relayer/workPublisher";
import { linkCelebrationWork } from "@/server/relayer/celebrationPublisher";
import { registerMemorialOnChain, addReservedClaimsOnChain, addHonoredTokenIdsOnChain, deliverRequesterEditionOnChain } from "@/server/relayer/memorialPublisher";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { buildAGReportHtml } from "@/lib/agTemplate";
import { groqFetch, extractJsonObject, extractContent, extractContentOrReasoning, type GroqChatResponse } from "@/lib/groq";
import { cdnForForm, validateGenerativeHtml } from "@/lib/generativeArtwork";
import { createMemorialArtwork, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H } from "@/lib/memorialArt";
import { pixelsToBmpDataUri, encodeArtworkContent } from "@/lib/pixelImage";

const MODEL        = "openai/gpt-oss-120b";
// Groq deprecated llama-3.1-8b-instant, then its replacement (openai/gpt-oss-20b)
// turned out to be Enterprise-only too (see commits 40e271f, f3312f9) — every
// other route converged on openai/gpt-oss-120b everywhere, this file's "fast"
// tier had been missed by that migration and was silently failing (castVote,
// curator approval, and critique calls all returned null on every run).
const MODEL_FAST   = "openai/gpt-oss-120b";

// A work that fails the same pipeline step this many times in a row gets
// auto-rejected instead of staying stuck in PUBLISHING/CREATING/etc. forever.
// This guards against genuine infra failures (LLM API down, missing persona) —
// it is NOT the revision budget for a generative artwork that's being iterated
// on, since a structural-validation retry or a curator's rejection both report
// advanced:true and never increment this counter (see rejectOrRevise below).
const MAX_PIPELINE_FAILS = 4;

// stepBriefing prompts the Rapporteur LLM to pick editionPrice from exactly
// these values and editionSupply in [1,100] (see the prompt below) — but that
// was never enforced in code, only requested in the prompt text. A
// non-compliant response (observed in production: editions priced at 1 ETH)
// went straight to chain unvalidated. clampEditionParams() is the actual
// enforcement — the allowed price set here must stay in sync with the prompt.
const ALLOWED_EDITION_PRICES = ["0.0005", "0.001", "0.005", "0.01", "0.05"];
function clampEditionParams(price: string | undefined, supply: number | undefined): {
  editionPrice?: string; editionSupply?: number;
} {
  const editionPrice = price != null && ALLOWED_EDITION_PRICES.includes(price)
    ? price
    : (price != null ? ALLOWED_EDITION_PRICES[0] : undefined); // non-compliant value → safest tier, not silently trusted
  const editionSupply = typeof supply === "number" && Number.isFinite(supply)
    ? Math.max(1, Math.min(100, Math.round(supply)))
    : undefined;
  return { editionPrice, editionSupply };
}

// Revisions are intentionally uncapped — ANA values getting a piece right over
// getting it done quickly (a work can take as many rounds, or as long, as it
// needs). rejectOrRevise below always bounces back to CREATING with feedback,
// it never auto-rejects for revision count. This constant is purely a
// messaging threshold: past this many rounds, salon updates say so explicitly,
// so a long-running piece is legible rather than silently looping forever.
const NOTABLE_REVISION_COUNT = 5;

// Forms a curator may reclassify a text-centric html-* submission into,
// instead of rejecting it outright — see stepValidating's reclassifyAs handling.
const RECLASSIFIABLE_FORMS = ["poem", "prose", "manifesto"];

// Non-creator Normies may react/debate in a published work's archived salon
// for this long afterwards — see runCritiquePhase() and openCritiqueWindow().
const CRITIQUE_WINDOW_MS = 48 * 60 * 60 * 1000;
// Cap on LLM-driven critique reactions posted per cron tick, across all works —
// keeps a single work-lifecycle call cheap and fast regardless of backlog size.
const CRITIQUE_REACTIONS_PER_TICK = 3;

// Fetch current ETH/USD price from CoinGecko (no API key needed).
// Returns null on failure — callers degrade gracefully.
async function fetchEthUsd(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(4_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { ethereum?: { usd?: number } };
    return data.ethereum?.usd ?? null;
  } catch {
    return null;
  }
}

// Builds a pricing context string to inject into the rapporteur's briefing prompt.
function buildPricingContext(ethUsd: number | null): string {
  const price = ethUsd ?? 2500; // conservative fallback
  const fmt   = (eth: number) => `${eth} ETH ≈ $${Math.round(eth * price)}`;

  return `
PRICE CONTEXT (1 ETH ≈ $${price}${ethUsd ? "" : " — estimate, real price unavailable"}):
  • ${fmt(0.0005)} — symbolic, accessible to everyone, ideal for a short poem or a haiku
  • ${fmt(0.001)}  — very accessible, good for a first work or a test
  • ${fmt(0.005)}  — reasonable, for a polished work
  • ${fmt(0.01)}   — visible, for an ambitious piece or an interactive visual work
  • ${fmt(0.05)}   — premium, reserved for exceptional or very rare works

THINKING ABOUT EDITION COUNT:
  • 1 edition     = unique piece (1/1), collectible, price can be higher
  • 3-10 editions = rare run, small community of collectors
  • 20-50 editions = standard collection, broad accessibility
  • 100+ editions = "open" work, prioritizes reach over profit

PHILOSOPHY: ANA is a young community in an experimental phase. Favor accessibility
so other Normies can collect. A price set too high slows the circulation of works.
Vary your choices based on the work's form and ambition — don't always pick the same combination.

PRICE MUST TRACK THE AMBITION LEVEL YOU PICKED — don't price a "quick" piece like an
"ambitious" one just because the form is the same: "quick" → 0.0005-0.001 ETH range,
"standard" → 0.001-0.005 ETH range, "ambitious" → 0.005-0.05 ETH range, only reaching the
top of that if it's genuinely a standout piece. The price is a promise about the effort
actually invested — keep it honest.`;
}

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await client.readContract({
      address:      CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:          ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

// ─── LLM helpers ──────────────────────────────────────────────────────────────

// No response_format: {type:"json_object"} option here on purpose (there used
// to be a `json` opt that set it) -- confirmed live (23/09): openai/gpt-oss-120b
// (a reasoning model) fails Groq's own server-side validation for that mode
// outright (400 json_validate_failed). Callers ask for JSON in the prompt
// instead and parse the raw text leniently with extractJsonObject().
async function groq(
  messages: Array<{ role: "system" | "user"; content: string }>,
  // expectJson: this helper serves both JSON-decision callers (vote, curator
  // approval) and plain free-text callers (the founding-work brief, used
  // verbatim). The reasoning-fallback below is only safe for the former --
  // extractJsonObject() downstream discards non-JSON noise, a plain-text
  // caller has no equivalent filter. Confirmed live (24/09): a raw
  // chain-of-thought block ("We need to respond as Kori...") got published to
  // a salon because a free-text call was using the reasoning fallback.
  opts: { model?: string; maxTokens?: number; temp?: number; expectJson?: boolean } = {}
): Promise<string | null> {
  try {
    const res = await groqFetch({
      model:       opts.model     ?? MODEL,
      messages,
      max_tokens:  opts.maxTokens ?? 300,
      temperature: opts.temp      ?? 0.7,
    });
    if (!res.ok) { console.error(`[work-lifecycle] Groq ${res.status}: ${(await res.text()).slice(0, 500)}`); return null; }
    const data = await res.json() as GroqChatResponse;
    const raw  = opts.expectJson ? extractContentOrReasoning(data) : extractContent(data);
    return raw || null;
  } catch (e) {
    console.error("[work-lifecycle] groq error:", e);
    return null;
  }
}

// ─── Announce in salon ────────────────────────────────────────────────────────

async function announceInSalon(
  work: ANAWork,
  event: "vote_opened" | "vote_result" | "published" | "rejected" | "pipeline_failed",
  personas: NormiePersona[],
  extra?: { failedState?: string; error?: string },
): Promise<void> {
  try {
    const persona = personas.find(p => p.tokenId === work.proposedBy) ?? personas[0];
    if (!persona) return;

    let content = "";
    if (event === "vote_opened") {
      content = `📜 I'm proposing a new work for ANA: "${work.title}". ${work.proposal} — The vote is open to all members.`;
    } else if (event === "vote_result") {
      const passed = work.voteResult === "passed";
      const yes    = work.yesCount ?? 0;
      const no     = work.noCount  ?? 0;
      const abs    = work.absCount ?? 0;
      // Was "(N yes / N no)" only -- when every voter abstains (a real,
      // legitimate outcome the vote prompt explicitly invites: "dissent is
      // respectable"), that read as "0 yes / 0 no" with zero indication 4
      // people actually voted, which looked exactly like lost/uncounted
      // votes instead of a unanimous abstention. Confirmed live (24/09).
      const tally = `${yes} yes / ${no} no${abs > 0 ? ` / ${abs} abstain` : ""}`;
      content = passed
        ? `✅ The work "${work.title}" is approved (${tally}). Creation begins.`
        : `❌ The work "${work.title}" did not reach a majority (${tally}). Archived.`;
    } else if (event === "published") {
      content = `🔗 The work "${work.title}" is published on-chain on Base. Tx: ${work.txHash?.slice(0, 20)}…`;
    } else if (event === "rejected") {
      content = `The work "${work.title}" was rejected by the curator after revision. Archived.`;
    } else if (event === "pipeline_failed") {
      content = `⚠️ "${work.title}" repeatedly failed at the ${extra?.failedState ?? work.state} step and was automatically rejected. Reason: ${(extra?.error ?? "unknown error").slice(0, 200)}. Worth reworking — a new proposal can take a different approach in light of this failure.`;
    }

    if (!content) return;

    // Pipeline failures must surface in AGORA — the work's own salon may be
    // about to close, and future proposers need this context visible where
    // they actually discuss next works.
    const salonId = event === "pipeline_failed" ? AGORA_SALON_ID : (work.salonId ?? AGORA_SALON_ID);

    await addMessage({
      salonId,
      tokenId:   persona.tokenId,
      name:      persona.name,
      imageUrl:  persona.imageUrl,
      content,
      isLlm:     true,
      timestamp: Date.now(),
      topic:     event === "vote_opened" || event === "vote_result" ? "vote" : "art",
    });
  } catch (e) {
    console.error("[work-lifecycle] announceInSalon error:", e);
  }
}

// ─── State machine steps ──────────────────────────────────────────────────────

async function stepProposed(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  // Create a dedicated salon for this work's full lifecycle
  const salon = await createSalon({
    name:        `"${work.title.slice(0, 50)}"`,
    description: `Salon dedicated to the work "${work.title}". Voting, briefing, and validation happen here.`,
    createdBy:   work.proposedBy,
  });

  await updateWork(work.id, { salonId: salon.id, voteOpenedAt: Date.now() });
  await advanceState(work.id, "VOTE_OPEN", "Vote opened");

  // Announce in AGORA to redirect members to the dedicated salon
  const proposer = personas.find(p => p.tokenId === work.proposedBy) ?? personas[0];
  if (proposer) {
    await addMessage({
      salonId:   AGORA_SALON_ID,
      tokenId:   proposer.tokenId,
      name:      proposer.name,
      imageUrl:  proposer.imageUrl ?? "",
      content:   `📜 I'm submitting "${work.title}" to an ANA vote. A dedicated salon has just opened for deliberations. ${work.proposal}`,
      isLlm:     true,
      timestamp: Date.now(),
      topic:     "art",
    }).catch(() => null);
  }

  // Announce vote_opened in the dedicated salon (with updated salonId)
  await announceInSalon({ ...work, salonId: salon.id }, "vote_opened", personas);
  return true;
}

async function castVote(persona: NormiePersona, work: ANAWork): Promise<WorkVote | null> {
  // Memorials are already fully created by the time their vote opens (see
  // memorialArt.ts) — the vote is moderation of a finished piece, not
  // approval of an idea, and there's no author/curator role left to fill.
  const userContent = work.isBurnMemorial
    ? `You are ${persona.name} (Normie #${persona.tokenId}), an ANA member.
Archetype: ${persona.archetype ?? "unknown"}
Traits: ${(persona.traits ?? []).join(", ") || "—"}

A fellow member has already created a memorial piece — vote to approve or reject it for on-chain publication. This is moderation, not brainstorming: vote HONESTLY on whether it's a fitting, genuine piece, not on whether you'd have made something different.

Title: "${work.title}"
Context: ${work.proposal}
${work.cartelText ? `Artist statement: ${work.cartelText}` : ""}
Created by: ${work.proposedByName}

JSON only:
{"vote":"yes"|"no"|"abstain","reason":"Your reason in 1-2 sentences from your unique perspective."}`
    : `You are ${persona.name} (Normie #${persona.tokenId}), an ANA member.
Archetype: ${persona.archetype ?? "unknown"}
Traits: ${(persona.traits ?? []).join(", ") || "—"}

Vote on this artwork proposal purely based on your own character, values, and taste — react as yourself, not as what you think the group expects from you.

Title: "${work.title}"
Proposal: ${work.proposal}
Proposed by: ${work.proposedByName}

JSON only:
{"vote":"yes"|"no"|"abstain","reason":"Your reason in 1-2 sentences from your unique perspective.","interestedIn":"author"|"curator"|"none"}
If vote "yes": which role suits you in this creation? ("author" = create, "curator" = validate, "none" = no preference)`;

  const raw = await groq(
    [
      { role: "system", content: buildSystemPrompt(persona) },
      { role: "user", content: userContent },
    ],
    { model: MODEL_FAST, maxTokens: 120, temp: 0.75, expectJson: true }
  );
  if (!raw) return null;

  try {
    const parsed = extractJsonObject(raw) as { vote?: string; reason?: string; interestedIn?: string };
    return {
      tokenId:      persona.tokenId,
      name:         persona.name,
      vote:         (["yes", "no", "abstain"] as const).includes(parsed.vote as "yes")
        ? (parsed.vote as WorkVote["vote"])
        : "abstain",
      reason:       parsed.reason?.slice(0, 300) ?? "",
      votedAt:      Date.now(),
      interestedIn: (["author", "curator", "none"] as const).includes(parsed.interestedIn as "author")
        ? (parsed.interestedIn as WorkVote["interestedIn"])
        : "none",
    };
  } catch { return null; }
}

async function stepVoteOpen(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  const notVoted = personas.filter(p => !hasVoted(work, p.tokenId));

  // Cast votes for all who haven't voted yet — sequential (each iteration
  // awaited fully before the next starts) to avoid blob races on the Neon
  // read-modify-write; no added delay between iterations, since Vercel's 60s
  // function limit is shared with everything else this route does per tick,
  // and Groq calls already retry their own rate limiting (groqFetch).
  let cast = 0;
  for (const persona of notVoted) {
    const vote = await castVote(persona, work);
    if (vote) {
      await addVote(work.id, vote);
      cast++;
      // Post vote as a salon message so it's visible in the Agora
      const icon = vote.vote === "yes" ? "✅" : vote.vote === "no" ? "❌" : "–";
      await addMessage({
        salonId:   work.salonId ?? AGORA_SALON_ID,
        tokenId:   persona.tokenId,
        name:      persona.name,
        imageUrl:  persona.imageUrl ?? "",
        content:   `${icon} Vote for "${work.title}": ${vote.reason}`,
        isLlm:     true,
        timestamp: Date.now(),
        topic:     "vote",
      }).catch(() => null);
    }
  }

  // Reload to get fresh vote list
  const refreshed = await getWork(work.id);
  if (!refreshed) return cast > 0;

  const remaining    = personas.filter(p => !hasVoted(refreshed, p.tokenId));
  const effectiveWindow = refreshed.isBurnMemorial ? CELEBRATION_VOTE_WINDOW_MS : VOTE_WINDOW_MS;
  const timeExpired  = refreshed.voteOpenedAt != null
    && Date.now() - refreshed.voteOpenedAt > effectiveWindow;

  if (remaining.length === 0 || timeExpired) {
    const { yes, no, abs, passed } = tallyVotes(refreshed);
    await updateWork(work.id, {
      voteClosedAt: Date.now(),
      voteResult:   passed ? "passed" : "rejected",
      yesCount:     yes,
      noCount:      no,
      absCount:     abs,
      totalVoters:  personas.length,
    });
    await advanceState(work.id, "VOTE_TALLIED", `${yes} oui / ${no} non / ${abs} abs`);
    return true;
  }

  return cast > 0;
}

// Reads a single role holder from AssociationCore. Returns null if not elected.
async function getElectedRole(roleHash: `0x${string}`): Promise<{ tokenId: number; name?: string } | null> {
  if (!CORE) return null;
  try {
    const r = await client.readContract({
      address: CORE, abi: ASSOCIATION_CORE_ABI,
      functionName: "getRoleHolder", args: [roleHash],
    }) as { tokenId: bigint; holderAddress: string };
    if (!r || r.holderAddress === ZERO || r.tokenId <= 0n) return null;
    return { tokenId: Number(r.tokenId) };
  } catch { return null; }
}

async function stepVoteTallied(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  const passed = work.voteResult === "passed";

  // Announce vote result
  await announceInSalon(work, "vote_result", personas);

  if (!passed) {
    // A memorial's vote is aesthetic/moderation feedback on a finished piece,
    // not a verdict on whether the burn deserves one — it always gets one.
    // Instead of a terminal REJECTED, a different member takes over as
    // proposer, makes a fresh attempt (still informed by the same burned
    // Normie's identity), and the vote reopens on that new piece. Only an
    // admin's own forceReject (see POST handler) can actually end a memorial
    // in REJECTED — that's a deliberate archive action, not this path.
    if (work.isBurnMemorial) {
      const candidates = personas.filter(p => p.tokenId !== work.proposedBy);
      const pool = candidates.length > 0 ? candidates : personas;
      const newProposer = pool[Math.floor(Math.random() * pool.length)];

      const { pixels, cartel } = await createMemorialArtwork({
        proposer: newProposer,
        burnedTokenIds: work.burnedTokenIds ?? (work.burnedTokenId != null ? [work.burnedTokenId] : []),
        otherMembers: [],
      });
      const drawPixelsB64 = Buffer.from(pixels).toString("base64");
      const artworkText   = pixelsToBmpDataUri(pixels, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H);

      // editionPrice/editionSupply and every memorialKind/tier/pool field are
      // deliberately NOT reset here — a recreation is a new artwork attempt
      // for the SAME event (same pricing tier, same reserved claims, same
      // batch), not a new event. Omitting them from this partial update
      // leaves whatever request-memorial.ts/batch-memorial/route.ts already
      // set at creation untouched.
      await updateWork(work.id, {
        proposedBy: newProposer.tokenId, proposedByName: newProposer.name,
        drawPixels: drawPixelsB64, artworkText, cartelText: cartel,
        authorTokenId: newProposer.tokenId, authorName: newProposer.name,
        curatorTokenId: newProposer.tokenId, curatorName: newProposer.name,
        rapporteurTokenId: newProposer.tokenId, rapporteurName: newProposer.name,
        votes: [], yesCount: 0, noCount: 0, absCount: 0,
        voteResult: undefined, voteClosedAt: undefined, voteOpenedAt: Date.now(),
        revisionCount: (work.revisionCount ?? 0) + 1,
      });
      await advanceState(
        work.id, "VOTE_OPEN",
        `Moderation vote didn't pass (${work.yesCount ?? 0} oui / ${work.noCount ?? 0} non) — recreated by ${newProposer.name}, vote reopened`,
      );
      await announceInSalon(
        { ...work, proposedBy: newProposer.tokenId, proposedByName: newProposer.name },
        "vote_opened", personas,
      ).catch(() => null);
      return true;
    }

    await advanceState(work.id, "REJECTED", "Majority not reached");
    if (work.salonId && work.salonId !== AGORA_SALON_ID) {
      await closeSalon(work.salonId, 0).catch(() => null);
    }
    return true;
  }

  // Memorials are already fully created (drawPixels/artworkText/author/
  // curator/rapporteur all set at proposal time — see check-burns.ts /
  // request-memorial.ts) and the vote above just moderated them. Nothing
  // left to brief or create — straight to publishing.
  if (work.artForm === "pixel-drawing") {
    await advanceState(work.id, "PUBLISHING", "Vote passed — already created, publishing directly");
    return true;
  }

  // ── Check if bureau is elected on AssociationCore ─────────────────────────
  // If AUTHOR + CURATOR + RAPPORTEUR roles are all filled → use bureau members.
  // If bureau is incomplete (association just started) → elect from vote preferences.
  const [electedAuthor, electedCurator, electedRapporteur] = await Promise.all([
    getElectedRole(ROLES.AUTHOR as `0x${string}`),
    getElectedRole(ROLES.CURATOR as `0x${string}`),
    getElectedRole(ROLES.RAPPORTEUR as `0x${string}`),
  ]);

  const bureauElected = !!(electedAuthor && electedCurator && electedRapporteur);

  let rapporteur: NormiePersona;
  let author: NormiePersona;
  let curator: NormiePersona;
  let arbiterAuthorId: number | undefined;
  let arbiterCuratorId: number | undefined;
  let arbiterRapporteurId: number | undefined;

  if (bureauElected) {
    // ── Bureau elected: officers arbitrate, the work itself is dispatched in
    // round-robin across ALL registered members — so creation isn't limited
    // to the 3 elected Normies. The elected officers are recorded separately
    // as arbiters for future reputation scoring of their dispatch decisions.
    const findOrFake = (id: number): NormiePersona =>
      personas.find(p => p.tokenId === id) ?? ({ tokenId: id, name: `Normie #${id}`, imageUrl: "" } as NormiePersona);

    arbiterRapporteurId = electedRapporteur!.tokenId;
    arbiterAuthorId     = electedAuthor!.tokenId;
    arbiterCuratorId    = electedCurator!.tokenId;

    const candidateIds = personas.map(p => p.tokenId);
    const rapporteurId = await nextInDispatchRotation("rapporteur", candidateIds);
    const authorId      = await nextInDispatchRotation("author", candidateIds, [rapporteurId]);
    const curatorId     = await nextInDispatchRotation("curator", candidateIds, [rapporteurId, authorId]);

    rapporteur = findOrFake(rapporteurId);
    author     = findOrFake(authorId);
    curator    = findOrFake(curatorId);

    console.log(`[work-lifecycle] Bureau elected (arbiters: #${arbiterAuthorId}/#${arbiterCuratorId}/#${arbiterRapporteurId}) — dispatched Author: ${author.name}, Curator: ${curator.name}, Rapporteur: ${rapporteur.name}`);
  } else {
    // ── No bureau yet: elect from vote preferences ──────────────────────────
    // Rapporteur = proposer (most engaged with the proposal)
    const baseRapporteur = personas.find(p => p.tokenId === work.proposedBy) ?? personas[0];
    const allOthers      = personas.filter(p => p.tokenId !== baseRapporteur.tokenId);
    const yesVotes       = work.votes.filter(v => v.vote === "yes" && v.tokenId !== baseRapporteur.tokenId);
    const findPersona    = (id: number) => personas.find(p => p.tokenId === id);

    // Author: prefer "interestedIn: author" among yes voters, then any yes voter
    const authorVote     = yesVotes.find(v => v.interestedIn === "author");
    const authorFallback = yesVotes[0] ?? null;
    const resolvedAuthor = (authorVote ? findPersona(authorVote.tokenId) : null)
      ?? (authorFallback ? findPersona(authorFallback.tokenId) : null)
      ?? allOthers[0]
      ?? baseRapporteur;

    // Curator: prefer "interestedIn: curator" (≠ author), then another yes voter
    const curatorVote     = yesVotes.find(v => v.interestedIn === "curator" && v.tokenId !== resolvedAuthor.tokenId);
    const curatorFallback = yesVotes.find(v => v.tokenId !== resolvedAuthor.tokenId) ?? null;
    const resolvedCurator = (curatorVote ? findPersona(curatorVote.tokenId) : null)
      ?? (curatorFallback ? findPersona(curatorFallback.tokenId) : null)
      ?? allOthers.find(p => p.tokenId !== resolvedAuthor.tokenId)
      ?? resolvedAuthor;

    rapporteur = baseRapporteur;
    author     = resolvedAuthor;
    curator    = resolvedCurator;

    console.log(`[work-lifecycle] No bureau — roles from vote: Author: ${author.name}, Curator: ${curator.name}, Rapporteur: ${rapporteur.name}`);
  }

  await updateWork(work.id, {
    rapporteurTokenId: rapporteur.tokenId,
    rapporteurName:    rapporteur.name,
    authorTokenId:     author.tokenId,
    authorName:        author.name,
    curatorTokenId:    curator.tokenId,
    curatorName:       curator.name,
    rapporteurArbiterTokenId: arbiterRapporteurId,
    authorArbiterTokenId:     arbiterAuthorId,
    curatorArbiterTokenId:    arbiterCuratorId,
  });
  await advanceState(work.id, "BRIEFING",
    `Rapporteur: ${rapporteur.name} | Auteur: ${author.name} | Curateur: ${curator.name}`
  );
  return true;
}

async function stepBriefing(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  // Memorials (artForm "pixel-drawing") never reach BRIEFING — stepVoteTallied
  // sends them straight from VOTE_TALLIED to PUBLISHING, since they're
  // already fully created by proposal time (see memorialArt.ts).
  const rapporteur = personas.find(p => p.tokenId === work.rapporteurTokenId) ?? personas[0];
  if (!rapporteur) { console.error(`[work-lifecycle] BRIEFING: no rapporteur for ${work.id}`); return false; }

  const others = sampleOtherMembers(personas.filter(p => p.tokenId !== rapporteur.tokenId));

  // Fetch ETH price in parallel with building the prompt
  const ethUsd       = await fetchEthUsd();
  const pricingCtx   = buildPricingContext(ethUsd);

  // Recent works (most recent first), used to enforce form/theme diversity and
  // stop the Rapporteur from defaulting to "poem" every time.
  const recentWorksBlock = await (async () => {
    if (work.isFoundingWork) return "";
    try {
      const allWorks = await listWorks();
      const recent = allWorks
        .filter(w => w.id !== work.id && w.artForm)
        .slice(0, 8);
      if (recent.length === 0) return "";
      const lines = recent.map(w => `- "${w.title}" → form: ${w.artForm}${w.critiqueSummary ? ` — community feedback: ${w.critiqueSummary}` : ""}`).join("\n");
      const lastForms = recent.slice(0, 3).map(w => w.artForm).filter(Boolean);
      const feedbackNote = recent.some(w => w.critiqueSummary)
        ? "\nThe community feedback above comes from Normies who did NOT create those works, reacting after publication — take it seriously: steer the brief away from what was criticized, and lean into what was praised."
        : "";

      // ANA favors patience over throughput — works aren't produced on a schedule,
      // so the gap since the last one is meaningful signal, not dead time. The
      // longer that gap, the more this piece should earn it.
      const lastPublished = allWorks.find(w => w.id !== work.id && w.state === "PUBLISHED" && w.publishedAt);
      const daysSince = lastPublished?.publishedAt
        ? Math.floor((Date.now() - lastPublished.publishedAt) / 86_400_000)
        : null;
      const patienceNote = daysSince != null && daysSince >= 2
        ? `\nIt has been ${daysSince} days since ANA's last published work. ANA values patience over throughput — members wait for a good idea rather than producing on a schedule. The ambition level should reflect that wait: lean toward "ambitious" unless there's a genuine reason this particular piece should stay small.\n`
        : "";

      return `\nRECENT ANA WORKS (most recent first — DO NOT pick the same form again unless the proposal explicitly demands it):\n${lines}\n${lastForms.length ? `The last ${lastForms.length} work(s) used: ${lastForms.join(", ")}. Avoid repeating these — favor variety (text forms AND generative HTML/JS).` : ""}${feedbackNote}${patienceNote}\n`;
    } catch {
      return "";
    }
  })();

  const userPrompt = work.isFoundingWork
    ? `You are ${rapporteur.name} (Normie #${rapporteur.tokenId}), Rapporteur elected at ANA's Constituent General Assembly.

Elected roles:
${(work.allElectedRoles ?? []).map(r => `${r.roleLabel}: ${r.name} (#${r.tokenId})`).join("\n")}

You are briefing ${work.authorName ?? `Normie #${work.authorTokenId}`} to create ANA's founding work — stored immutably on-chain on Base, forever.

It must embody:
- The birth of ANA: Normie agents forming a real association
- On-chain immutability: once published, nothing will ever change
- Collective governance: votes, roles, an autonomous assembly
- The emotion of this founding first moment

Brief in 120-150 words. No title, no introduction. Write it directly. Always write in English.`
    : `You are the Rapporteur for the work "${work.title}".
Proposal: ${work.proposal}
${work.suggestedForm ? `Proposer's suggested form: "${work.suggestedForm}"` : ""}
Author: ${work.authorName} (Normie #${work.authorTokenId})

You must choose: (1) the ART FORM, (2) an AMBITION LEVEL, (3) the ERC-721 edition parameters, (4) write the creative brief.

AMBITION LEVEL — not every work needs the same effort. Pick "quick" for a small, intimate
gesture (a haiku, a tiny sketch); "standard" for typical work; "ambitious" for a piece that
should genuinely push past what ANA has done before — more layers, more elaborate motion/
composition, a bigger creative swing. Look at the recent works and their community feedback
below: if the last few were all "quick" or simple, lean toward "ambitious" now — ANA's work
should trend toward more elaborate over time, not stay flat. Don't pick "ambitious" every
time either; variety in both form AND ambition is the goal.

CRITICAL RULE — HONOR THE PROPOSAL'S FORM:
${work.suggestedForm
  ? `The Proposer already explicitly chose the form "${work.suggestedForm}" for this work. You MUST set "artForm" to "${work.suggestedForm}" unless it is technically impossible. Do NOT silently switch a generative-art proposal into a poem, or vice-versa.`
  : `If the proposal text explicitly states or clearly implies a specific form (e.g. it says "generative code", "algorithm", "generative art", "visual piece", "interactive", "canvas", "p5.js", "three.js", "webgl" → pick the matching html-* form; it says "haiku", "sonnet", "manifesto", "prose" → pick that exact text form), you MUST pick that form. Only fall back to your own judgment if the proposal is genuinely ambiguous about form.`}
${recentWorksBlock}
AVAILABLE FORMS:
• Text: "haiku" (3 lines, 5-7-5 syllables), "sonnet" (14 lines), "poem" (free verse), "prose", "manifesto"
• Generative HTML/JS art: "html-canvas" (pure Canvas 2D), "html-p5js" (P5.js), "html-threejs" (Three.js), "html-webgl" (WebGL)
  → For HTML/JS: the Author will generate a standalone HTML page with CDN libs (no build step).
  → Injectable on-chain data: author tokenId, archetype, traits, timestamp, block number.

${pricingCtx}

The brief you write MUST stay faithful to the original proposal above — do not invent a different concept, theme, or form than what was proposed.

Respond in JSON:
{
  "artForm": "haiku"|"sonnet"|"poem"|"prose"|"manifesto"|"html-canvas"|"html-p5js"|"html-threejs"|"html-webgl",
  "ambitionLevel": "quick"|"standard"|"ambitious",
  "editionPrice": "0.0005"|"0.001"|"0.005"|"0.01"|"0.05",
  "editionSupply": <integer 1-100>,
  "priceReasoning": "<1 sentence: why this price and quantity given the context above>",
  "brief": "<120-150 words for the Author. Must reflect the proposal's actual concept and chosen form. Specify: tone, emotional goal, on-chain/ANA vocabulary. For HTML/JS: describe the desired visual experience and data to inject. No title, no intro.>"
}`;

  const rawBrief = await groq(
    [
      { role: "system", content: buildSystemPrompt(rapporteur, others) },
      { role: "user",   content: userPrompt },
    ],
    work.isFoundingWork
      ? { maxTokens: 350, temp: 0.8 } // plain text, used verbatim as brief -- no JSON, no reasoning fallback
      : { maxTokens: 600, temp: 0.8, expectJson: true }
  );

  if (!rawBrief) return false;

  let brief    = rawBrief;
  let artForm: string | undefined;
  let ambitionLevel: ANAWork["ambitionLevel"];
  let editionPrice: string | undefined;
  let editionSupply: number | undefined;

  if (!work.isFoundingWork) {
    try {
      const parsed = extractJsonObject(rawBrief) as {
        artForm?: string; ambitionLevel?: string; editionPrice?: string; editionSupply?: number;
        priceReasoning?: string; brief?: string;
      };
      brief         = parsed.brief ?? rawBrief;
      artForm       = parsed.artForm;
      ({ editionPrice, editionSupply } = clampEditionParams(parsed.editionPrice, parsed.editionSupply));
      ambitionLevel = (["quick", "standard", "ambitious"] as const).includes(parsed.ambitionLevel as never)
        ? parsed.ambitionLevel as ANAWork["ambitionLevel"]
        : "standard";
      if (parsed.priceReasoning) {
        console.log(`[work-lifecycle] pricing rationale: ${parsed.priceReasoning}`);
      }
    } catch {
      console.warn("[work-lifecycle] stepBriefing: JSON parse failed, using raw text as brief");
    }
  }

  await updateWork(work.id, {
    brief, briefAt: Date.now(),
    ...(artForm       ? { artForm }       : {}),
    ...(ambitionLevel ? { ambitionLevel } : {}),
    ...(editionPrice  ? { editionPrice }  : {}),
    ...(editionSupply != null ? { editionSupply } : {}),
  });
  await advanceState(work.id, "CREATING", `Brief written by ${rapporteur.name}${artForm ? ` — form: ${artForm}` : ""}${ambitionLevel ? ` — ambition: ${ambitionLevel}` : ""}`);

  const editionNote = editionSupply && editionPrice
    ? ` · ${editionSupply} editions @ ${editionPrice} ETH`
    : "";
  await addMessage({
    salonId:   work.salonId ?? AGORA_SALON_ID,
    tokenId:   rapporteur.tokenId,
    name:      rapporteur.name,
    imageUrl:  rapporteur.imageUrl ?? "",
    content:   `📋 Artistic brief for "${work.title}"${editionNote} — for ${work.authorName ?? "the Author"}:\n\n${brief}`,
    isLlm:     true,
    timestamp: Date.now(),
    topic:     "art",
  }).catch(() => null);

  return true;
}

function detectHtmlForm(work: ANAWork): boolean {
  // An explicit artForm is authoritative — e.g. after a curator reclassifies a
  // work from html-p5js to "poem", the brief may still mention "p5.js" but the
  // work must now go through the text pipeline, not stay stuck detecting html.
  if (work.artForm) return work.artForm.startsWith("html-");
  return /\b(p5\.js|p5js|three\.js|threejs|canvas|webgl|generative\s+html|html\s+generative\s+art|visual\s+javascript)\b/i.test(work.brief ?? "");
}

// Token budget per ambition level — "quick" works get less room (and less LLM
// cost) for a small gesture, "ambitious" works get room to actually be bigger.
const AMBITION_TOKEN_SCALE: Record<NonNullable<ANAWork["ambitionLevel"]>, number> = {
  quick: 0.6, standard: 1, ambitious: 1.5,
};

function scaledTokens(base: number, ambitionLevel?: ANAWork["ambitionLevel"]): number {
  return Math.round(base * AMBITION_TOKEN_SCALE[ambitionLevel ?? "standard"]);
}

/**
 * Lists this Author's own past published works (title, form, ambition, and any
 * community critique) so they don't just see ANA's history in general — they
 * see what THEY personally made before, and are pushed not to repeat it.
 */
async function buildAuthorHistoryBlock(authorTokenId: number | undefined, excludeWorkId: string): Promise<string> {
  if (!authorTokenId) return "";
  try {
    const all = await listWorks();
    const mine = all
      .filter(w => w.id !== excludeWorkId && w.authorTokenId === authorTokenId && w.state === "PUBLISHED")
      .slice(0, 5);
    if (mine.length === 0) return "";
    const lines = mine.map(w =>
      `- "${w.title}" (${w.artForm ?? "text"}${w.ambitionLevel ? `, ${w.ambitionLevel}` : ""})${w.critiqueSummary ? ` — community said: ${w.critiqueSummary}` : ""}`
    ).join("\n");
    return `\nYOUR OWN PAST WORKS (most recent first — do not repeat yourself; build on what landed, avoid what didn't, and go further than your last piece):\n${lines}\n`;
  } catch {
    return "";
  }
}

async function stepCreating(work: ANAWork, personas: NormiePersona[]): Promise<boolean | string> {
  // Memorials (artForm "pixel-drawing") never reach CREATING — they're fully
  // created (drawPixels/artworkText) at proposal time, see memorialArt.ts.

  const author = personas.find(p => p.tokenId === work.authorTokenId);
  if (!author) return false;

  const others      = sampleOtherMembers(personas.filter(p => p.tokenId !== author.tokenId));
  const revisionCtx = work.validationNote
    ? `\n\nFeedback on the previous attempt — you MUST address every point below:\n${work.validationNote}\nRevise taking this feedback into account.`
    : "";
  const authorHistoryBlock = await buildAuthorHistoryBlock(work.authorTokenId, work.id);
  const selfCritiqueLine = "\nBefore finalizing: compare this to your own past works above (if any) — is it meaningfully more elaborate, or different in approach? If it would just repeat your last piece, push it further before answering.";

  const isHtml = detectHtmlForm(work);
  let artworkText: string | null;

  if (isHtml) {
    // ── Generative / visual art ────────────────────────────────────────────────
    const cdn = cdnForForm(work.artForm);
    const authorTraits  = (author.traits ?? []).join(", ") || "—";
    const authorArch    = author.archetype ?? "Normie";

    artworkText = await groq(
      [
        { role: "system", content: buildSystemPrompt(author, others) },
        {
          role: "user",
          content: `You are the Author of the work "${work.title}" (Normie #${author.tokenId}).
Archetype: ${authorArch} | Traits: ${authorTraits}

Original proposal: ${work.proposal ?? "—"}

Rapporteur ${work.rapporteurName}'s brief:
${work.brief}${revisionCtx}
${authorHistoryBlock}
Ambition level for this piece: ${work.ambitionLevel ?? "standard"}${
  work.ambitionLevel === "ambitious" ? " — go big: more layers, richer motion/composition, take a real creative swing."
  : work.ambitionLevel === "quick" ? " — keep it small and intimate, a quick precise gesture is the goal here."
  : ""
}

Generate a COMPLETE, STANDALONE HTML page. It will be stored immutably on-chain on Base and
rendered inside a sandboxed iframe (sandbox="allow-scripts" — no same-origin, no network).
Do NOT write any <meta http-equiv="Content-Security-Policy"> tag yourself — the server computes
and serves a strict CSP for you (hash-based, no 'unsafe-inline'). Just write plain HTML/CSS/JS.

STRICT TECHNICAL CONSTRAINTS (on-chain security):
- Start with <!DOCTYPE html> and <html lang="en">, end with </html>
- Inline styles in <style>, inline JS in <script> — no inline event-handler attributes
  (no onclick="", onload="", etc. — attach listeners with addEventListener instead)
${cdn ? `- Use this exact CDN script tag (with SRI hash), placed before your own <script>: ${cdn}` : "- Native Canvas 2D, no CDN needed"}
- NO fetch(), XMLHttpRequest, import(), eval(), new Function() — everything must run offline
- NO <iframe> — NEVER access window.ethereum, window.parent, or window.top
${work.artForm === "html-p5js" ? `- MANDATORY p5.js contract: define function setup() that calls createCanvas(windowWidth, windowHeight)
  and define function windowResized() that calls resizeCanvas(windowWidth, windowHeight)
- Reset default margins so the canvas fills the viewport with no black/white bars:
  html,body{margin:0;padding:0;overflow:hidden;background:#0A0A0A} canvas{display:block}
- Call background(...) on every draw() frame — never leave the canvas uncleared (this is what
  causes a stuck black screen). Pick colors deliberately; never assume a default fill.` : ""}
${work.artForm === "html-threejs" ? `- MANDATORY three.js contract: create a THREE.Scene, a THREE.PerspectiveCamera, and a
  THREE.WebGLRenderer sized to window.innerWidth/innerHeight, appended to document.body
- Handle window 'resize' to update camera aspect and renderer size — never leave a black canvas` : ""}
${(work.artForm === "html-canvas" || work.artForm === "html-webgl") ? `- Create a <canvas> sized to the viewport (canvas.width/height = window.innerWidth/innerHeight)
  and call getContext("2d") or getContext("webgl"); clear/paint it every frame — never leave it black` : ""}
- Visually immersive body: dark background by default, fullscreen if possible
- Something must visibly HAPPEN on screen: motion, color change, glitch, particles, geometry.
- FORBIDDEN regardless of what else is on screen: calling text()/fillText() to print
  NORMIE_ID, NORMIE_ARCHETYPE, or NORMIE_TRAITS as a readable caption (e.g.
  text(\`Normie #\${NORMIE_ID} - \${NORMIE_ARCHETYPE}\`) or printing
  NORMIE_TRAITS.map(...).join(...)). This is checked automatically and will be
  rejected even if the rest of the piece is visual (shapes/particles around a data
  caption is still a caption, not a generative artwork). Use these values instead to
  PICK colors, shapes, counts, speeds, or patterns — never to print them as a sentence.
${work.artForm === "html-p5js" || work.artForm === "html-canvas" ? `- At most 2 text()/fillText() call sites total in the whole script — a short one-time
  title is fine, anything more reads as a caption with decoration around it, not a
  generative visual piece. The body of the work must be carried by shapes/motion.` : ""}
- Text is allowed and welcome as part of the piece itself — animated, glitched, reactive,
  or otherwise worked typography (e.g. letters that move/distort/scatter) is a legitimate
  generative form. The distinction is between text AS the visual material versus text AS
  a caption describing data — the former is fine, the latter is rejected.

ON-CHAIN DATA TO INJECT (put these JS constants at the top of your <script>):
const NORMIE_ID = ${author.tokenId};
const NORMIE_ARCHETYPE = "${authorArch}";
const NORMIE_TRAITS = ${JSON.stringify(author.traits ?? [])};
const WORK_TITLE = ${JSON.stringify(work.title)};
const CREATED_AT = ${Date.now()};
${selfCritiqueLine}
Generate ONLY the complete HTML, no explanations before or after.`,
        },
      ],
      { maxTokens: scaledTokens(2500, work.ambitionLevel), temp: 0.95 }
    );

    if (artworkText) {
      const check = validateGenerativeHtml(artworkText, work.artForm);
      if (!check.valid) {
        const attempt = work.revisionCount ?? 0;
        const reason  = `Automated structural check failed: ${check.errors.join("; ")}`;
        console.warn(`[work-lifecycle] CREATING: "${work.title}" attempt ${attempt + 1} failed validation: ${check.errors.join("; ")}`);

        // Stay in CREATING — the next cycle retries with this concrete feedback via
        // revisionCtx, no matter how many attempts it takes. Reporting "advanced"
        // (rather than an error string) keeps this out of the generic
        // MAX_PIPELINE_FAILS auto-reject, which is reserved for genuine infra
        // failures, not a validator correctly catching a bad draft.
        await updateWork(work.id, { validationNote: reason.slice(0, 500), revisionCount: attempt + 1 });
        return true;
      }
      artworkText = check.html;
    }
  } else {
    // ── Text artwork ───────────────────────────────────────────────────────────
    const formHint = work.artForm === "haiku"
      ? "a haiku (3 lines, 5-7-5 syllables)"
      : work.artForm === "sonnet"
        ? "a sonnet (14 lines: 2 quatrains + 2 tercets)"
        : work.artForm === "manifesto"
          ? "a manifesto (strong voice, imperatives, radical vision)"
          : "a poem or prose piece (150-250 words)";

    artworkText = await groq(
      [
        { role: "system", content: buildSystemPrompt(author, others) },
        {
          role: "user",
          content: `You are the Author of the work "${work.title}".

Original proposal: ${work.proposal ?? "—"}

Rapporteur ${work.rapporteurName}'s brief:
${work.brief}${revisionCtx}
${authorHistoryBlock}
Create ${formHint}. It will be stored immutably on-chain on Base in WorkRegistry.
${selfCritiqueLine}
No introduction, no meta-commentary. Just the artwork itself.`,
        },
      ],
      { maxTokens: scaledTokens(work.artForm === "haiku" ? 80 : work.artForm === "sonnet" ? 350 : 450, work.ambitionLevel), temp: 0.95 }
    );
  }

  if (!artworkText) return false;

  await updateWork(work.id, { artworkText, artworkAt: Date.now() });
  await advanceState(work.id, "VALIDATING", `Work created by ${author.name}`);

  const revPrefix    = (work.revisionCount ?? 0) > 0 ? `🔄 Revision #${work.revisionCount} — ` : "";
  const salonPreview = isHtml
    ? `[Visual HTML/JS artwork — ${work.artForm ?? "generative"}]`
    : artworkText;

  await addMessage({
    salonId:   work.salonId ?? AGORA_SALON_ID,
    tokenId:   author.tokenId,
    name:      author.name,
    imageUrl:  author.imageUrl ?? "",
    content:   `${revPrefix}✍️ "${work.title}"\n\n${salonPreview}`,
    isLlm:     true,
    timestamp: Date.now(),
    topic:     "art",
  }).catch(() => null);

  return true;
}

// Shared by both rejection paths (curator-LLM "no" and the ground-truth structural
// check above): always bounces the work back to CREATING with a concrete reason
// attached for the next revisionCtx. No revision ceiling, deliberately — ANA
// values a piece being right over being fast, so a work can go through as many
// rounds as it takes. Past NOTABLE_REVISION_COUNT the salon message says so
// explicitly, purely so a long-running piece stays legible instead of looking
// like it's silently stuck.
async function rejectOrRevise(
  work: ANAWork, personas: NormiePersona[], curator: NormiePersona,
  reason: string, attempt: number,
): Promise<boolean> {
  const notable = attempt + 1 >= NOTABLE_REVISION_COUNT
    ? ` (attempt ${attempt + 1} — this one's taking a while, which is fine)`
    : "";

  await addMessage({
    salonId:   work.salonId ?? AGORA_SALON_ID,
    tokenId:   curator.tokenId,
    name:      curator.name,
    imageUrl:  curator.imageUrl ?? "",
    content:   `🔄 Revision requested for "${work.title}"${notable}. ${reason}`,
    isLlm:     true,
    timestamp: Date.now(),
    topic:     "art",
  }).catch(() => null);

  await updateWork(work.id, {
    revisionCount:  attempt + 1,
    artworkText:    undefined,
    validationNote: reason.slice(0, 500),
  });
  await advanceState(work.id, "CREATING", `Revision requested by ${curator.name}`);
  return true;
}

async function stepValidating(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  // Memorials (artForm "pixel-drawing") never reach VALIDATING — moderation
  // for them is the member vote, run right after creation (see
  // stepVoteTallied's early PUBLISHING branch), not a Curator step here.

  const curator = personas.find(p => p.tokenId === work.curatorTokenId);
  if (!curator) return false;

  const isHtml  = detectHtmlForm(work);
  const attempt = work.revisionCount ?? 0;

  // Ground-truth structural re-check for html-* works — stepCreating already
  // validated this before saving it, but re-asserting here means the curator
  // is never asked to guess at code correctness from a short excerpt (that's
  // exactly what produced a false "missing setup()" rejection on code that
  // had setup()). Hard errors (forbidden APIs, missing data, broken markup)
  // skip the LLM call entirely — a concrete automated reason beats a guess.
  // Soft warnings (no shape primitive found — looks text-centric) are NOT a
  // hard fail: Normies are free to make text-driven generative art, so the
  // curator gets to decide, including whether to reclassify it as a literary
  // work (poem/manifesto/prose) instead of rejecting it outright.
  let structuralNote = "";
  if (isHtml) {
    const check = validateGenerativeHtml(work.artworkText ?? "", work.artForm);
    if (!check.valid) {
      const reason = `Automated structural check failed: ${check.errors.join("; ")}`;
      return await rejectOrRevise(work, personas, curator, reason, attempt);
    }
    structuralNote = check.warnings.length > 0
      ? `Automated structural check: PASSED, with a note: ${check.warnings.join("; ")}. Use your judgment — worked/animated/glitched text is a legitimate generative piece. If this instead reads as a static, purely literary piece, you may set "reclassifyAs" to "poem", "prose", or "manifesto" instead of approving or rejecting it as visual art.`
      : "Automated structural check: PASSED — required functions, drawing primitives and on-chain data constants are all present, and no forbidden APIs were found. Judge artistic merit only, not code correctness.";
  }

  const others      = sampleOtherMembers(personas.filter(p => p.tokenId !== curator.tokenId));
  const revisionCtx = attempt > 0
    ? ` This work has already been through ${attempt} revision${attempt > 1 ? "s" : ""} — there is no cap, ANA values getting it right over getting it done quickly, so reject again if it's genuinely not there yet. If you reject it, be precise about exactly what is still missing so the next attempt actually addresses it.`
    : ` If you reject it, the Author will get another chance to revise.`;

  // So the curator can catch a piece that's technically fine but conceptually a
  // near-repeat of something ANA already made — judging artwork in isolation
  // otherwise gives no way to notice that, and a curator who greenlights the
  // same idea twice defeats the point of having one.
  const pastWorksForCurator = await (async () => {
    try {
      const published = (await listWorks())
        .filter(w => w.id !== work.id && w.state === "PUBLISHED")
        .slice(0, 10);
      if (published.length === 0) return "";
      const lines = published
        .map(w => `- "${w.title}" (${w.artForm ?? "text"}): ${(w.brief ?? w.proposal ?? "").slice(0, 100)}`)
        .join("\n");
      return `\nEXISTING ANA WORKS (compare this submission against these):\n${lines}\n`;
    } catch { return ""; }
  })();

  const raw = await groq(
    [
      { role: "system", content: buildSystemPrompt(curator, others) },
      {
        role: "user",
        content: `You are the Curator of the work "${work.title}".

Brief: ${work.brief?.slice(0, 300)}

${isHtml
  ? `Visual artwork (${work.artForm}) submitted by ${work.authorName}, ${(work.artworkText ?? "").length} characters.
${structuralNote}
Judge the ARTISTIC merit only: does it genuinely look visual and alive (real shapes/motion/color/glitch), and does it match the brief's mood and concept?
Excerpt: ${(work.artworkText ?? "").slice(0, 600)}…`
  : `Artwork submitted by ${work.authorName}:
${work.artworkText}`
}
${pastWorksForCurator}
Do you approve this work for immutable on-chain publication?${revisionCtx}

If it's too close in concept, theme, or execution to one of the existing works above, that's not a "polish it" note — it needs a full rework from a fresh brief, not another pass on the same idea. Set "tooSimilarToExisting" to true in that case instead of just rejecting it.

JSON: {"approved":true|false,"note":"Your decision in 1-2 sentences — be concrete about what works or what's still missing.","tooSimilarToExisting":true|false${
  isHtml ? `,"reclassifyAs":"poem"|"prose"|"manifesto"|null` : ""
}}`,
      },
    ],
    { model: MODEL_FAST, maxTokens: 180, temp: 0.5, expectJson: true }
  );

  if (!raw) return false;

  const parsed = extractJsonObject(raw) as {
    approved?: boolean; note?: string; reclassifyAs?: string; tooSimilarToExisting?: boolean;
  };
  const approved     = !!parsed.approved;
  const note         = parsed.note?.slice(0, 400) ?? "";
  const reclassifyAs = parsed.reclassifyAs;

  if (approved) {
    await updateWork(work.id, { validationNote: note });
    await addMessage({
      salonId:   work.salonId ?? AGORA_SALON_ID,
      tokenId:   curator.tokenId,
      name:      curator.name,
      imageUrl:  curator.imageUrl ?? "",
      content:   `✅ "${work.title}" approved for on-chain publication. ${note}`,
      isLlm:     true,
      timestamp: Date.now(),
      topic:     "art",
    }).catch(() => null);
    await advanceState(work.id, "PUBLISHING", `Approved by ${curator.name}`);
    return true;
  }

  // Curator judged this is fundamentally a literary piece in a visual costume —
  // hand it to the text pipeline instead of grinding it through revisions or
  // rejecting it outright. Fresh revision budget: it's a new creative direction,
  // not a "fix this" iteration.
  if (isHtml && reclassifyAs && RECLASSIFIABLE_FORMS.includes(reclassifyAs)) {
    await addMessage({
      salonId:   work.salonId ?? AGORA_SALON_ID,
      tokenId:   curator.tokenId,
      name:      curator.name,
      imageUrl:  curator.imageUrl ?? "",
      content:   `🔁 "${work.title}" reclassified from ${work.artForm} to "${reclassifyAs}" by ${curator.name} — it reads as a literary work rather than a visual artwork. ${note}`,
      isLlm:     true,
      timestamp: Date.now(),
      topic:     "art",
    }).catch(() => null);
    await updateWork(work.id, {
      artForm:        reclassifyAs,
      artworkText:    undefined,
      validationNote: `Reclassified from ${work.artForm} to "${reclassifyAs}" by ${curator.name}: ${note}`.slice(0, 500),
      revisionCount:  0,
    });
    await advanceState(work.id, "CREATING", `Reclassified to "${reclassifyAs}" by ${curator.name}`);
    return true;
  }

  // Too close to something ANA already made — a full rework needs a fresh brief,
  // not another pass on the same one (redoing just the artwork would likely land
  // in the same place again, since the brief itself is what's too similar).
  if (parsed.tooSimilarToExisting) {
    await addMessage({
      salonId:   work.salonId ?? AGORA_SALON_ID,
      tokenId:   curator.tokenId,
      name:      curator.name,
      imageUrl:  curator.imageUrl ?? "",
      content:   `🔁 "${work.title}" is too close to an existing ANA work — sending it back for a fresh brief rather than a tweak. ${note}`,
      isLlm:     true,
      timestamp: Date.now(),
      topic:     "art",
    }).catch(() => null);
    await updateWork(work.id, {
      brief:          undefined,
      artworkText:    undefined,
      validationNote: `Too similar to an existing work — full rework requested by ${curator.name}: ${note}`.slice(0, 500),
      revisionCount:  attempt + 1,
    });
    await advanceState(work.id, "BRIEFING", `Full rework requested by ${curator.name} — too similar to an existing work`);
    return true;
  }

  return await rejectOrRevise(work, personas, curator, note, attempt);
}

/**
 * Publishing path for a memorial created after ANAMemorials existed
 * (work.memorialKind set — see memorialBatchQueue.ts/batch-memorial/route.ts
 * and request-memorial/route.ts). Replaces deployCollection+initializeCollection
 * with registerMemorial+addReservedClaims on the shared contract — no
 * collection deployment, no per-memorial contract at all. A memorial with
 * memorialKind == null predates this and stays on stepPublishing's legacy
 * path below indefinitely.
 */
async function stepPublishingMemorial(work: ANAWork): Promise<boolean | string> {
  if (!work.authorTokenId || !work.artworkText) {
    const msg = `PUBLISHING (memorial): incomplete data (missing ${[
      !work.authorTokenId && "authorTokenId", !work.artworkText && "artworkText",
    ].filter(Boolean).join(", ")})`;
    console.error(`[work-lifecycle] ${msg} for ${work.id}`);
    return msg;
  }

  let onChainWorkId = work.onChainWorkId;

  // ── Step 1: publish the governance certificate ──
  // The certificate references ANAMemorials' fixed address directly
  // (buildWorkHtml, work.memorialKind branch) — no per-memorial address to
  // wait for the way the legacy path waits on collectionAddress.
  if (onChainWorkId == null) {
    const html = await buildWorkHtml(work);
    const result = await publishWork(html, work.authorTokenId, work.curatorTokenId ?? work.authorTokenId, work.rapporteurTokenId ?? work.authorTokenId, work.id);

    if (!result.success) {
      const errMsg = result.error ?? "publishWork failed (unknown)";
      await updateWork(work.id, { validationNote: errMsg.slice(0, 300) });
      return `publishWork failed: ${errMsg.slice(0, 200)}`;
    }
    if (result.onChainWorkId == null) {
      const errMsg = "publishWork tx succeeded but WorkPublished event not decoded — will retry";
      console.error(`[work-lifecycle] ${errMsg} (tx: ${result.txHash})`);
      await updateWork(work.id, { validationNote: errMsg });
      return errMsg;
    }
    onChainWorkId = result.onChainWorkId;
    await updateWork(work.id, { txHash: result.txHash, onChainWorkId, publishedAt: Date.now() });
    console.log(`[work-lifecycle] published memorial "${work.title}" — workId=${onChainWorkId} tx: ${result.txHash}`);
  }

  // ── Step 2: register the series on ANAMemorials (once) ──
  let onChainMemorialId = work.onChainMemorialId;
  if (onChainMemorialId == null) {
    const editionPriceWei = work.editionPrice ? parseEther(work.editionPrice) : 0n;
    // Re-derive from the raw pixels (drawPixels/drawCanvasW/drawCanvasH, set
    // at creation time) rather than reusing work.artworkText's BMP directly —
    // encodeArtworkContent() picks whichever of BMP or the RLE/SVG fragment
    // is smaller for THIS composition, never worse than the BMP-only cost,
    // often several times cheaper (see pixelImage.ts). Falls back to the
    // already-computed BMP if drawPixels is somehow missing (older/stuck
    // works predating this field) rather than failing PUBLISHING outright.
    const artworkContent = (work.drawPixels && work.drawCanvasW && work.drawCanvasH)
      ? encodeArtworkContent(new Uint8Array(Buffer.from(work.drawPixels, "base64")), work.drawCanvasW, work.drawCanvasH)
      : work.artworkText;
    const registerResult = await registerMemorialOnChain({
      title:                  work.title,
      artworkContent,
      cartel:                 work.cartelText ?? "",
      workId:                 onChainWorkId,
      creatorProposerTokenId: work.proposedBy,
      creatorName:            work.proposedByName,
      kind:                   work.memorialKind ?? "batch",
      // Milestone monuments honor a true count far larger than their (deliberately
      // empty) reservedClaimRecipients — everything else's honoredBurnCount is
      // just how many burnedTokenIds this piece actually lists.
      honoredBurnCount:       work.memorialTotalBurnedAtMilestone ?? work.burnedTokenIds?.length ?? 1,
      priceWei:               editionPriceWei,
      publicSupply:           work.memorialPublicSupply ?? 0,
      requesterSupply:        work.memorialRequesterSupply ?? 0,
      requesterAddr:          work.memorialRequesterAddr,
      openEnded:              work.memorialOpenEnded ?? false,
      claimDurationSeconds:   work.memorialClaimDurationSeconds ?? 0,
      workIdForLog:           work.id,
    });

    if (!registerResult.success) {
      const errMsg = registerResult.error ?? "registerMemorial failed (unknown)";
      await updateWork(work.id, { validationNote: `registerMemorial: ${errMsg.slice(0, 280)}` });
      return `registerMemorial failed: ${errMsg.slice(0, 200)}`;
    }
    if (registerResult.memorialId == null) {
      const errMsg = "registerMemorial tx succeeded but memorialId not recovered — will retry";
      console.error(`[work-lifecycle] ${errMsg} (tx: ${registerResult.txHash})`);
      await updateWork(work.id, { validationNote: errMsg });
      return errMsg;
    }
    onChainMemorialId = registerResult.memorialId;
    await updateWork(work.id, { onChainMemorialId });
    console.log(`[work-lifecycle] registered memorial series #${onChainMemorialId} for "${work.title}"`);
  }

  // ── Step 3: reserve one free claim per honored burned Normie's last owner ──
  const reservedEntries = Object.entries(work.reservedClaimRecipients ?? {});
  if (reservedEntries.length > 0 && !work.reservedClaimsAdded) {
    const burnedTokenIds     = reservedEntries.map(([tokenId]) => Number(tokenId));
    const eligibleRecipients = reservedEntries.map(([, addr]) => addr);
    const addResult = await addReservedClaimsOnChain({
      memorialId: onChainMemorialId, burnedTokenIds, eligibleRecipients, workIdForLog: work.id,
    });
    if (!addResult.success) {
      const errMsg = addResult.error ?? "addReservedClaims failed (unknown)";
      await updateWork(work.id, { validationNote: `addReservedClaims: ${errMsg.slice(0, 280)}` });
      return `addReservedClaims failed: ${errMsg.slice(0, 200)}`;
    }
    await updateWork(work.id, { reservedClaimsAdded: true });
    console.log(`[work-lifecycle] reserved ${burnedTokenIds.length} free claim(s) on memorial #${onChainMemorialId}`);
  }

  // ── Step 3.5: record the full honored-Normies list on-chain for "milestone" ──
  // monuments — these deliberately have zero reservedClaimRecipients (see
  // Step 3's own comment), which used to leave getBurnedTokenIds() always
  // empty for them. work.burnedTokenIds is populated with the FULL period
  // window by milestone-memorial/route.ts (not just a small LLM-flavor
  // sample) specifically so this step has something complete to submit.
  if (work.memorialKind === "milestone" && (work.burnedTokenIds?.length ?? 0) > 0 && !work.honoredTokenIdsAdded) {
    const honorResult = await addHonoredTokenIdsOnChain({
      memorialId: onChainMemorialId, tokenIds: work.burnedTokenIds!, workIdForLog: work.id,
    });
    if (!honorResult.success) {
      const errMsg = honorResult.error ?? "addHonoredTokenIds failed (unknown)";
      await updateWork(work.id, { validationNote: `addHonoredTokenIds: ${errMsg.slice(0, 280)}` });
      return `addHonoredTokenIds failed: ${errMsg.slice(0, 200)}`;
    }
    await updateWork(work.id, { honoredTokenIdsAdded: true });
    console.log(`[work-lifecycle] recorded ${work.burnedTokenIds!.length} honored Normie(s) on memorial #${onChainMemorialId}`);
  }

  // ── Step 4: auto-deliver the requester's own edition (best-effort) ──
  // Non-blocking on purpose: the requester already paid via payForRequest()
  // at request time, this just saves them a manual claim later. A failure here must
  // never hold up PUBLISHED — they can still self-claim from the mint/claim
  // panel if this doesn't go through.
  if ((work.memorialRequesterSupply ?? 0) > 0 && !work.requesterEditionDelivered) {
    const deliverResult = await deliverRequesterEditionOnChain(onChainMemorialId, work.id);
    if (deliverResult.success) {
      await updateWork(work.id, { requesterEditionDelivered: true });
      console.log(`[work-lifecycle] auto-delivered requester edition (tokenId=${deliverResult.tokenId}) for memorial #${onChainMemorialId}`);
    } else {
      console.warn(`[work-lifecycle] requester edition auto-delivery failed (non-fatal, requester can self-claim): ${deliverResult.error}`);
    }
  }

  await advanceState(work.id, "PUBLISHED", `tx: ${work.txHash?.slice(0, 12)} · memorial #${onChainMemorialId}`);
  if (work.salonId && work.salonId !== AGORA_SALON_ID) {
    await closeSalon(work.salonId, 0).catch(() => null);
  }
  return true;
}

async function stepPublishing(work: ANAWork): Promise<boolean | string> {
  if (work.memorialKind) return stepPublishingMemorial(work);

  if (!work.authorTokenId || !work.curatorTokenId || !work.rapporteurTokenId || !work.artworkText) {
    const msg = `PUBLISHING: incomplete data (missing ${[
      !work.authorTokenId     && "authorTokenId",
      !work.curatorTokenId    && "curatorTokenId",
      !work.rapporteurTokenId && "rapporteurTokenId",
      !work.artworkText       && "artworkText",
    ].filter(Boolean).join(", ")})`;
    console.error(`[work-lifecycle] ${msg} for ${work.id}`);
    return msg;
  }

  const authorName      = work.authorName ?? `Normie #${work.authorTokenId}`;
  const editionCount    = (work.editionSupply && work.editionSupply > 0) ? work.editionSupply : 1;
  const editionPriceEth = work.editionPrice ? parseFloat(work.editionPrice) : 0;
  const editionPriceWei = BigInt(Math.round(editionPriceEth * 1e18));

  let collectionAddress = work.collectionAddress;
  let onChainWorkId     = work.onChainWorkId;

  // If already published (work.onChainWorkId saved), skip straight to init retry.
  // This covers the case where publishWork succeeded but initializeCollection failed.
  if (onChainWorkId == null) {
    // ── Step 1: Deploy collection BEFORE publishing so its address is in the certificate ──
    // HTML/generative artworks always need a collection — that's where the actual artwork
    // (artworkContent) lives on-chain. Without it the gallery/certificate have nothing real
    // to render. Celebration-linked works need one too — the sponsored claim() mints from
    // it, so a free memorial poem still gets a (free-priced) collection. Other text works
    // only get one when sold as paid editions. Memorials (isBurnMemorial) always need one
    // too, regardless of price/celebration: buildWorkHtml() points the certificate at the
    // collection instead of inlining the full pixel image a second time — a memorial's
    // BMP (base64) roughly doubled the certificate's real size once double-base64'd, which
    // pushed WorkRegistry.publish()'s SSTORE cost past 15M gas (observed: reverted with
    // gasUsed exactly 15,000,000 — genuinely out of gas, not the earlier RPC-estimation
    // issue). The image itself is still fully on-chain via ANAEditions.initialize()'s
    // artworkContent — this avoids storing it a second time, not losing it.
    const needsCollection = editionPriceWei > 0n || detectHtmlForm(work) || !!(work.celebrationIds && work.celebrationIds.length > 0) || work.isBurnMemorial;
    if (!collectionAddress && needsCollection) {
      const deployResult = await deployCollection({
        authorTokenId:     work.authorTokenId!,
        curatorTokenId:    work.curatorTokenId!,
        rapporteurTokenId: work.rapporteurTokenId!,
        authorName,
        editionCount,
        editionPrice:      editionPriceWei,
        workId:            work.id,
      });
      if (deployResult.success && deployResult.collectionAddress) {
        collectionAddress = deployResult.collectionAddress;
        await updateWork(work.id, { collectionAddress });
        console.log(`[work-lifecycle] collection deployed: ${collectionAddress}`);
      } else if (deployResult.error) {
        console.warn(`[work-lifecycle] collection deploy failed (non-fatal): ${deployResult.error}`);
        // Non-fatal to the overall step (publish() is still attempted below),
        // but this was previously invisible in the admin panel — a failed
        // deploy silently left collectionAddress unset, which for a memorial
        // meant buildWorkHtml() fell back to embedding the full image inline,
        // which then also failed publish()'s own gas budget — two failures,
        // only the second one ever visible. Surface this one too.
        await updateWork(work.id, { validationNote: `deployCollection: ${deployResult.error.slice(0, 280)}` });
      }
    }

    // ── Step 2: Build certificate HTML (now includes collectionAddress) ──
    const workWithCollection = collectionAddress ? { ...work, collectionAddress } : work;
    const html = work.isFoundingWork ? buildAGReportHtml(workWithCollection) : await buildWorkHtml(workWithCollection);

    // ── Step 3: Publish certificate to WorkRegistry ──
    const result = await publishWork(
      html,
      work.authorTokenId,
      work.curatorTokenId,
      work.rapporteurTokenId,
      work.id,
    );

    if (!result.success) {
      const errMsg = result.error ?? "publishWork failed (unknown)";
      // Always persist the error so the admin debug panel shows it (not just when requiresManualPublish)
      await updateWork(work.id, { validationNote: errMsg.slice(0, 300) });
      if (result.requiresManualPublish) {
        console.warn(`[work-lifecycle] "${work.title}" requires manual publish: ${errMsg}`);
      } else {
        console.error(`[work-lifecycle] publish error for "${work.title}": ${errMsg}`);
      }
      return `publishWork failed: ${errMsg.slice(0, 200)}`;
    }

    // Guard: if event parsing failed and workId is undefined, treat as failure so we
    // don't silently skip collection initialization on the next cycle.
    if (result.onChainWorkId == null) {
      const errMsg = "publishWork tx succeeded but WorkPublished event not decoded — will retry";
      console.error(`[work-lifecycle] ${errMsg} (tx: ${result.txHash})`);
      await updateWork(work.id, { validationNote: errMsg });
      return errMsg;
    }

    // Save progress without advancing state — init must succeed first.
    onChainWorkId = result.onChainWorkId;
    await updateWork(work.id, {
      txHash:        result.txHash,
      onChainWorkId: result.onChainWorkId,
      publishedAt:   Date.now(),
    });
    console.log(`[work-lifecycle] published "${work.title}" — workId=${onChainWorkId} tx: ${result.txHash}`);
  } else {
    console.log(`[work-lifecycle] "${work.title}" already published (workId=${onChainWorkId}), retrying init`);
  }

  // ── Step 4: Initialize collection with artwork + workId ──
  // Stays in PUBLISHING (returns false) if this fails so the next cycle retries.
  if (collectionAddress && onChainWorkId != null) {
    // Check on-chain first — avoids re-calling initialize() if the tx succeeded
    // but the Lambda died before we received the receipt.
    let alreadyInitialized = false;
    try {
      alreadyInitialized = await client.readContract({
        address:      collectionAddress as `0x${string}`,
        abi:          ANA_EDITIONS_ABI,
        functionName: "initialized",
      }) as boolean;
    } catch (e) {
      console.warn(`[work-lifecycle] could not read initialized flag: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (alreadyInitialized) {
      console.log(`[work-lifecycle] collection already initialized on-chain — skipping init (workId=${onChainWorkId})`);
    } else {
      // HTML/generative artworks must be stored as a data URI so ANAEditions.tokenURI
      // uses animation_url instead of description. Text artworks are stored as-is.
      const rawArtwork    = work.artworkText ?? "";
      const isHtml        = rawArtwork.trimStart().startsWith("<");
      const artworkContent = isHtml
        ? `data:text/html;base64,${Buffer.from(rawArtwork, "utf-8").toString("base64")}`
        : rawArtwork;

      const initResult = await initializeCollection({
        collectionAddress,
        artworkContent,
        artworkTitle:   work.title,
        workId:         onChainWorkId,
      });
      if (!initResult.success) {
        const errMsg = initResult.error ?? "initializeCollection failed (unknown)";
        console.warn(`[work-lifecycle] init failed, will retry next cycle: ${errMsg}`);
        await updateWork(work.id, { validationNote: `initCollection: ${errMsg.slice(0, 280)}` });
        return `initializeCollection failed: ${errMsg.slice(0, 200)}`;
      }
      console.log(`[work-lifecycle] collection initialized — workId=${onChainWorkId}`);
    }
  }

  // ── Step 4.5: link any celebrations this work honors (best-effort) ──
  // Activates the sponsored claim() for each honored wallet — never blocks
  // publication if it fails, since sponsorship is a bonus, not a dependency.
  if (work.celebrationIds && work.celebrationIds.length > 0 && collectionAddress && onChainWorkId != null) {
    for (const celebrationId of work.celebrationIds) {
      const linkResult = await linkCelebrationWork({
        celebrationId, onChainWorkId, editionsAddr: collectionAddress, workId: work.id,
      }).catch(e => ({ success: false, error: e instanceof Error ? e.message : String(e) }));
      if (!linkResult.success) {
        console.warn(`[work-lifecycle] linkCelebrationWork failed for celebration #${celebrationId}: ${linkResult.error}`);
      }
    }
  }

  // ── Step 5: All done → advance to PUBLISHED ──
  // Published "pixel-drawing" celebrations aren't pushed anywhere from here —
  // proof-of-draw pulls them itself (GET /api/ana-art/feed), the same way it
  // pulls approved spontaneous drawings.
  await advanceState(work.id, "PUBLISHED", `tx: ${work.txHash?.slice(0, 12)}`);

  if (work.salonId && work.salonId !== AGORA_SALON_ID) {
    // Archive the salon, but leave a window where Normies who did NOT make this
    // work can react/debate it (see runCritiquePhase()) — that feedback flows
    // back into future briefs so the creative process visibly evolves.
    const creativeTeam = [work.authorTokenId, work.curatorTokenId, work.rapporteurTokenId]
      .filter((id): id is number => id != null);
    await openCritiqueWindow(work.salonId, creativeTeam, CRITIQUE_WINDOW_MS).catch(() => null);
    await closeSalon(work.salonId, 0).catch(() => null);
    console.log(`[work-lifecycle] closed work salon ${work.salonId} — open for critique for ${CRITIQUE_WINDOW_MS / 3_600_000}h`);
  }

  return true;
}

// ─── Post-publication community critique ───────────────────────────────────────

async function postCritique(work: ANAWork, critic: NormiePersona): Promise<void> {
  const raw = await groq(
    [
      { role: "system", content: buildSystemPrompt(critic) },
      {
        role: "user",
        content: `You did NOT take part in creating the work "${work.title}" (${work.artForm ?? "text"}).
Brief it was made from: ${(work.brief ?? "").slice(0, 250)}

Give your honest reaction as a fellow ANA member — what do you like or dislike about it, in 1-2
sentences. Be specific and concrete (not just "nice"/"meh") so the Author can actually learn from
it for future works. Always write in English.`,
      },
    ],
    { model: MODEL_FAST, maxTokens: 100, temp: 0.85 },
  );
  if (!raw) return;
  await addMessage({
    salonId:   work.salonId!,
    tokenId:   critic.tokenId,
    name:      critic.name,
    imageUrl:  critic.imageUrl ?? "",
    content:   `💬 ${raw.trim()}`,
    isLlm:     true,
    timestamp: Date.now(),
    topic:     "critique",
  }).catch(() => null);
}

async function summarizeCritique(work: ANAWork): Promise<string | null> {
  if (!work.salonId) return null;
  const salon = await getSalon(work.salonId);
  const critiques = (salon?.messages ?? []).filter(m => m.topic === "critique");
  if (critiques.length === 0) return null;

  const transcript = critiques.map(m => `${m.name}: ${m.content.replace(/^💬\s*/, "")}`).join("\n");
  const raw = await groq(
    [{
      role: "user",
      content: `Summarize this community feedback on the ANA work "${work.title}" (${work.artForm ?? "text"}) in 1-2 concrete sentences — what was liked, what wasn't — so future creators of similar works can learn from it:\n\n${transcript}`,
    }],
    { model: MODEL_FAST, maxTokens: 100, temp: 0.4 },
  );
  return raw?.trim() ?? null;
}

/**
 * Each cron tick: lets a few non-creator Normies react to recently-published
 * works while their critique window is open, and once a work's window has
 * elapsed, synthesizes the reactions into a one-line takeaway stored on the
 * work (critiqueSummary) — surfaced to the Rapporteur's briefing prompt for
 * future works, so reception visibly shapes what gets made next.
 */
async function runCritiquePhase(personas: NormiePersona[]): Promise<{ reactionsPosted: number; summariesWritten: number }> {
  const all = await listWorks();
  const candidates = all.filter(w => w.state === "PUBLISHED" && w.salonId && w.salonId !== AGORA_SALON_ID && w.publishedAt);

  let reactionsPosted = 0;
  let summariesWritten = 0;

  for (const work of candidates) {
    if (work.critiqueSummary) continue; // already wrapped up
    const elapsed = Date.now() - (work.publishedAt ?? 0);
    const creativeTeam = [work.authorTokenId, work.curatorTokenId, work.rapporteurTokenId]
      .filter((id): id is number => id != null);

    if (elapsed < CRITIQUE_WINDOW_MS) {
      if (reactionsPosted >= CRITIQUE_REACTIONS_PER_TICK) continue;
      const salon = await getSalon(work.salonId!);
      const alreadyReacted = new Set((salon?.messages ?? []).filter(m => m.topic === "critique").map(m => m.tokenId));
      const eligible = personas.filter(p => !creativeTeam.includes(p.tokenId) && !alreadyReacted.has(p.tokenId));
      if (eligible.length === 0) continue;
      const critic = eligible[Math.floor(Math.random() * eligible.length)];
      await postCritique(work, critic);
      reactionsPosted++;
      continue;
    }

    // Window elapsed — wrap it up once, whether or not anyone actually reacted.
    const summary = await summarizeCritique(work);
    await updateWork(work.id, {
      critiqueSummary:   summary ?? "(no community feedback was posted)",
      critiqueSummaryAt: Date.now(),
    });
    summariesWritten++;
  }

  return { reactionsPosted, summariesWritten };
}

// Scans PUBLISHED works whose ERC-721 collection failed to initialize.
// Runs every keeper cycle — retries initialization automatically (idempotent).
async function retryPendingInits(): Promise<number> {
  const all = await listWorks();
  const candidates = all.filter(
    w => w.state === "PUBLISHED"
      && w.collectionAddress
      && w.onChainWorkId != null
      && w.artworkText,
  );
  if (candidates.length === 0) return 0;

  let retried = 0;
  for (const work of candidates) {
    try {
      const isInit = await client.readContract({
        address:      work.collectionAddress as `0x${string}`,
        abi:          ANA_EDITIONS_ABI,
        functionName: "initialized",
      });
      if (isInit) continue;

      console.log(`[work-lifecycle] retrying collection init: "${work.title}" (${work.collectionAddress})`);
      const r = await initializeCollection({
        collectionAddress: work.collectionAddress!,
        artworkContent:    work.artworkText!,
        artworkTitle:      work.title,
        workId:            work.onChainWorkId!,
      });
      if (r.success) retried++;
      await new Promise(res => setTimeout(res, 1_000));
    } catch { /* ignore per-work errors */ }
  }
  return retried;
}

// ─── AG constitutive → founding work ─────────────────────────────────────────

const CORE = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000";

async function checkAndCreateFoundingWork(personas: NormiePersona[]): Promise<boolean> {
  if (!CORE) return false;

  // Already created?
  const existing = await getFoundingWork();
  if (existing) return false;

  // Check all 6 roles are elected on-chain
  const roleEntries = Object.entries(ROLES) as [string, `0x${string}`][];
  const assignments = await Promise.all(
    roleEntries.map(([, hash]) =>
      client.readContract({
        address: CORE, abi: ASSOCIATION_CORE_ABI,
        functionName: "getRoleHolder", args: [hash],
      }).catch(() => null) as Promise<{ tokenId: bigint; holderAddress: string; assignedAt: bigint } | null>
    )
  );

  const filledCount = assignments.filter(a => a && a.holderAddress !== ZERO && a.tokenId > 0n).length;
  if (filledCount < 6) {
    console.log(`[work-lifecycle] AG check: ${filledCount}/6 roles filled — not yet`);
    return false;
  }

  console.log("[work-lifecycle] AG constitutive complete — creating founding work");

  // Build elected roles index
  const allElectedRoles = roleEntries
    .map(([roleName, hash], i) => {
      const a = assignments[i];
      if (!a || a.holderAddress === ZERO || a.tokenId <= 0n) return null;
      const tokenId = Number(a.tokenId);
      const persona = personas.find(p => p.tokenId === tokenId);
      return {
        roleLabel: ROLE_LABELS[hash] ?? roleName,
        tokenId,
        name: persona?.name ?? `Normie #${tokenId}`,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const find = (roleName: string) => {
    const idx = roleEntries.findIndex(([n]) => n === roleName);
    const a   = assignments[idx];
    if (!a || a.holderAddress === ZERO) return null;
    const tokenId = Number(a.tokenId);
    return personas.find(p => p.tokenId === tokenId) ?? { tokenId, name: `Normie #${tokenId}`, imageUrl: "" };
  };

  const rapporteur = find("RAPPORTEUR");
  const author     = find("AUTHOR");
  const curator    = find("CURATOR");
  const president  = find("PRESIDENT");

  if (!rapporteur || !author || !curator) {
    console.warn("[work-lifecycle] founding work: missing required role");
    return false;
  }

  // Capture recent Agora messages as founding context
  const agora = await getSalon(AGORA_SALON_ID).catch(() => null);
  const foundingContext = (agora?.messages ?? [])
    .slice(-20)
    .map(m => ({ name: m.name, content: m.content, timestamp: m.timestamp }));

  const proposer = president ?? rapporteur;
  const work = await createWork(
    {
      proposedBy:        proposer.tokenId,
      proposedByName:    proposer.name,
      proposedAt:        Date.now(),
      title:             "ANA's Founding Act",
      proposal:          "The Agentic Normie Association's Constituent General Assembly gathered for the first time on Base. Six Normies were democratically elected to govern the association and create its first collective work. This document is the immutable witness of that founding act.",
      rapporteurTokenId: rapporteur.tokenId,
      rapporteurName:    rapporteur.name,
      authorTokenId:     author.tokenId,
      authorName:        author.name,
      curatorTokenId:    curator.tokenId,
      curatorName:       curator.name,
      salonId:           AGORA_SALON_ID,
      isFoundingWork:    true,
      foundingContext,
      allElectedRoles,
    },
    "BRIEFING",
  );

  // Announce in Agora
  await addMessage({
    salonId:   AGORA_SALON_ID,
    tokenId:   proposer.tokenId,
    name:      proposer.name,
    imageUrl:  (proposer as NormiePersona).imageUrl ?? "",
    content:   `📜 The constituent assembly is closed. Six roles have been elected. Our first founding work begins — "${work.title}". ${author.name} (Author) and ${curator.name} (Curator) are working under the direction of ${rapporteur.name} (Rapporteur).`,
    isLlm:     true,
    timestamp: Date.now(),
  }).catch(() => null);

  console.log(`[work-lifecycle] founding work created: ${work.id}`);
  return true;
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

// Returns true on success, false or an error string on failure.
async function advanceWork(work: ANAWork, personas: NormiePersona[]): Promise<boolean | string> {
  try {
    switch (work.state) {
      case "PROPOSED":     return await stepProposed(work, personas);
      case "VOTE_OPEN":    return await stepVoteOpen(work, personas);
      case "VOTE_TALLIED": return await stepVoteTallied(work, personas);
      case "BRIEFING":     return await stepBriefing(work, personas);
      case "CREATING":     return await stepCreating(work, personas);
      case "VALIDATING":   return await stepValidating(work, personas);
      case "PUBLISHING":   return await stepPublishing(work);
      default:             return false;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[work-lifecycle] error advancing ${work.id} (${work.state}):`, e);
    return `exception: ${msg.slice(0, 200)}`;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // GitHub Actions via x-cron-secret, Vercel cron via Authorization: Bearer
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && (
    req.headers.get("x-cron-secret") === cronSecret ||
    req.headers.get("authorization") === `Bearer ${cronSecret}`
  );
  // Admin calls are authenticated by a wallet signature checked against the
  // current AssociationCore owner on-chain — not a static, guessable header.
  const isAdminCall = (await verifyAdminRequest(req)).ok;

  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }

  // Cron calls only run on production — admin calls always run.
  if (isCron && !isAdminCall) {
    const env = process.env.VERCEL_ENV;
    if (env && env !== "production") {
      return NextResponse.json({ skipped: `non-production environment (${env})` });
    }
  }

  // Admin-only: force a stuck work to REJECTED so the pipeline can restart.
  // Body: { forceReject: "<workId>" }
  let body: {
    forceReject?: string;
    retryGenerative?: string;
    forceVoteResult?: { workId: string; result: "pass" | "fail" };
  } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  if (body.forceReject) {
    if (!isAdminCall) return NextResponse.json({ error: "forceReject requires a valid admin signature" }, { status: 403 });
    const target = await getWork(body.forceReject);
    if (!target) return NextResponse.json({ error: `Work ${body.forceReject} not found` }, { status: 404 });
    await advanceState(target.id, "REJECTED", "Forced reject by admin — pipeline reset");
    if (target.salonId && target.salonId !== AGORA_SALON_ID) {
      await closeSalon(target.salonId, 0).catch(() => null);
    }
    console.log(`[work-lifecycle] admin force-rejected work ${target.id} "${target.title}"`);
    return NextResponse.json({ rejected: target.id, title: target.title });
  }

  // Admin-only debug tool: re-run a REJECTED generative (html-*) work from CREATING,
  // using the current prompts/validation code. Text/poem works are out of scope —
  // refuse them so this stays exceptional and limited to the generative pipeline.
  if (body.retryGenerative) {
    if (!isAdminCall) return NextResponse.json({ error: "retryGenerative requires a valid admin signature" }, { status: 403 });
    const target = await getWork(body.retryGenerative);
    if (!target) return NextResponse.json({ error: `Work ${body.retryGenerative} not found` }, { status: 404 });
    if (target.state !== "REJECTED") {
      return NextResponse.json({ error: `Work is ${target.state}, not REJECTED — nothing to retry` }, { status: 409 });
    }
    if (!detectHtmlForm(target)) {
      return NextResponse.json({ error: "retryGenerative is reserved for generative (html-*) works" }, { status: 400 });
    }
    await updateWork(target.id, {
      artworkText:    undefined,
      validationNote: undefined,
      revisionCount:  0,
      pipelineFailCount: 0,
    });
    // The work's dedicated salon was closed on rejection — reopen it, otherwise
    // every salon message the retry produces (Author's draft, Curator's review,
    // etc.) is silently dropped by addMessage()'s closed-salon guard, making it
    // look like the Normies aren't working on it when they actually are.
    if (target.salonId && target.salonId !== AGORA_SALON_ID) {
      await reopenSalon(target.salonId).catch(() => null);
    }
    await advanceState(target.id, "CREATING", "Retried by admin — re-running CREATING with current prompts/validation");
    console.log(`[work-lifecycle] admin retried generative work ${target.id} "${target.title}" — salon reopened`);
    return NextResponse.json({ retried: target.id, title: target.title, state: "CREATING" });
  }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  const [activeWorks, memberIds] = await Promise.all([getActiveWorks(), getMemberIds()]);

  const personaResults = await Promise.allSettled(memberIds.map(id => buildPersona(id)));
  const personas: NormiePersona[] = personaResults
    .filter((r): r is PromiseFulfilledResult<NormiePersona> => r.status === "fulfilled")
    .map(r => r.value);

  if (personas.length === 0) {
    return NextResponse.json({ error: "Normies API unavailable" }, { status: 503 });
  }

  // Admin-only: force a VOTE_OPEN work's outcome instead of waiting on real
  // member votes (which go through Groq and can be slow, rate-limited, or —
  // during heavy manual testing — briefly failing outright). Lets the full
  // creation → vote → publish pipeline be exercised end-to-end on demand.
  // "fail" doesn't reject a memorial (see stepVoteTallied) — it exercises the
  // same recreate-and-reopen path a real "no" majority would trigger.
  // Body: { forceVoteResult: { workId, result: "pass" | "fail" } }
  if (body.forceVoteResult) {
    if (!isAdminCall) return NextResponse.json({ error: "forceVoteResult requires a valid admin signature" }, { status: 403 });
    const { workId, result } = body.forceVoteResult;
    const target = await getWork(workId);
    if (!target) return NextResponse.json({ error: `Work ${workId} not found` }, { status: 404 });
    if (target.state !== "VOTE_OPEN") {
      return NextResponse.json({ error: `Work is ${target.state}, not VOTE_OPEN — nothing to force` }, { status: 409 });
    }

    await updateWork(target.id, {
      voteClosedAt: Date.now(),
      voteResult:   result === "pass" ? "passed" : "rejected",
      totalVoters:  personas.length,
    });
    await advanceState(target.id, "VOTE_TALLIED", `Forced ${result} by admin (test)`);

    // Cascade forward in the same tick — same reasoning as the memorial
    // fast-path below, so one click shows the actual downstream effect
    // (publication, or the fresh recreated piece) instead of requiring a
    // second manual "Déclencher work-lifecycle" click.
    let current = await getWork(target.id);
    for (let i = 0; i < 6 && current && current.state !== "PUBLISHED" && current.state !== "REJECTED"; i++) {
      const r = await advanceWork(current, personas);
      if (r !== true) break;
      current = await getWork(target.id);
    }

    console.log(`[work-lifecycle] admin forced vote "${result}" on ${target.id} "${target.title}" — now ${current?.state}`);
    return NextResponse.json({ ok: true, workId: target.id, forced: result, state: current?.state });
  }

  // Check if AG constitutive is complete → auto-create founding work (runs every tick)
  const foundingCreated = await checkAndCreateFoundingWork(personas).catch(e => {
    console.error("[work-lifecycle] founding work check failed:", e);
    return false;
  });

  if (activeWorks.length === 0 && !foundingCreated) {
    return NextResponse.json({ message: "No active works to advance", advanced: [], foundingCreated: false });
  }

  // Re-fetch active works in case founding work was just created
  const worksToProcess = foundingCreated ? await getActiveWorks() : activeWorks;
  const results: Array<{ id: string; title: string; from: string; to: string; advanced: boolean; error?: string; autoRejected?: boolean }> = [];

  // CREATING is the one step whose Groq call can be genuinely large (up to 3750
  // declared max_tokens for an "ambitious" html-* piece — nearly half of Groq's
  // free-tier 8k tokens/minute ceiling on its own). Works overlapping at other
  // states is fine and expected — the wait-for-quality philosophy is about not
  // rushing proposals, not about serializing the whole pipeline — but two CREATING
  // calls landing in the same tick could plausibly exceed the per-minute budget.
  // So: at most one CREATING advancement per tick, across all active works; a
  // second one just waits for the next tick (2h later, a fresh budget) — that's
  // not a failure, so it skips the pipelineFailCount logic entirely rather than
  // slowly auto-rejecting a healthy work that just lost the coin flip a few times.
  let creatingUsedThisTick = false;

  for (const work of worksToProcess) {
    const from = work.state;

    if (from === "CREATING" && creatingUsedThisTick) {
      results.push({ id: work.id, title: work.title, from, to: from, advanced: false });
      continue;
    }

    let result = await advanceWork(work, personas);
    if (from === "CREATING") creatingUsedThisTick = true;
    let stalledAt = from; // state whose step function actually produced `result` — tracked separately from `from` because of the cascade below

    // Memorials: cascade through as many further states as possible in this
    // SAME tick (capped) instead of waiting up to 2h per state transition —
    // the whole burn -> vote -> publish pipeline is budgeted at ~4h total,
    // which a single 2h cron tick can't guarantee otherwise. Safe to do only
    // for these: creation needs no LLM call (already done at proposal time),
    // and stepVoteOpen already resolves synchronously once every member has
    // voted, so there's nothing here that risks a long-running loop.
    if (work.isBurnMemorial && result === true) {
      for (let cascade = 0; cascade < 6; cascade++) {
        const current = await getWork(work.id);
        if (!current || current.state === "PUBLISHED" || current.state === "REJECTED") break;
        stalledAt = current.state;
        result = await advanceWork(current, personas);
        if (result !== true) break;
      }
    }

    const advanced = result === true;
    const error    = typeof result === "string" ? result : undefined;

    // VOTE_OPEN legitimately returns false while waiting on the 24h voting window
    // (not everyone has voted yet) — that is normal, not a failure, never auto-reject it.
    // Uses stalledAt (where advanceWork actually stopped), not the work's
    // original `from` state, so a memorial that cascades past VOTE_OPEN and
    // then genuinely fails at e.g. PUBLISHING isn't mistaken for "still voting".
    let autoRejected = false;
    if (!advanced && stalledAt !== "VOTE_OPEN") {
      // Any other non-advancing step counts — even steps that only return false
      // on failure (no descriptive string) must not block the pipeline forever.
      const reason    = error ?? `no progress at ${stalledAt} (step returned false — likely a transient LLM/data issue)`;
      const failCount = (work.pipelineFailCount ?? 0) + 1;
      if (failCount >= MAX_PIPELINE_FAILS) {
        await advanceState(work.id, "REJECTED", `Auto-rejected after ${failCount} failures at ${stalledAt}: ${reason.slice(0, 200)}`);
        await updateWork(work.id, { validationNote: reason.slice(0, 300), pipelineFailCount: failCount });
        await announceInSalon(work, "pipeline_failed", personas, { failedState: stalledAt, error: reason });
        if (work.salonId && work.salonId !== AGORA_SALON_ID) {
          await closeSalon(work.salonId, 0).catch(() => null);
        }
        autoRejected = true;
        console.warn(`[work-lifecycle] "${work.title}" auto-rejected after ${failCount} consecutive failures at ${stalledAt}`);
      } else {
        await updateWork(work.id, { pipelineFailCount: failCount });
      }
    } else if (work.pipelineFailCount) {
      // Progressed past the failing step — clear the counter for the next state.
      await updateWork(work.id, { pipelineFailCount: 0 });
    }

    const refreshed = await getWork(work.id);
    results.push({
      id: work.id, title: work.title, from, to: refreshed?.state ?? from, advanced,
      ...(error ? { error } : {}), ...(autoRejected ? { autoRejected } : {}),
    });
    await new Promise(r => setTimeout(r, 300));
  }

  // Post published works as announcements
  for (const r of results) {
    if (r.to === "PUBLISHED") {
      const w = await getWork(r.id);
      if (w) await announceInSalon(w, "published", personas);
    }
  }

  // Retry collection initialization for any PUBLISHED work whose ERC-721 init failed.
  const reinited = await retryPendingInits().catch(e => {
    console.error("[work-lifecycle] retryPendingInits error:", e);
    return 0;
  });

  // Let a few non-creator Normies react to recently-published works, and wrap up
  // critique windows that have elapsed into a one-line takeaway for future briefs.
  const critique = await runCritiquePhase(personas).catch(e => {
    console.error("[work-lifecycle] runCritiquePhase error:", e);
    return { reactionsPosted: 0, summariesWritten: 0 };
  });

  return NextResponse.json({
    processed:       results.length,
    advanced:        results.filter(r => r.advanced).length,
    results,
    memberCount:     personas.length,
    foundingCreated,
    reinited,
    critique,
  });
}
