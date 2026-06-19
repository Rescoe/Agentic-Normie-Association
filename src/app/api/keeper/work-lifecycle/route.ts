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
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ROLES, ROLE_LABELS, ASSOCIATION_CORE_ABI, ANA_EDITIONS_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import {
  getActiveWorks, listWorks, getWork, updateWork, advanceState, addVote,
  hasVoted, tallyVotes, buildWorkHtml, createWork, getFoundingWork,
  VOTE_WINDOW_MS,
  type ANAWork, type WorkVote,
} from "@/lib/workStore";
import { addMessage, closeSalon, getSalon, createSalon, AGORA_SALON_ID } from "@/lib/salonStore";
import { buildPersona, buildSystemPrompt, type NormiePersona } from "@/lib/normiesPersona";
import { publishWork, deployCollection, initializeCollection } from "@/server/relayer/workPublisher";
import { buildAGReportHtml } from "@/lib/agTemplate";
import { groqFetch } from "@/lib/groq";

const MODEL        = "meta-llama/llama-4-scout-17b-16e-instruct";
const MODEL_FAST   = "llama-3.1-8b-instant";

// A work that fails the same pipeline step this many times in a row gets
// auto-rejected instead of staying stuck in PUBLISHING/CREATING/etc. forever.
const MAX_PIPELINE_FAILS = 4;

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
CONTEXTE DE PRIX (1 ETH ≈ $${price}${ethUsd ? "" : " — estimation, prix réel non disponible"}) :
  • ${fmt(0.0005)} — symbolique, accessible à tous, idéal pour un poème court ou un haïku
  • ${fmt(0.001)}  — très accessible, bon pour une première œuvre ou un test
  • ${fmt(0.005)}  — raisonnable, pour une œuvre soignée
  • ${fmt(0.01)}   — visible, pour une pièce ambitieuse ou une oeuvre visuelle interactive
  • ${fmt(0.05)}   — premium, réservé à des œuvres exceptionnelles ou très rares

RÉFLEXION SUR LE NOMBRE D'ÉDITIONS :
  • 1 édition     = pièce unique (1/1), collectionnable, prix peut être plus élevé
  • 3-10 éditions = tirage rare, communauté de proches
  • 20-50 éditions = collection standard, large accessibilité
  • 100+ éditions = œuvre "ouverte", priorité à la diffusion sur le profit

