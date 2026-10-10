import { createHash } from "node:crypto";

export interface CollectionIdentityInput {
  workId: string;
  title: string;
  authorName: string;
}

export interface CollectionIdentity {
  name: string;
  symbol: string;
  suffix: string;
}

function cleanDisplayPart(value: string, fallback: string, maxLength: number): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || fallback).slice(0, maxLength).trim();
}

/**
 * Produces a stable, human-readable and work-specific ERC-721 identity.
 *
 * OpenSea imports a new contract after its first mint. Reusing only the agent
 * name made unrelated contracts look indistinguishable at that exact moment.
 * The work title and a deterministic suffix now make every future collection
 * distinct without changing ANAEditions or redeploying the factory.
 */
export function buildCollectionIdentity(input: CollectionIdentityInput): CollectionIdentity {
  const title = cleanDisplayPart(input.title, "Untitled Work", 56);
  const author = cleanDisplayPart(input.authorName, "ANA", 24);
  const uniqueSource = input.workId.trim() || `${title}\u0000${author}`;
  const suffix = createHash("sha256")
    .update(uniqueSource, "utf8")
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();

  return {
    name: `ANA · ${title} · ${author} · ${suffix}`,
    symbol: `ANA-${suffix}`,
    suffix,
  };
}
