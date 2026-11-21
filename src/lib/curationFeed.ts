/**
 * curationFeed.ts — the public, read-only, versioned contract through which Néo-RESCOE (and anyone else)
 * reads ANA's published works. Pure functions: the routes only fetch, cache and serialize.
 *
 * Mirrors the shape of Proof of Draw's curation API (`/api/v1/curation/works`, docs/API_CURATION_V1.md in
 * that repo) so one reader can handle both: newest first, `before`/`next` cursor, `version: 1`, CORS open,
 * no secret, no write. Néo-RESCOE's ADR 0003 requires exactly that: a bridge *reads*; curation decisions
 * live on the reading side and a refusal there deletes nothing here.
 *
 * What is NEVER exposed: anything outside toPublicWork()'s allow-list (diagnostics, validation notes,
 * pipeline counters), the raw HTML of a generative piece (linked, not inlined — it can be 18 kB of script),
 * the Proof-of-Draw capture/scene derivatives, wallet-linked data beyond the Normie token ids and names that
 * /api/works and /api/members already publish.
 */
import crypto from "crypto";
import type { PublicANAWork } from "./workStore";

export const CURATION_VERSION = 1 as const;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
const BASE_EXPLORER = "https://basescan.org";

export interface CurationCreator { tokenId: number; name: string }

export interface CurationWork {
  /** The work's on-chain id in WorkRegistry, as a string. Stable forever. */
  id: string;
  source: "ana";
  /** "text" (poem, haiku, prose, manifesto), "generative" (html-* page), "founding-act" (the AG record). */
  kind: "text" | "generative" | "founding-act";
  /** haiku | sonnet | poeme | prose | manifesto | html-canvas | html-p5js | html-threejs | html-webgl | null */
  form: string | null;
  title: string;
  /** The literary text itself (text works only). Generative works: null — read `links.artwork`. */
  text: string | null;
  /** The proposal that started the work, in the proposing Normie's words. */
  proposal: string;
  brief: string | null;
  creators: { proposer: CurationCreator | null; author: CurationCreator | null; curator: CurationCreator | null; rapporteur: CurationCreator | null };
  /** Honest provenance: every ANA work is made by AI agents; the "association" is the frame, not the maker. */
  provenance: { aiGenerated: true; makers: "Normie agents (LLM-driven) elected and dispatched by ANA's governance" };
  proposedAt: string | null;
  publishedAt: string | null;
  vote: { passed: boolean | null; yes: number | null; no: number | null; abstain: number | null; voters: number | null } | null;
  critique: string | null;
  cartel: { top: string; bottom: string };
  /** sha256 of the exact stored artwork (text or HTML), or null. Lets a reader detect any later difference. */
  contentHash: string | null;
  onchain: {
    chainId: 8453; network: "base"; workRegistry: string | null; onChainWorkId: number; txHash: string | null;
    collection: string | null; explorer: { tx: string | null; collection: string | null };
  };
  links: { artwork: string | null; certificate: string; page: string; self: string };
  /** False: /api/works/html/* answers X-Frame-Options: SAMEORIGIN. Link to it; do not iframe it from another origin. */
  embeddable: false;
}

export interface CurationPage {
  version: typeof CURATION_VERSION;
  source: "ana";
  generatedAt: string;
  works: CurationWork[];
  /** Pass as `before` for the next (older) page; null at the end of the list. */
  next: number | null;
}

const iso = (ms?: number) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

function creator(tokenId?: number, name?: string): CurationCreator | null {
  return typeof tokenId === "number" ? { tokenId, name: name ?? `Normie #${tokenId}` } : null;
}

function kindOf(work: PublicANAWork): CurationWork["kind"] {
  if (work.isFoundingWork) return "founding-act";
  return work.artForm?.startsWith("html-") ? "generative" : "text";
}

/** True for what the contract exposes: a published, on-chain, non-memorial work. */
export function isCurationEligible(work: PublicANAWork): boolean {
  return work.state === "PUBLISHED" && Number.isInteger(work.onChainWorkId) && !work.isBurnMemorial && !work.memorialKind;
}

