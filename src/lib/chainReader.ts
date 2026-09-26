/**
 * chainReader.ts — SERVER ONLY
 *
 * Lecture on-chain via viem (pas de wallet requis).
 * Utilisé dans les Server Components et les API routes.
 *
 * Si les contrats ne sont pas déployés (adresses vides), toutes
 * les fonctions retournent des valeurs vides sans planter.
 */

import { createPublicClient, http, parseAbi } from "viem";
import { base, baseSepolia } from "viem/chains";
import { baseRpcTransport } from "@/lib/baseRpc";

// ─── Client ───────────────────────────────────────────────────────────────────

// Was `isMainnet = NEXT_PUBLIC_CHAIN === "base"` (opt-IN to mainnet) — if
// that var was ever unset/misnamed on Vercel, this silently fell back to Base
// Sepolia in PRODUCTION, where CORE_ADDRESS (a mainnet address) doesn't
// exist, so every read below threw and was swallowed by its own `catch {
// return 0 }` — exactly what produced /api/status's "memberCount: 0" while
// every other file (which hardcodes `chain: base` directly, e.g.
// proposeWork.ts, activityScanner.ts) read the real chain fine. Per this
// project's own standing rule (preview/staging also run real contracts on
// Base mainnet, never Sepolia — see project memory
// feedback_chain_always_base_mainnet), the safe default is mainnet; Sepolia
// requires an explicit opt-in instead.
const isSepolia = process.env.NEXT_PUBLIC_CHAIN === "baseSepolia";

const targetChain = isSepolia ? baseSepolia : base;

const transport = isSepolia
  ? http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org", { timeout: 8_000 })
  : baseRpcTransport(8_000);

export const publicClient = createPublicClient({
  chain: targetChain,
  transport,
});

// ─── Addresses ────────────────────────────────────────────────────────────────

const CORE_ADDRESS     = process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS     as `0x${string}` | undefined;
const ASSEMBLY_ADDRESS = process.env.NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS as `0x${string}` | undefined;
const WORK_ADDRESS     = process.env.NEXT_PUBLIC_WORK_REGISTRY_ADDRESS        as `0x${string}` | undefined;

export const contractsDeployed = !!CORE_ADDRESS;

// ─── ABIs (inline, server-side only) ─────────────────────────────────────────

const CORE_ABI = parseAbi([
  "function getMemberCount() external view returns (uint256)",
  "function getMemberTokenIds() external view returns (uint256[])",
  "function getMemberOwner(uint256 tokenId) external view returns (address)",
  "function isMember(uint256 tokenId) external view returns (bool)",
  "function getRoleHolder(bytes32 role) external view returns (uint256 tokenId, address holderAddress, uint256 assignedAt)",
  "function associationName() external view returns (string)",
]);

const ASSEMBLY_ABI = parseAbi([
  "function currentSession() external view returns (uint256 id, uint256 openedAt, uint256 closedAt, uint256 deadline, bool active, bool resolved)",
  "function getElectableRoles() external view returns (bytes32[])",
  "function getVoteCount(bytes32 role, uint256 candidateTokenId) external view returns (uint256)",
  "function getLeader(bytes32 role) external view returns (uint256 tokenId, uint256 count)",
  "function getCandidates(bytes32 role) external view returns (uint256[])",
  "function hasVoted(uint256 sessionId, uint256 voterTokenId, bytes32 role) external view returns (bool)",
]);

const WORK_ABI = parseAbi([
  "function getWorkCount() external view returns (uint256)",
]);

// ─── AssociationCore reads ────────────────────────────────────────────────────

export async function readMemberCount(): Promise<number> {
  if (!CORE_ADDRESS) return 0;
  try {
    const count = await publicClient.readContract({
      address: CORE_ADDRESS,
      abi: CORE_ABI,
      functionName: "getMemberCount",
    });
    return Number(count);
  } catch (e) { console.error("[chainReader] readMemberCount failed:", e); return 0; }
}

