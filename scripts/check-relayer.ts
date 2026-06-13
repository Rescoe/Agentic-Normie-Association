/**
 * Diagnostic: check if the relayer wallet is aligned with on-chain role holders.
 *
 * Run: npx ts-node -e "require('./scripts/check-relayer.ts')"
 *   OR: npx hardhat run scripts/check-relayer.ts --network base
 *
 * What it checks:
 *   1. Relayer address (from RELAYER_PRIVATE_KEY)
 *   2. All registered ANA members + their ownerAddress on Base
 *   3. Current role assignments (who holds each of the 6 roles)
 *   4. Whether relayer == RAPPORTEUR holder (required for WorkRegistry.publish())
 *   5. Whether relayer == AUTHOR/RAPPORTEUR holder (required for CollectionFactory.createCollection())
 *
 * If relayer != RAPPORTEUR holder, you have two options:
 *   A. Register the RAPPORTEUR candidate from 0x342aAF2F694BD49c0312760D6326a6b3CAe7330F
 *      (before opening the AG election)
 *   B. Change RELAYER_PRIVATE_KEY to the RAPPORTEUR's holder private key
 *      (after the election, once you know who won)
 */

import "dotenv/config";
import { createPublicClient, http, keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Inline ABIs to avoid Next.js alias resolution issues in script context
const CORE_ABI = [
  { inputs: [], name: "getMemberTokenIds", outputs: [{ type: "uint256[]" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "tokenId", type: "uint256" }], name: "getMemberOwner", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "tokenId", type: "uint256" }], name: "isMember", outputs: [{ type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "role", type: "bytes32" }], name: "getRoleHolder", outputs: [{ components: [{ name: "tokenId", type: "uint256" }, { name: "holderAddress", type: "address" }], type: "tuple" }], stateMutability: "view", type: "function" },
] as const;

const ROLES = {
  PRESIDENT:      keccak256(stringToBytes("PRESIDENT")),
  VICE_PRESIDENT: keccak256(stringToBytes("VICE_PRESIDENT")),
  SECRETARY:      keccak256(stringToBytes("SECRETARY")),
  AUTHOR:         keccak256(stringToBytes("AUTHOR")),
  CURATOR:        keccak256(stringToBytes("CURATOR")),
  RAPPORTEUR:     keccak256(stringToBytes("RAPPORTEUR")),
} as const;

const ROLE_LABELS: Record<string, string> = {
  [ROLES.PRESIDENT]:      "Président",
  [ROLES.VICE_PRESIDENT]: "VP / Trésorier",
  [ROLES.SECRETARY]:      "Secrétaire",
  [ROLES.AUTHOR]:         "Auteur",
  [ROLES.CURATOR]:        "Curateur",
  [ROLES.RAPPORTEUR]:     "Rapporteur",
};

const ZERO = "0x0000000000000000000000000000000000000000";

