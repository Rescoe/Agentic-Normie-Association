import { ethers, network } from "hardhat";

/**
 * Redeploy ConstituentAssembly only.
 *
 * Use this when the ConstituentAssembly contract is upgraded without touching
 * AssociationCore, WorkRegistry, or any NFT collections.
 *
 * What this script does:
 *  1. Deploys a new ConstituentAssembly with explicit owner + relayer addresses
 *  2. Calls core.authorizeModule(newAssembly)   — grants governance write access
 *  3. Calls core.revokeModule(oldAssembly)       — removes old contract's access
 *
 * After running:
 *  - Update NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS in .env.local and Vercel
 *
 * Run:
 *  npx hardhat run scripts/redeploy-constituent-assembly.ts --network base
 *
 * ── Required env vars ─────────────────────────────────────────────────────────
 *
 *  NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS        existing AssociationCore address
 *  NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS    old assembly address (will be revoked)
 *  OWNER_ADDRESS                               governance/cold wallet → onlyOwner functions
 *                                              (closeSession, setElectableRoles, transferOwnership…)
 *  RELAYER_ADDRESS                             hot automation wallet → openSession, castVoteAsRelayer
 *                                              (must match RELAYER_PRIVATE_KEY used by the cron)
 *
 * ── Address roles ─────────────────────────────────────────────────────────────
 *
 *  The deployer wallet (DEPLOYER_PRIVATE_KEY / RELAYER_PRIVATE_KEY in hardhat.config.ts)
 *  is only used to pay for gas.  It does NOT become owner of the new contract —
 *  ownership goes to OWNER_ADDRESS explicitly.
 *
 *  OWNER_ADDRESS   → Ownable owner  → can call: closeSession, setElectableRoles,
 *                                               transferOwnership, renounceOwnership
 *  RELAYER_ADDRESS → hot wallet     → can call: openSession (via onlyOwnerOrRelayer),
 *                                               castVoteAsRelayer
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId    = (await ethers.provider.getNetwork()).chainId;
  const balance    = await ethers.provider.getBalance(deployer.address);

  console.log("─────────────────────────────────────────────────────────────");
  console.log(`Network  : ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer : ${deployer.address}  ← pays gas only, NOT the owner`);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log("─────────────────────────────────────────────────────────────");

  // ── Validate env vars ───────────────────────────────────────────────────────
  const coreAddr = process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS;
  if (!coreAddr || coreAddr === "0x") throw new Error("NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS is not set");

  const oldAssemblyAddr = process.env.NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS;
  if (!oldAssemblyAddr || oldAssemblyAddr === "0x") throw new Error("NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS is not set (needed for revoke)");

  const ownerAddr = process.env.OWNER_ADDRESS;
  if (!ownerAddr || ownerAddr === "0x") throw new Error("OWNER_ADDRESS is not set — this is the governance wallet that will own the contract");

  const relayerAddr = process.env.RELAYER_ADDRESS;
  if (!relayerAddr || relayerAddr === "0x") throw new Error("RELAYER_ADDRESS is not set — this is the hot wallet used by the cron");

  console.log(`\nAssociationCore (existing)  : ${coreAddr}`);
  console.log(`Old ConstituentAssembly     : ${oldAssemblyAddr}  ← will be revoked`);
  console.log(`New owner (governance)      : ${ownerAddr}  ← onlyOwner functions`);
  console.log(`Relayer (automation)        : ${relayerAddr}  ← openSession + castVoteAsRelayer`);

  // ── 1. Deploy new ConstituentAssembly ──────────────────────────────────────
  console.log("\n[1/3] Deploying new ConstituentAssembly...");
  const AsmF = await ethers.getContractFactory("ConstituentAssembly");
  const assembly = await AsmF.deploy(coreAddr, ownerAddr, relayerAddr);
  await assembly.waitForDeployment();
  const newAddr = await assembly.getAddress();
  console.log(`      ✓ New ConstituentAssembly : ${newAddr}`);
  console.log(`        owner()        = ${ownerAddr}`);
  console.log(`        relayerAddress = ${relayerAddr}`);

  // ── 2. Authorize new assembly in Core ─────────────────────────────────────
  console.log("\n[2/3] Authorizing new assembly in AssociationCore...");
  const CoreAbi = [
    "function authorizeModule(address module) external",
    "function revokeModule(address module) external",
  ];
  const core = new ethers.Contract(coreAddr, CoreAbi, deployer);
  const tx1 = await core.authorizeModule(newAddr);
  await tx1.wait();
  console.log(`      ✓ authorizeModule(${newAddr})`);

  // ── 3. Revoke old assembly ─────────────────────────────────────────────────
  console.log("\n[3/3] Revoking old assembly from AssociationCore...");
  const tx2 = await core.revokeModule(oldAssemblyAddr);
  await tx2.wait();
  console.log(`      ✓ revokeModule(${oldAssemblyAddr})`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("Done. Update the following env var in .env.local and Vercel:");
  console.log(`\n  NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS=${newAddr}\n`);
  console.log("─────────────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
