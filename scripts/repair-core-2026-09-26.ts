import { ethers, network } from "hardhat";

/**
 * One-off repair for the 26/09/2026 redeploy: two writes to the new
 * AssociationCore never happened, confirmed live via direct RPC reads before
 * this script existed:
 *
 *  1. migrateMembers() was never called against the NEW Core — it reports
 *     getMemberCount() == 0 despite the old Core still having 4 members
 *     (6848, 5271, 9630, 2613). redeploy-association-core.ts does call this
 *     in the same run as deployment, so either that step failed/reverted
 *     silently, or this Core address is from a run where it didn't happen.
 *
 *  2. ConstituentAssembly is NOT authorized on the new Core
 *     (authorizedModules[CA] == false). Root cause found by reading
 *     redeploy-constituent-assembly.ts: it calls
 *     core.authorizeModule(newAssembly) against
 *     process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS — which, per the
 *     documented 10-step procedure, is only updated at step 7, AFTER every
 *     contract is deployed. So when that script ran (step 2), .env.local
 *     still pointed at the OLD Core, and authorizeModule() was called
 *     against the wrong (old) contract entirely. WorkRegistry/TreasuryModule
 *     avoided this because their own scripts fall back to
 *     deployments/<chainId>.json first; redeploy-constituent-assembly.ts has
 *     no such fallback.
 *
 * Every other cross-reference (WorkRegistry.core, TreasuryModule.core,
 * ANACollectionFactory's authorized/associationAddr/coreAddr, ANAMemorials'
 * relayerPayoutAddr/vaultAddr/authorized/core) was verified correct via the
 * same direct RPC reads — this script only fixes the two confirmed gaps.
 *
 * Requires: the wallet behind RELAYER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY,
 * per hardhat.config.ts's fallback) to be the NEW Core's owner — i.e.
 * whichever wallet actually signed redeploy-association-core.ts.
 *
 * Run:
 *  npx hardhat run scripts/repair-core-2026-09-26.ts --network base
 */

const OLD_CORE = "0x218a2C38a16F81DcC944872264d79606b1DB1C40";
const NEW_CORE = "0xB70f699348A17BA8a21bE8A544092Cb3eC1bE488";
const NEW_CA   = "0xA5996142d0979Ae0670FbEF9fb60368E0B5C5F14";

async function main() {
  const [signer] = await ethers.getSigners();
  const balance  = await ethers.provider.getBalance(signer.address);

  console.log("─────────────────────────────────────────────────────");
  console.log(`Network : ${network.name}`);
  console.log(`Signer  : ${signer.address}`);
  console.log(`Balance : ${ethers.formatEther(balance)} ETH`);
  console.log("─────────────────────────────────────────────────────");

  const core = await ethers.getContractAt("AssociationCore", NEW_CORE, signer);

  const owner = await core.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer (${signer.address}) is not the new Core's owner (${owner}) -- use the wallet that ran redeploy-association-core.ts`);
  }

  // ── 1. Migrate members, only if still missing ──────────────────────────────
  const currentCount = await core.getMemberCount();
  console.log(`\n[1/2] New Core currently reports ${currentCount} member(s).`);
  if (currentCount > 0n) {
    console.log("      Already migrated -- skipping.");
  } else {
    const oldCore  = await ethers.getContractAt("AssociationCore", OLD_CORE);
    const tokenIds = Array.from(await oldCore.getMemberTokenIds()) as bigint[];
    console.log(`      Migrating ${tokenIds.length} member(s) from old Core: ${tokenIds.join(", ")}`);
    const tx = await core.migrateMembers(OLD_CORE, tokenIds);
    await tx.wait();
    const newCount = await core.getMemberCount();
    console.log(`      ✓ New Core now reports ${newCount} member(s).`);
    if (newCount !== BigInt(tokenIds.length)) {
      console.warn(`      ⚠️  Expected ${tokenIds.length}, got ${newCount} -- investigate before proceeding.`);
    }
  }

  // ── 2. Authorize ConstituentAssembly, only if not already ──────────────────
  const alreadyAuthorized = await core.authorizedModules(NEW_CA);
  console.log(`\n[2/2] ConstituentAssembly authorized on new Core: ${alreadyAuthorized}`);
  if (alreadyAuthorized) {
    console.log("      Already authorized -- skipping.");
  } else {
    const tx = await core.authorizeModule(NEW_CA);
    await tx.wait();
    const nowAuthorized = await core.authorizedModules(NEW_CA);
    console.log(`      ✓ authorizeModule(${NEW_CA}) -- now: ${nowAuthorized}`);
  }

  console.log("\n─────────────────────────────────────────────────────");
  console.log("Done. Re-run this check anytime -- both steps are idempotent (skip if already correct).");
  console.log("─────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