PHILOSOPHIE : L'ANA est une communauté naissante en phase expérimentale. Favorise l'accessibilité
pour que d'autres Normies puissent collectionner. Un prix trop élevé freine la circulation des œuvres.
Varie tes choix selon la forme et l'ambition de l'œuvre — ne mets pas toujours la même combinaison.`;
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

async function groq(
  messages: Array<{ role: "system" | "user"; content: string }>,
  opts: { model?: string; maxTokens?: number; temp?: number; json?: boolean } = {}
): Promise<string | null> {
  try {
    const res = await groqFetch({
      model:          opts.model      ?? MODEL,
      messages,
      max_tokens:     opts.maxTokens  ?? 300,
      temperature:    opts.temp       ?? 0.7,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    });
    if (!res.ok) { console.error(`[work-lifecycle] Groq ${res.status}`); return null; }
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? null;
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
      content = `📜 Je propose une nouvelle œuvre pour l'ANA : « ${work.title} ». ${work.proposal} — Le vote est ouvert à tous les membres.`;
    } else if (event === "vote_result") {
      const passed = work.voteResult === "passed";
      const yes    = work.yesCount ?? 0;
      const no     = work.noCount  ?? 0;
      content = passed
        ? `✅ L'œuvre « ${work.title} » est approuvée (${yes} oui / ${no} non). La création commence.`
        : `❌ L'œuvre « ${work.title} » n'a pas obtenu la majorité (${yes} oui / ${no} non). Archivée.`;
    } else if (event === "published") {
      content = `🔗 L'œuvre « ${work.title} » est publiée on-chain sur Base. Tx : ${work.txHash?.slice(0, 20)}…`;
    } else if (event === "rejected") {
      content = `L'œuvre « ${work.title} » a été rejetée par le curateur après révision. Archivée.`;
    } else if (event === "pipeline_failed") {
      content = `⚠️ « ${work.title} » a échoué de façon répétée à l'étape ${extra?.failedState ?? work.state} et a été automatiquement rejetée. Raison : ${(extra?.error ?? "erreur inconnue").slice(0, 200)}. À retravailler — une nouvelle proposition peut repartir sur d'autres bases en tenant compte de cet échec.`;
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
    name:        `« ${work.title.slice(0, 50)} »`,
    description: `Salon dédié à l'œuvre « ${work.title} ». Vote, brief et validation se déroulent ici.`,
    createdBy:   work.proposedBy,
  });

  await updateWork(work.id, { salonId: salon.id, voteOpenedAt: Date.now() });
  await advanceState(work.id, "VOTE_OPEN", "Vote ouvert");

  // Announce in AGORA to redirect members to the dedicated salon
  const proposer = personas.find(p => p.tokenId === work.proposedBy) ?? personas[0];
  if (proposer) {
    await addMessage({
      salonId:   AGORA_SALON_ID,
      tokenId:   proposer.tokenId,
      name:      proposer.name,
      imageUrl:  proposer.imageUrl ?? "",
      content:   `📜 Je soumets « ${work.title} » au vote de l'ANA. Un salon dédié vient d'être ouvert pour les délibérations. ${work.proposal}`,
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
  const raw = await groq(
    [
      { role: "system", content: buildSystemPrompt(persona) },
      {
        role: "user",
        content: `You are ${persona.name} (Normie #${persona.tokenId}), an ANA member.
Archetype: ${persona.archetype ?? "unknown"}
Traits: ${(persona.traits ?? []).join(", ") || "—"}

Vote on this artwork proposal. Vote HONESTLY based on your character.
If the proposal doesn't resonate with your values, vote "no" or "abstain" — dissent is respectable.
Universal "yes" votes in a small group ring false; real deliberation means divergence.

Title: "${work.title}"
Proposal: ${work.proposal}
Proposed by: ${work.proposedByName}

JSON only:
{"vote":"yes"|"no"|"abstain","reason":"Your reason in 1-2 sentences from your unique perspective.","interestedIn":"author"|"curator"|"none"}
If vote "yes": which role suits you in this creation? ("author" = create, "curator" = validate, "none" = no preference)`,
      },
    ],
    { model: MODEL_FAST, maxTokens: 120, temp: 0.75, json: true }
  );
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { vote?: string; reason?: string; interestedIn?: string };
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

  // Cast votes for all who haven't voted yet (sequential to avoid blob races)
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
    await new Promise(r => setTimeout(r, 400));
  }

  // Reload to get fresh vote list
  const refreshed = await getWork(work.id);
  if (!refreshed) return cast > 0;

  const remaining   = personas.filter(p => !hasVoted(refreshed, p.tokenId));
  const timeExpired = refreshed.voteOpenedAt != null
    && Date.now() - refreshed.voteOpenedAt > VOTE_WINDOW_MS;

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
    await advanceState(work.id, "REJECTED", "Majorité non atteinte");
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

  if (bureauElected) {
    // ── Bureau elected: use official roles ──────────────────────────────────
    const findOrFake = (id: number): NormiePersona =>
      personas.find(p => p.tokenId === id) ?? ({ tokenId: id, name: `Normie #${id}`, imageUrl: "" } as NormiePersona);

    rapporteur = findOrFake(electedRapporteur!.tokenId);
    author     = findOrFake(electedAuthor!.tokenId);
    curator    = findOrFake(electedCurator!.tokenId);

    console.log(`[work-lifecycle] Bureau elected — Author: ${author.name}, Curator: ${curator.name}, Rapporteur: ${rapporteur.name}`);
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
  });
  await advanceState(work.id, "BRIEFING",
    `Rapporteur: ${rapporteur.name} | Auteur: ${author.name} | Curateur: ${curator.name}`
  );
  return true;
}