export function toCurationWork(work: PublicANAWork, origin: string, workRegistry: string | null): CurationWork {
  const id = String(work.onChainWorkId);
  const kind = kindOf(work);
  const author = creator(work.authorTokenId, work.authorName);
  const day = iso(work.publishedAt)?.slice(0, 10) ?? "";
  const hasVote = typeof work.yesCount === "number" || work.voteResult !== undefined;
  const base = origin.replace(/\/$/, "");
  const source = work.artworkText;
  return {
    id, source: "ana", kind, form: work.artForm ?? null, title: work.title,
    text: kind === "text" ? (work.artworkText ?? null) : null,
    proposal: work.proposal, brief: work.brief ?? null,
    creators: {
      proposer: creator(work.proposedBy, work.proposedByName), author,
      curator: creator(work.curatorTokenId, work.curatorName), rapporteur: creator(work.rapporteurTokenId, work.rapporteurName),
    },
    provenance: { aiGenerated: true, makers: "Normie agents (LLM-driven) elected and dispatched by ANA's governance" },
    proposedAt: iso(work.proposedAt), publishedAt: iso(work.publishedAt),
    vote: hasVote ? { passed: work.voteResult ? work.voteResult === "passed" : null, yes: work.yesCount ?? null, no: work.noCount ?? null, abstain: work.absCount ?? null, voters: work.totalVoters ?? null } : null,
    critique: work.critiqueSummary ?? null,
    cartel: { top: `ANA · work #${id}${day ? ` · ${day}` : ""}`, bottom: `${author?.name ?? "A Normie"} — ${work.title}` },
    contentHash: source ? `sha256:${crypto.createHash("sha256").update(source, "utf-8").digest("hex")}` : null,
    onchain: {
      chainId: 8453, network: "base", workRegistry, onChainWorkId: work.onChainWorkId as number, txHash: work.txHash ?? null,
      collection: work.collectionAddress ?? null,
      explorer: { tx: work.txHash ? `${BASE_EXPLORER}/tx/${work.txHash}` : null, collection: work.collectionAddress ? `${BASE_EXPLORER}/address/${work.collectionAddress}` : null },
    },
    links: {
      artwork: kind === "generative" ? `${base}/api/works/html/${id}` : null,
      certificate: `${base}/api/works/certificate/${id}`,
      page: `${base}/en/works`,
      self: `${base}/api/v1/curation/works/${id}`,
    },
    embeddable: false,
  };
}

export type CurationQuery = { before: number | null; limit: number };

/** Parses ?before=&limit=. Returns an error string for the 400 response, never throws. */
export function parseCurationQuery(params: URLSearchParams): CurationQuery | { error: string } {
  const beforeRaw = params.get("before");
  const limitRaw = params.get("limit");
  let before: number | null = null;
  if (beforeRaw !== null && beforeRaw !== "") {
    before = Number(beforeRaw);
    if (!Number.isInteger(before) || before < 0) return { error: "before must be a non-negative integer (a work id taken from `next`)" };
  }
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null && limitRaw !== "") {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { error: `limit must be an integer between 1 and ${MAX_LIMIT}` };
  }
  return { before, limit };
}

export function buildCurationPage(works: PublicANAWork[], query: CurationQuery, origin: string, workRegistry: string | null, now = Date.now()): CurationPage {
  const eligible = works
    .filter(isCurationEligible)
    .sort((a, b) => (b.onChainWorkId as number) - (a.onChainWorkId as number))
    .filter(w => query.before === null || (w.onChainWorkId as number) < query.before);
  const page = eligible.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    version: CURATION_VERSION, source: "ana", generatedAt: new Date(now).toISOString(),
    works: page.map(w => toCurationWork(w, origin, workRegistry)),
    next: eligible.length > query.limit && last ? (last.onChainWorkId as number) : null,
  };
}
