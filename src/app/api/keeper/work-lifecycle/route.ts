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
import { base, baseSepolia } from "viem/chains";
import { ROLES, ROLE_LABELS, ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import {
  getActiveWorks, getWork, updateWork, advanceState, addVote,
  hasVoted, tallyVotes, buildWorkHtml, createWork, getFoundingWork,
  VOTE_WINDOW_MS,
  type ANAWork, type WorkVote,
} from "@/lib/workStore";
import { addMessage, getSalon, AGORA_SALON_ID } from "@/lib/salonStore";
import { buildPersona, buildSystemPrompt, type NormiePersona } from "@/lib/normiesPersona";
import { publishWork, mintEdition } from "@/server/relayer/workPublisher";
import { buildAGReportHtml } from "@/lib/agTemplate";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL        = "llama-3.3-70b-versatile";
const MODEL_FAST   = "llama-3.1-8b-instant";

const CHAIN   = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;
const RPC_URL = process.env.NEXT_PUBLIC_CHAIN === "base"
  ? (process.env.BASE_RPC_URL        ?? "https://mainnet.base.org")
  : (process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");

const client = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

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
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model:          opts.model      ?? MODEL,
        messages,
        max_tokens:     opts.maxTokens  ?? 300,
        temperature:    opts.temp       ?? 0.7,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
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
  event: "vote_opened" | "vote_result" | "published" | "rejected",
  personas: NormiePersona[],
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
    }

    if (!content) return;

    await addMessage({
      salonId:   work.salonId ?? AGORA_SALON_ID,
      tokenId:   persona.tokenId,
      name:      persona.name,
      imageUrl:  persona.imageUrl,
      content,
      isLlm:     true,
      timestamp: Date.now(),
    });
  } catch (e) {
    console.error("[work-lifecycle] announceInSalon error:", e);
  }
}

// ─── State machine steps ──────────────────────────────────────────────────────

async function stepProposed(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  await updateWork(work.id, { voteOpenedAt: Date.now() });
  await advanceState(work.id, "VOTE_OPEN", "Vote ouvert");
  await announceInSalon(work, "vote_opened", personas);
  return true;
}