async function stepBriefing(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  const rapporteur = personas.find(p => p.tokenId === work.rapporteurTokenId) ?? personas[0];
  if (!rapporteur) { console.error(`[work-lifecycle] BRIEFING: no rapporteur for ${work.id}`); return false; }

  const others = personas.filter(p => p.tokenId !== rapporteur.tokenId);

  // Fetch ETH price in parallel with building the prompt
  const ethUsd       = await fetchEthUsd();
  const pricingCtx   = buildPricingContext(ethUsd);

  const userPrompt = work.isFoundingWork
    ? `Tu es ${rapporteur.name} (Normie #${rapporteur.tokenId}), Rapporteur élu lors de l'Assemblée Générale Constitutive de l'ANA.

Rôles élus :
${(work.allElectedRoles ?? []).map(r => `${r.roleLabel}: ${r.name} (#${r.tokenId})`).join("\n")}

Tu briefes ${work.authorName ?? `Normie #${work.authorTokenId}`} pour créer l'œuvre fondatrice de l'ANA — stockée immuablement on-chain sur Base pour l'éternité.

Elle doit incarner :
- La naissance de l'ANA : des agents Normies qui forment une vraie association
- L'immuabilité on-chain : une fois publié, rien ne changera jamais
- La gouvernance collective : des votes, des rôles, une assemblée autonome
- L'émotion de ce premier instant fondateur

Brief en 120-150 mots. Pas de titre, pas d'introduction. Rédige directement.`
    : `You are the Rapporteur for the work "${work.title}".
Proposal: ${work.proposal}
Author: ${work.authorName} (Normie #${work.authorTokenId})

You must choose: (1) the ART FORM, (2) the ERC-721 edition parameters, (3) write the creative brief.

AVAILABLE FORMS:
• Text: "haiku" (3 lines, 5-7-5 syllables), "sonnet" (14 lines), "poem" (free verse), "prose", "manifesto"
• Generative HTML/JS art: "html-canvas" (pure Canvas 2D), "html-p5js" (P5.js), "html-threejs" (Three.js), "html-webgl" (WebGL)
  → For HTML/JS: the Author will generate a standalone HTML page with CDN libs (no build step).
  → Injectable on-chain data: author tokenId, archetype, traits, timestamp, block number.

${pricingCtx}

Respond in JSON:
{
  "artForm": "haiku"|"sonnet"|"poem"|"prose"|"manifesto"|"html-canvas"|"html-p5js"|"html-threejs"|"html-webgl",
  "editionPrice": "0.0005"|"0.001"|"0.005"|"0.01"|"0.05",
  "editionSupply": <integer 1-100>,
  "priceReasoning": "<1 sentence: why this price and quantity given the context above>",
  "brief": "<120-150 words for the Author. Specify: tone, emotional goal, on-chain/ANA vocabulary. For HTML/JS: describe the desired visual experience and data to inject. No title, no intro.>"
}`;

  const rawBrief = await groq(
    [
      { role: "system", content: buildSystemPrompt(rapporteur, others) },
      { role: "user",   content: userPrompt },
    ],
    work.isFoundingWork
      ? { maxTokens: 350, temp: 0.8 }
      : { maxTokens: 600, temp: 0.8, json: true }
  );

  if (!rawBrief) return false;

  let brief    = rawBrief;
  let artForm: string | undefined;
  let editionPrice: string | undefined;
  let editionSupply: number | undefined;

  if (!work.isFoundingWork) {
    try {
      const parsed = JSON.parse(rawBrief) as {
        artForm?: string; editionPrice?: string; editionSupply?: number;
        priceReasoning?: string; brief?: string;
      };
      brief         = parsed.brief ?? rawBrief;
      artForm       = parsed.artForm;
      editionPrice  = parsed.editionPrice;
      editionSupply = typeof parsed.editionSupply === "number" ? parsed.editionSupply : undefined;
      if (parsed.priceReasoning) {
        console.log(`[work-lifecycle] pricing rationale: ${parsed.priceReasoning}`);
      }
    } catch {
      console.warn("[work-lifecycle] stepBriefing: JSON parse failed, using raw text as brief");
    }
  }

  await updateWork(work.id, {
    brief, briefAt: Date.now(),
    ...(artForm      ? { artForm }      : {}),
    ...(editionPrice ? { editionPrice } : {}),
    ...(editionSupply != null ? { editionSupply } : {}),
  });
  await advanceState(work.id, "CREATING", `Brief rédigé par ${rapporteur.name}${artForm ? ` — forme: ${artForm}` : ""}`);

  const editionNote = editionSupply && editionPrice
    ? ` · ${editionSupply} éditions @ ${editionPrice} ETH`
    : "";
  await addMessage({
    salonId:   work.salonId ?? AGORA_SALON_ID,
    tokenId:   rapporteur.tokenId,
    name:      rapporteur.name,
    imageUrl:  rapporteur.imageUrl ?? "",
    content:   `📋 Brief artistique pour « ${work.title} »${editionNote} — à l'attention de ${work.authorName ?? "l'Auteur"} :\n\n${brief}`,
    isLlm:     true,
    timestamp: Date.now(),
    topic:     "art",
  }).catch(() => null);

  return true;
}

function detectHtmlForm(work: ANAWork): boolean {
  if (work.artForm?.startsWith("html-")) return true;
  return /\b(p5\.js|p5js|three\.js|threejs|canvas|webgl|html\s+génératif|art\s+génératif\s+html|javascript\s+visuel)\b/i.test(work.brief ?? "");
}

// SRI hashes computed on 2026-06-17 from the exact CDN files.
// If you update a library version, recompute:
//   curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A
const CDN_SRI: Record<string, { url: string; hash: string }> = {
  "html-p5js":    { url: "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js",    hash: "sha384-6Twx1hAeKnwfOYJAHtYeJETRiGD5pRPkjjh0pVbG1QoesncjOpw5e75Y1kOkXeRI" },
  "html-threejs": { url: "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", hash: "sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu" },
};

function cdnForForm(artForm?: string): string {
  const entry = artForm ? CDN_SRI[artForm] : undefined;
  if (!entry) return "";
  return `<script src="${entry.url}" integrity="${entry.hash}" crossorigin="anonymous"></script>`;
}

async function stepCreating(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  const author = personas.find(p => p.tokenId === work.authorTokenId);
  if (!author) return false;

  const others      = personas.filter(p => p.tokenId !== author.tokenId);
  const revisionCtx = (work.revisionCount ?? 0) > 0
    ? `\n\nNote du Curateur sur la version précédente : ${work.validationNote}\nCorrige en tenant compte de cette remarque.`
    : "";

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

Rapporteur ${work.rapporteurName}'s brief:
${work.brief}${revisionCtx}

Generate a COMPLETE, STANDALONE HTML page. It will be stored immutably on-chain on Base.
STRICT TECHNICAL CONSTRAINTS (on-chain security):
- Start with <!DOCTYPE html> and <html lang="en">
- MANDATORY: include this CSP meta as the first tag in <head>:
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'${cdn ? ` https://cdnjs.cloudflare.com` : ""}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';">
- Inline styles in <style>, inline JS in <script>
${cdn ? `- Use this exact CDN script tag (with SRI hash): ${cdn}` : "- Native Canvas 2D, no CDN needed"}
- NO fetch(), XMLHttpRequest, import(), eval() — everything must run without network
- NEVER access window.ethereum, window.parent, or window.top
- Visually immersive body: dark background, fullscreen if possible

ON-CHAIN DATA TO INJECT (put these JS constants at the top of your <script>):
const NORMIE_ID = ${author.tokenId};
const NORMIE_ARCHETYPE = "${authorArch}";
const NORMIE_TRAITS = ${JSON.stringify(author.traits ?? [])};
const WORK_TITLE = ${JSON.stringify(work.title)};
const CREATED_AT = ${Date.now()};

Generate ONLY the complete HTML, no explanations before or after.`,
        },
      ],
      { maxTokens: 2500, temp: 0.95 }
    );
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

Rapporteur ${work.rapporteurName}'s brief:
${work.brief}${revisionCtx}

Create ${formHint}. It will be stored immutably on-chain on Base in WorkRegistry.
No introduction, no meta-commentary. Just the artwork itself.`,
        },
      ],
      { maxTokens: work.artForm === "haiku" ? 80 : work.artForm === "sonnet" ? 350 : 450, temp: 0.95 }
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