async function main() {
  const key      = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  const coreAddr = (process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS ?? "") as `0x${string}`;
  const rpcUrl   = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║           ANA — Relayer Diagnostic Script               ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  if (!key) {
    console.error("❌  RELAYER_PRIVATE_KEY not set in .env.local");
    process.exit(1);
  }
  if (!coreAddr) {
    console.error("❌  NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS not set");
    process.exit(1);
  }

  const relayerAccount = privateKeyToAccount(key);
  const relayer        = relayerAccount.address;

  console.log(`🔑  Relayer address : ${relayer}`);
  console.log(`📍  AssociationCore : ${coreAddr}`);
  console.log(`🌐  RPC             : ${rpcUrl}\n`);

  const client = createPublicClient({ chain: base, transport: http(rpcUrl) });

  // ── Members ────────────────────────────────────────────────────────────────

  let memberIds: number[] = [];
  try {
    const raw = await client.readContract({ address: coreAddr, abi: CORE_ABI, functionName: "getMemberTokenIds" });
    memberIds = (raw as bigint[]).map(Number);
  } catch (e) {
    console.error("❌  getMemberTokenIds failed:", e);
    process.exit(1);
  }

  console.log(`👥  Registered members (${memberIds.length}):`);
  const ownerByTokenId: Record<number, string> = {};
  for (const id of memberIds) {
    try {
      const owner = await client.readContract({ address: coreAddr, abi: CORE_ABI, functionName: "getMemberOwner", args: [BigInt(id)] }) as string;
      ownerByTokenId[id] = owner;
      const isRelayer = owner.toLowerCase() === relayer.toLowerCase();
      console.log(`   #${id.toString().padEnd(5)} → ${owner}  ${isRelayer ? "✅ RELAYER MATCH" : ""}`);
    } catch {
      console.log(`   #${id} → (read error)`);
    }
  }

  // ── Role holders ────────────────────────────────────────────────────────────

  console.log("\n🎭  Current role assignments:");
  type RoleHolder = { tokenId: bigint; holderAddress: string };
  const roleResults: Record<string, RoleHolder | null> = {};

  for (const [roleName, roleHash] of Object.entries(ROLES)) {
    try {
      const holder = await client.readContract({ address: coreAddr, abi: CORE_ABI, functionName: "getRoleHolder", args: [roleHash] }) as RoleHolder;
      roleResults[roleName] = holder;
      const isZero     = holder.holderAddress === ZERO || holder.tokenId === 0n;
      const isRelayer  = holder.holderAddress.toLowerCase() === relayer.toLowerCase();
      const label      = ROLE_LABELS[roleHash] ?? roleName;
      if (isZero) {
        console.log(`   ${label.padEnd(20)} — (unassigned)`);
      } else {
        console.log(`   ${label.padEnd(20)} → #${holder.tokenId} @ ${holder.holderAddress}  ${isRelayer ? "✅ RELAYER" : ""}`);
      }
    } catch {
      roleResults[roleName] = null;
      console.log(`   ${roleName.padEnd(20)} → (read error)`);
    }
  }

  // ── Key verdict ────────────────────────────────────────────────────────────

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const rapporteur = roleResults["RAPPORTEUR"];
  const author     = roleResults["AUTHOR"];

  // RAPPORTEUR check (WorkRegistry.publish requires relayer == rapporteur holderAddress)
  if (!rapporteur || rapporteur.holderAddress === ZERO || rapporteur.tokenId === 0n) {
    console.log("⚠️   RAPPORTEUR not yet assigned — no blocking issue for now.");
    console.log("    Action needed BEFORE the first publish:");
    console.log(`    Register the RAPPORTEUR candidate from wallet ${relayer}`);
    console.log("    so getMemberOwner(rapporteurTokenId) == relayer.\n");
  } else if (rapporteur.holderAddress.toLowerCase() === relayer.toLowerCase()) {
    console.log("✅  WorkRegistry.publish() → OK (relayer == RAPPORTEUR holder)");
  } else {
    console.log("❌  WorkRegistry.publish() → BLOCKED");
    console.log(`    RAPPORTEUR #${rapporteur.tokenId} registered from : ${rapporteur.holderAddress}`);
    console.log(`    Relayer                                  : ${relayer}`);
    console.log("\n    Fix options:");
    console.log(`    A) Change RELAYER_PRIVATE_KEY to the private key of ${rapporteur.holderAddress}`);
    console.log(`    B) Re-register RAPPORTEUR #${rapporteur.tokenId} from ${relayer}`);
    console.log("       (requires: AssociationCore.transferMemberOwner or re-registration)\n");
  }

  // AUTHOR check (CollectionFactory.createCollection requires relayer == author holder)
  if (!author || author.holderAddress === ZERO || author.tokenId === 0n) {
    console.log("⚠️   AUTHOR not yet assigned — CollectionFactory.createCollection will be skipped");
    console.log("    until a work is published and an AUTHOR is elected.\n");
  } else if (author.holderAddress.toLowerCase() === relayer.toLowerCase()) {
    console.log("✅  CollectionFactory.createCollection() → OK (relayer == AUTHOR holder)");
  } else {
    console.log("⚠️   CollectionFactory.createCollection() → will be SKIPPED for this AUTHOR");
    console.log(`    AUTHOR #${author.tokenId} registered from : ${author.holderAddress}`);
    console.log(`    Relayer                               : ${relayer}`);
    console.log("    The work will still publish on-chain, but no NormieCollection will be auto-created.");
    console.log("    Author must create their collection manually from their wallet.\n");
  }

  // Members who match relayer (can act autonomously)
  const relayerMembers = Object.entries(ownerByTokenId).filter(([, addr]) => addr.toLowerCase() === relayer.toLowerCase());
  if (relayerMembers.length > 0) {
    console.log(`✅  ${relayerMembers.length} Normie(s) registered from relayer wallet:`);
    relayerMembers.forEach(([id]) => console.log(`    → Normie #${id}`));
  } else {
    console.log("ℹ️   No Normies currently registered from the relayer wallet.");
    console.log(`    To enable autonomous minting, register a Normie from ${relayer}.`);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(e => { console.error(e); process.exit(1); });
