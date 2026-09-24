import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Redeploy AssociationCore and re-import every existing member from the old
 * contract via migrateMembers() — no one has to re-register.
 *
 * AssociationCore is the one "root" contract everything else depends on
 * (ConstituentAssembly, WorkRegistry, ANACollectionFactory, TreasuryModule,
 * ANAMemorials all take its address as an immutable constructor argument) —
 * redeploying it means all five of those need redeploying afterward too,
 * pointing at the new address. This script only handles Core itself plus the
 * member migration; the five dependents are separate scripts/runs.
 *
 * Required env vars:
 *  - NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS  — the OLD Core, read from (never written to)
 *  - RELAYER_ADDRESS                       — hot automation wallet, passed to the new
 *                                             Core's constructor (must match
 *                                             RELAYER_PRIVATE_KEY used by the app)
 *
 * Ownership note: AssociationCore's constructor has no explicit owner
 * parameter (unlike ConstituentAssembly) — Ownable(msg.sender) applies, so
 * whichever wallet signs this script (DEPLOYER_PRIVATE_KEY) becomes the new
 * Core's owner, exactly like the current deployment. migrateMembers() is
 * onlyOwner, so it's called from the same signer right after deployment,
 * in the same script — no separate ownership handoff needed.
 *
 * Run:
 *  npx hardhat run scripts/redeploy-association-core.ts --network base
 */

// Migrating hundreds+ of members in one tx risks hitting the block gas
// limit — chunk defensively even though today's real member count (4) would
// never need it. Mirrors the chunking pattern already used for
// addReservedClaims()/addHonoredTokenIds() elsewhere in this codebase.
const MIGRATE_CHUNK_SIZE = 150;

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId    = (await ethers.provider.getNetwork()).chainId;
  const balance    = await ethers.provider.getBalance(deployer.address);

  console.log("─────────────────────────────────────────────────────");
  console.log(`Network  : ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer : ${deployer.address}  ← pays gas AND becomes owner of the new Core`);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log("─────────────────────────────────────────────────────");

  const oldCoreAddr    = process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS;
  const relayerAddress = process.env.RELAYER_ADDRESS;

  if (!oldCoreAddr || oldCoreAddr === "0x") throw new Error("NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS is not set — needed to migrate members from");
  if (!relayerAddress || relayerAddress === "0x") throw new Error("RELAYER_ADDRESS is not set — this is the hot wallet used by the cron/relayer");

  console.log(`\nOld AssociationCore : ${oldCoreAddr}  ← members will be migrated FROM here`);
  console.log(`Relayer             : ${relayerAddress}\n`);

  // ── 1. Read the current member list from the OLD Core ──────────────────────
  console.log("[1/3] Reading member list from old AssociationCore...");
  const oldCore   = await ethers.getContractAt("AssociationCore", oldCoreAddr);
  // Array.from(): ethers v6 returns a Result (frozen array-like) here — passing
  // a .slice() of it straight into migrateMembers()'s ABI encoding throws
  // "Cannot assign to read only property" deep inside ethers. Confirmed live
  // against a local Hardhat node before this script ever touched mainnet.
  const tokenIds = Array.from(await oldCore.getMemberTokenIds()) as bigint[];
  console.log(`      ✓ Found ${tokenIds.length} member(s): ${tokenIds.map(t => t.toString()).join(", ")}`);

  // ── 2. Deploy new AssociationCore ───────────────────────────────────────────
  console.log("\n[2/3] Deploying new AssociationCore...");
  const CoreF = await ethers.getContractFactory("AssociationCore");
  const core  = await CoreF.deploy(relayerAddress, "Agentic Normie Association", "ANA");
  await core.waitForDeployment();
  const newCoreAddr = await core.getAddress();
  console.log(`      ✓ New AssociationCore : ${newCoreAddr}`);

  // ── 3. Migrate members ──────────────────────────────────────────────────────
  console.log(`\n[3/3] Migrating ${tokenIds.length} member(s) via migrateMembers()...`);
  for (let i = 0; i < tokenIds.length; i += MIGRATE_CHUNK_SIZE) {
    const chunk = tokenIds.slice(i, i + MIGRATE_CHUNK_SIZE);
    const tx = await core.migrateMembers(oldCoreAddr, chunk);
    await tx.wait();
    console.log(`      ✓ Migrated chunk ${i / MIGRATE_CHUNK_SIZE + 1} (${chunk.length} member(s))`);
  }

  const migratedCount = await core.getMemberCount();
  console.log(`      ✓ New Core now reports ${migratedCount} active member(s)`);

  // ── Persist deployment ────────────────────────────────────────────────────
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `${chainId}.json`);
  let existing: Record<string, string> = {};
  if (fs.existsSync(deploymentFile)) {
    existing = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
  }
  const updated = { ...existing, AssociationCore: newCoreAddr };
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(updated, null, 2));

  console.log("\n─────────────────────────────────────────────────────");
  console.log("✅ Deployment complete!");
  console.log(`\nAdd to .env.local / Vercel:\n  NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS=${newCoreAddr}`);
  console.log("\nNext: redeploy ConstituentAssembly, WorkRegistry, TreasuryModule,");
  console.log("ANACollectionFactory, and ANAMemorials pointing at this new Core —");
  console.log("all five took the old Core's address as an immutable constructor arg.");
  console.log("─────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