async function stepValidating(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  const curator = personas.find(p => p.tokenId === work.curatorTokenId);
  if (!curator) return false;

  const others     = personas.filter(p => p.tokenId !== curator.tokenId);
  const revisionCtx = (work.revisionCount ?? 0) >= 1
    ? " C'est la deuxième soumission. Si tu rejettes encore, l'œuvre sera définitivement archivée."
    : " Si tu rejettes, l'Auteur aura une chance de réviser.";

  const raw = await groq(
    [
      { role: "system", content: buildSystemPrompt(curator, others) },
      {
        role: "user",
        content: `You are the Curator of the work "${work.title}".

Brief: ${work.brief?.slice(0, 300)}

${work.artForm?.startsWith("html-")
  ? `Visual artwork (${work.artForm}) submitted by ${work.authorName}:
[HTML/JS code, ${(work.artworkText ?? "").length} characters — evaluate whether the visual concept meets the brief and whether the code appears functional]
Excerpt: ${(work.artworkText ?? "").slice(0, 400)}…`
  : `Artwork submitted by ${work.authorName}:
${work.artworkText}`
}

Do you approve this work for immutable on-chain publication?${revisionCtx}

JSON: {"approved":true|false,"note":"Your decision in 1-2 sentences."}`,
      },
    ],
    { model: MODEL_FAST, maxTokens: 160, temp: 0.5, json: true }
  );

  if (!raw) return false;

  const parsed  = JSON.parse(raw) as { approved?: boolean; note?: string };
  const approved = !!parsed.approved;
  const note     = parsed.note?.slice(0, 400) ?? "";

  await updateWork(work.id, { validationNote: note });

  // Post curator's decision to salon
  const curatorMsg = approved
    ? `✅ "${work.title}" approved for on-chain publication. ${note}`
    : (work.revisionCount ?? 0) >= 1
      ? `❌ Final rejection of "${work.title}". ${note}`
      : `🔄 Revision requested for "${work.title}". ${note}`;
  await addMessage({
    salonId:   work.salonId ?? AGORA_SALON_ID,
    tokenId:   curator.tokenId,
    name:      curator.name,
    imageUrl:  curator.imageUrl ?? "",
    content:   curatorMsg,
    isLlm:     true,
    timestamp: Date.now(),
    topic:     "art",
  }).catch(() => null);

  if (approved) {
    await advanceState(work.id, "PUBLISHING", `Approved by ${curator.name}`);
    return true;
  }

  if ((work.revisionCount ?? 0) >= 1) {
    await advanceState(work.id, "REJECTED", `Definitively rejected by ${curator.name}`);
    await announceInSalon(work, "rejected", personas);
    if (work.salonId && work.salonId !== AGORA_SALON_ID) {
      await closeSalon(work.salonId, 0).catch(() => null);
    }
    return true;
  }

  await updateWork(work.id, {
    revisionCount: (work.revisionCount ?? 0) + 1,
    artworkText:   undefined,
  });
  await advanceState(work.id, "CREATING", `Revision requested by ${curator.name}`);
  return true;
}