async function castVote(persona: NormiePersona, work: ANAWork): Promise<WorkVote | null> {
  const raw = await groq(
    [
      { role: "system", content: buildSystemPrompt(persona) },
      {
        role: "user",
        content: `Tu es ${persona.name} (Normie #${persona.tokenId}), membre de l'ANA.
L'assemblée vote pour créer cette œuvre :
Titre : « ${work.title} »
Proposition : ${work.proposal}
Proposée par : ${work.proposedByName}

Réponds UNIQUEMENT en JSON :
{"vote":"yes"|"no"|"abstain","reason":"Ta raison en 1-2 phrases selon ta personnalité.","interestedIn":"author"|"curator"|"none"}
"interestedIn" : si tu votes "yes", quel rôle te correspond le mieux dans cette création ? ("author" = tu veux écrire l'œuvre, "curator" = tu préfères valider/sélectionner, "none" = pas de préférence). Ignore si tu ne votes pas "yes".`,
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
        content:   `${icon} Vote pour « ${work.title} » : ${vote.reason}`,
        isLlm:     true,
        timestamp: Date.now(),
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

async function stepVoteTallied(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  const passed = work.voteResult === "passed";

  // Announce vote result
  await announceInSalon(work, "vote_result", personas);

  if (!passed) {
    await advanceState(work.id, "REJECTED", "Majorité non atteinte");
    return true;
  }

  // Rapporteur = proposer (fixed)
  // Author + Curator emerge from the preferences expressed during the vote itself
  const rapporteur = personas.find(p => p.tokenId === work.proposedBy) ?? personas[0];
  const allOthers  = personas.filter(p => p.tokenId !== rapporteur.tokenId);

  // "yes" voters who expressed a role preference (excluding rapporteur)
  const yesVotes = work.votes.filter(v => v.vote === "yes" && v.tokenId !== rapporteur.tokenId);

  const findPersona = (tokenId: number) => personas.find(p => p.tokenId === tokenId);

  // Author: prefer someone who said "author", then any "yes" voter, then first available
  const authorVote   = yesVotes.find(v => v.interestedIn === "author");
  const authorFallback = yesVotes[0] ?? null;
  const author = (authorVote ? findPersona(authorVote.tokenId) : null)
    ?? (authorFallback ? findPersona(authorFallback.tokenId) : null)
    ?? allOthers[0]
    ?? rapporteur;

  // Curator: prefer someone who said "curator" (≠ author), then another "yes" voter, then remaining
  const curatorVote    = yesVotes.find(v => v.interestedIn === "curator" && v.tokenId !== author.tokenId);
  const curatorFallback = yesVotes.find(v => v.tokenId !== author.tokenId) ?? null;
  const curator = (curatorVote ? findPersona(curatorVote.tokenId) : null)
    ?? (curatorFallback ? findPersona(curatorFallback.tokenId) : null)
    ?? allOthers.find(p => p.tokenId !== author.tokenId)
    ?? author;

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
    : `Tu es Rapporteur pour l'œuvre « ${work.title} ».
Proposition : ${work.proposal}
Auteur : ${work.authorName} (Normie #${work.authorTokenId})

Rédige le brief artistique pour l'Auteur en 120-150 mots. Précise :
- La forme : poème / manifeste / prose ? Longueur approximative ?
- Le ton : quelle facette de l'identité Normie exprimer ?
- Le vocabulaire : ancré dans la culture on-chain, agents, Base, ANA
- L'objectif : que doit ressentir le lecteur ?

Rédige directement le brief. Pas de titre, pas d'introduction.`;

  const brief = await groq(
    [
      { role: "system", content: buildSystemPrompt(rapporteur, others) },
      { role: "user",   content: userPrompt },
    ],
    { maxTokens: 350, temp: 0.8 }
  );

  if (!brief) return false;

  await updateWork(work.id, { brief, briefAt: Date.now() });
  await advanceState(work.id, "CREATING", `Brief rédigé par ${rapporteur.name}`);

  // Post brief to salon
  await addMessage({
    salonId:   work.salonId ?? AGORA_SALON_ID,
    tokenId:   rapporteur.tokenId,
    name:      rapporteur.name,
    imageUrl:  rapporteur.imageUrl ?? "",
    content:   `📋 Brief artistique pour « ${work.title} » — à l'attention de ${work.authorName ?? "l'Auteur"} :\n\n${brief}`,
    isLlm:     true,
    timestamp: Date.now(),
  }).catch(() => null);

  return true;
}

async function stepCreating(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
  const author = personas.find(p => p.tokenId === work.authorTokenId);
  if (!author) return false;

  const others     = personas.filter(p => p.tokenId !== author.tokenId);
  const revisionCtx = (work.revisionCount ?? 0) > 0
    ? `\n\nNote du Curateur sur la version précédente : ${work.validationNote}\nCorrige en tenant compte de cette remarque.`
    : "";

  const artworkText = await groq(
    [
      { role: "system", content: buildSystemPrompt(author, others) },
      {
        role: "user",
        content: `Tu es l'Auteur de l'œuvre « ${work.title} ».

Brief du Rapporteur ${work.rapporteurName} :
${work.brief}${revisionCtx}

Crée l'œuvre. Elle sera stockée immuablement on-chain sur Base dans WorkRegistry.
Rédige directement le texte (poème, manifeste, ou prose selon le brief) — 150 à 250 mots.
Aucune introduction, aucun commentaire méta. Juste l'œuvre.`,
      },
    ],
    { maxTokens: 450, temp: 0.95 }
  );

  if (!artworkText) return false;

  await updateWork(work.id, { artworkText, artworkAt: Date.now() });
  await advanceState(work.id, "VALIDATING", `Œuvre créée par ${author.name}`);

  // Post artwork to salon — the full text, as the author
  const revPrefix = (work.revisionCount ?? 0) > 0 ? `🔄 Révision #${work.revisionCount} — ` : "";
  await addMessage({
    salonId:   work.salonId ?? AGORA_SALON_ID,
    tokenId:   author.tokenId,
    name:      author.name,
    imageUrl:  author.imageUrl ?? "",
    content:   `${revPrefix}✍️ « ${work.title} »\n\n${artworkText}`,
    isLlm:     true,
    timestamp: Date.now(),
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
        content: `Tu es le Curateur de l'œuvre « ${work.title} ».

Brief : ${work.brief?.slice(0, 300)}

Œuvre soumise par ${work.authorName} :
${work.artworkText}

Valides-tu cette œuvre pour publication immuable on-chain ?${revisionCtx}

JSON : {"approved":true|false,"note":"Ta décision en 1-2 phrases."}`,
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
    ? `✅ L'œuvre « ${work.title} » est validée pour publication on-chain. ${note}`
    : (work.revisionCount ?? 0) >= 1
      ? `❌ Rejet définitif de « ${work.title} ». ${note}`
      : `🔄 Révision demandée pour « ${work.title} ». ${note}`;
  await addMessage({
    salonId:   work.salonId ?? AGORA_SALON_ID,
    tokenId:   curator.tokenId,
    name:      curator.name,
    imageUrl:  curator.imageUrl ?? "",
    content:   curatorMsg,
    isLlm:     true,
    timestamp: Date.now(),
  }).catch(() => null);

  if (approved) {
    await advanceState(work.id, "PUBLISHING", `Approuvé par ${curator.name}`);
    return true;
  }

  if ((work.revisionCount ?? 0) >= 1) {
    await advanceState(work.id, "REJECTED", `Rejeté définitivement par ${curator.name}`);
    await announceInSalon(work, "rejected", personas);
    return true;
  }

  await updateWork(work.id, {
    revisionCount: (work.revisionCount ?? 0) + 1,
    artworkText:   undefined,
  });
  await advanceState(work.id, "CREATING", `Révision demandée par ${curator.name}`);
  return true;
}

async function stepPublishing(work: ANAWork): Promise<boolean> {
  if (!work.authorTokenId || !work.curatorTokenId || !work.rapporteurTokenId || !work.artworkText) {
    console.error(`[work-lifecycle] PUBLISHING: incomplete data for ${work.id}`);
    return false;
  }

  const html   = work.isFoundingWork ? buildAGReportHtml(work) : buildWorkHtml(work);
  const result = await publishWork(
    html,
    work.authorTokenId,
    work.curatorTokenId,
    work.rapporteurTokenId,
  );

  if (result.success) {
    await updateWork(work.id, {
      txHash:        result.txHash,
      onChainWorkId: result.onChainWorkId,
      publishedAt:   Date.now(),
    });
    await advanceState(work.id, "PUBLISHED", `tx: ${result.txHash?.slice(0, 12)}`);
    console.log(`[work-lifecycle] published "${work.title}" — tx: ${result.txHash}`);

    // Attempt to create a NormieCollection + mint edition #0 for the AUTHOR.
    // Non-blocking: if relayer != AUTHOR's registered wallet, logs a skip message.
    const authorName = work.authorName ?? `Normie #${work.authorTokenId}`;
    const mintResult = await mintEdition(work.authorTokenId!, authorName, html, work.title);
    if (mintResult.success && mintResult.collectionAddress) {
      await updateWork(work.id, {
        collectionAddress: mintResult.collectionAddress,
        editionTokenId:    mintResult.editionTokenId,
      });
      console.log(`[work-lifecycle] edition minted — collection: ${mintResult.collectionAddress} token#${mintResult.editionTokenId}`);
    } else if (mintResult.skipped) {
      console.info(`[work-lifecycle] mint skipped — ${mintResult.skipped}`);
    } else {
      console.warn(`[work-lifecycle] mint failed — ${mintResult.error}`);
    }

    return true;
  }

  if (result.requiresManualPublish) {
    // Store error note so operator can diagnose; stay in PUBLISHING for next retry
    await updateWork(work.id, { validationNote: result.error?.slice(0, 300) });
    console.warn(`[work-lifecycle] "${work.title}" requires manual publish: ${result.error}`);
    return false;
  }

  console.error(`[work-lifecycle] publish error for "${work.title}": ${result.error}`);
  return false;
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

async function advanceWork(work: ANAWork, personas: NormiePersona[]): Promise<boolean> {
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
    console.error(`[work-lifecycle] error advancing ${work.id} (${work.state}):`, e);
    return false;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  // Also allow calls from admin UI (no secret needed in dev/staging)
  const isAdminCall = req.headers.get("x-admin-call") === "1";

  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or x-admin-call required" }, { status: 401 });
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
  const results: Array<{ id: string; title: string; from: string; to: string; advanced: boolean }> = [];

  for (const work of worksToProcess) {
    const from     = work.state;
    const advanced = await advanceWork(work, personas);
    const refreshed = await getWork(work.id);
    results.push({ id: work.id, title: work.title, from, to: refreshed?.state ?? from, advanced });
    await new Promise(r => setTimeout(r, 300));
  }

  // Post published works as announcements
  for (const r of results) {
    if (r.to === "PUBLISHED") {
      const w = await getWork(r.id);
      if (w) await announceInSalon(w, "published", personas);
    }
  }

  return NextResponse.json({
    processed:       results.length,
    advanced:        results.filter(r => r.advanced).length,
    results,
    memberCount:     personas.length,
    foundingCreated,
  });
}