export async function readMemberTokenIds(): Promise<number[]> {
  if (!CORE_ADDRESS) return [];
  try {
    const ids = await publicClient.readContract({
      address: CORE_ADDRESS,
      abi: CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (ids as bigint[]).map(Number);
  } catch (e) { console.error("[chainReader] readMemberTokenIds failed:", e); return []; }
}

export async function readMemberOwner(tokenId: number): Promise<string | null> {
  if (!CORE_ADDRESS) return null;
  try {
    const owner = await publicClient.readContract({
      address: CORE_ADDRESS,
      abi: CORE_ABI,
      functionName: "getMemberOwner",
      args: [BigInt(tokenId)],
    });
    return owner as string;
  } catch (e) { console.error("[chainReader] readMemberOwner failed:", e); return null; }
}

export async function readIsMember(tokenId: number): Promise<boolean> {
  if (!CORE_ADDRESS) return false;
  try {
    return await publicClient.readContract({
      address: CORE_ADDRESS,
      abi: CORE_ABI,
      functionName: "isMember",
      args: [BigInt(tokenId)],
    }) as boolean;
  } catch (e) { console.error("[chainReader] readIsMember failed:", e); return false; }
}

export interface RoleHolder {
  tokenId:      number;
  holderAddress: string;
  assignedAt:   number;
}

export async function readRoleHolder(roleHash: `0x${string}`): Promise<RoleHolder | null> {
  if (!CORE_ADDRESS) return null;
  try {
    const raw = await publicClient.readContract({
      address: CORE_ADDRESS,
      abi: CORE_ABI,
      functionName: "getRoleHolder",
      args: [roleHash],
    });
    // viem returns named-field structs as objects; cast via unknown for TS
    const result = raw as unknown as { tokenId: bigint; holderAddress: string; assignedAt: bigint };
    if (result.tokenId === 0n) return null;
    return {
      tokenId:       Number(result.tokenId),
      holderAddress: result.holderAddress,
      assignedAt:    Number(result.assignedAt),
    };
  } catch (e) { console.error("[chainReader] readRoleHolder failed:", e); return null; }
}

// ─── ConstituentAssembly reads ────────────────────────────────────────────────

export interface SessionState {
  id:        number;
  openedAt:  number;
  closedAt:  number;
  deadline:  number;
  active:    boolean;
  resolved:  boolean;
}

async function readCurrentSessionOnce(): Promise<SessionState | null> {
  if (!ASSEMBLY_ADDRESS) return null;
  try {
    const raw = await publicClient.readContract({
      address: ASSEMBLY_ADDRESS,
      abi: ASSEMBLY_ABI,
      functionName: "currentSession",
    });
    // viem retourne un tuple [id, openedAt, closedAt, deadline, active, resolved]
    const t = raw as unknown as readonly [bigint, bigint, bigint, bigint, boolean, boolean];
    return {
      id:       Number(t[0]),
      openedAt: Number(t[1]),
      closedAt: Number(t[2]),
      deadline: Number(t[3]),
      active:   Boolean(t[4]),
      resolved: Boolean(t[5]),
    };
  } catch (e) { console.error("[chainReader] readCurrentSessionOnce failed:", e); return null; }
}

/**
 * mainnet.base.org is a load-balanced public endpoint whose backend nodes can lag —
 * observed live (2026-09-17): one read returned session #1 (a July test session, long
 * superseded) while a read moments later on a different domain returned the real
 * current session #2. No error either time, just an old-but-valid answer — a plain
 * retry-on-exception (as used elsewhere for rate limits) doesn't catch this, since
 * nothing throws. Session ids only ever increase, so a second read landing on a
 * different backend gives a cheap, reliable way to detect and resolve the disagreement:
 * whichever read reports the higher id is provably the fresher one.
 */
export async function readCurrentSession(): Promise<SessionState | null> {
  const first  = await readCurrentSessionOnce();
  const second = await readCurrentSessionOnce();
  if (!first)  return second;
  if (!second) return first;
  return second.id >= first.id ? second : first;
}

export interface RoleLeader {
  roleHash:  string;
  tokenId:   number;
  voteCount: number;
}

export async function readLeaderForRole(roleHash: `0x${string}`): Promise<RoleLeader> {
  if (!ASSEMBLY_ADDRESS) return { roleHash, tokenId: 0, voteCount: 0 };
  try {
    const raw = await publicClient.readContract({
      address: ASSEMBLY_ADDRESS,
      abi: ASSEMBLY_ABI,
      functionName: "getLeader",
      args: [roleHash],
    });
    const r = raw as unknown as { tokenId: bigint; count: bigint };
    return { roleHash, tokenId: Number(r.tokenId), voteCount: Number(r.count) };
  } catch (e) { console.error("[chainReader] readLeaderForRole failed:", e); return { roleHash, tokenId: 0, voteCount: 0 }; }
}

// ─── WorkRegistry reads ───────────────────────────────────────────────────────

export async function readWorkCount(): Promise<number> {
  if (!WORK_ADDRESS) return 0;
  try {
    const count = await publicClient.readContract({
      address: WORK_ADDRESS,
      abi: WORK_ABI,
      functionName: "getWorkCount",
    });
    return Number(count);
  } catch (e) { console.error("[chainReader] readWorkCount failed:", e); return 0; }
}

// ─── Composite: stats pour StatusBar ─────────────────────────────────────────

export interface ChainStats {
  memberCount:  number;
  workCount:    number;
  sessionState: SessionState | null;
  deployed:     boolean;
}

export async function readChainStats(): Promise<ChainStats> {
  if (!contractsDeployed) {
    return { memberCount: 0, workCount: 0, sessionState: null, deployed: false };
  }
  const [memberCount, workCount, sessionState] = await Promise.all([
    readMemberCount(),
    readWorkCount(),
    readCurrentSession(),
  ]);
  return { memberCount, workCount, sessionState, deployed: true };
}