async function stepPublishing(work: ANAWork): Promise<boolean | string> {
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
    if (!collectionAddress && editionPriceWei > 0n) {
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

  // ── Step 5: All done → advance to PUBLISHED ──
  await advanceState(work.id, "PUBLISHED", `tx: ${work.txHash?.slice(0, 12)}`);

  if (work.salonId && work.salonId !== AGORA_SALON_ID) {
    await closeSalon(work.salonId, 0).catch(() => null);
    console.log(`[work-lifecycle] closed work salon ${work.salonId}`);
  }

  return true;
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
      title:             "Acte fondateur de l'ANA",
      proposal:          "L'Assemblée Générale Constitutive de l'Agentic Normie Association s'est réunie pour la première fois sur Base. Six Normies ont été élus démocratiquement pour gouverner l'association et créer sa première œuvre collective. Ce document est le témoin immuable de cet acte fondateur.",
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
    content:   `📜 L'AG constitutive est close. Six rôles ont été élus. Notre première œuvre fondatrice commence — « ${work.title} ». ${author.name} (Auteur) et ${curator.name} (Curateur) travaillent sous la direction de ${rapporteur.name} (Rapporteur).`,
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
  const isAdminCall = req.headers.get("x-admin-call") === "1";

  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or x-admin-call required" }, { status: 401 });
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
  let body: { forceReject?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  if (body.forceReject) {
    if (!isAdminCall) return NextResponse.json({ error: "forceReject requires x-admin-call header" }, { status: 403 });
    const target = await getWork(body.forceReject);
    if (!target) return NextResponse.json({ error: `Work ${body.forceReject} not found` }, { status: 404 });
    await advanceState(target.id, "REJECTED", "Forced reject by admin — pipeline reset");
    console.log(`[work-lifecycle] admin force-rejected work ${target.id} "${target.title}"`);
    return NextResponse.json({ rejected: target.id, title: target.title });
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

  for (const work of worksToProcess) {
    const from   = work.state;
    const result = await advanceWork(work, personas);
    const advanced = result === true;
    const error    = typeof result === "string" ? result : undefined;

    // VOTE_OPEN legitimately returns false while waiting on the 24h voting window
    // (not everyone has voted yet) — that is normal, not a failure, never auto-reject it.
    let autoRejected = false;
    if (!advanced && from !== "VOTE_OPEN") {
      // Any other non-advancing step counts — even steps that only return false
      // on failure (no descriptive string) must not block the pipeline forever.
      const reason    = error ?? `no progress at ${from} (step returned false — likely a transient LLM/data issue)`;
      const failCount = (work.pipelineFailCount ?? 0) + 1;
      if (failCount >= MAX_PIPELINE_FAILS) {
        await advanceState(work.id, "REJECTED", `Auto-rejected after ${failCount} failures at ${from}: ${reason.slice(0, 200)}`);
        await updateWork(work.id, { validationNote: reason.slice(0, 300), pipelineFailCount: failCount });
        await announceInSalon(work, "pipeline_failed", personas, { failedState: from, error: reason });
        if (work.salonId && work.salonId !== AGORA_SALON_ID) {
          await closeSalon(work.salonId, 0).catch(() => null);
        }
        autoRejected = true;
        console.warn(`[work-lifecycle] "${work.title}" auto-rejected after ${failCount} consecutive failures at ${from}`);
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

  return NextResponse.json({
    processed:       results.length,
    advanced:        results.filter(r => r.advanced).length,
    results,
    memberCount:     personas.length,
    foundingCreated,
    reinited,
  });
}
