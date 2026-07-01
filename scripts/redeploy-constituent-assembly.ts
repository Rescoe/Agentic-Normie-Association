import { ethers, network } from "hardhat";

/**
 * Redeploy ConstituentAssembly only.
 *
 * Use this when the ConstituentAssembly contract is upgraded (e.g. to add the
 * onlyOwnerOrRelayer modifier on openSession) without touching the rest of the
 * stack.  AssociationCore, WorkRegistry, and all NFT collections are unchanged.
 *
 * What this script does:
 *  1. Deploys a new ConstituentAssembly pointing at the EXISTING AssociationCore
 *  2. Calls core.authorizeModule(newAssembly)   — grants governance write access
 *  3. Calls core.revokeModule(oldAssembly)       — removes old contract's access
 *
 * After running:
 *  - Update NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS in .env.local (+ Vercel)
 *  - Regenerate the ABI in src/lib/abis/ConstituentAssembly.ts if the ABI changed
 *
 * Run:
 *  npx hardhat run scripts/redeploy-constituent-assembly.ts --network base
 *
 * ── Address roles reminder ────────────────────────────────────────────────────
 *  DEPLOYER   = whichever wallet signs this tx (Ownable(msg.sender)) — stays owner
 *  RELAYER    = RELAYER_ADDRESS env var — now also allowed to call openSession()
 *  OLD_ASSEMBLY = current NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS — will be revoked
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId    = (await ethers.provider.getNetwork()).chainId;
  const balance    = await ethers.provider.getBalance(deployer.address);

  console.log("─────────────────────────────────────────────────────────────");
  console.log(`Network        : ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer/Owner : ${deployer.address}`);
  console.log(`Balance        : ${ethers.formatEther(balance)} ETH`);
  console.log("─────────────────────────────────────────────────────────────");

  const coreAddr = process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS;
  if (!coreAddr || coreAddr === "0x") {
    throw new Error("NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS is not set");
  }

  const oldAssemblyAddr = process.env.NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS;
  if (!oldAssemblyAddr || oldAssemblyAddr === "0x") {
    throw new Error("NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS is not set (needed for revoke)");
  }

  console.log(`\nAssociationCore (existing) : ${coreAddr}`);
  console.log(`Old ConstituentAssembly    : ${oldAssemblyAddr}  ← will be revoked`);

  // ── 1. Deploy new ConstituentAssembly ──────────────────────────────────────
  console.log("\n[1/3] Deploying new ConstituentAssembly...");
  const AsmF     = await ethers.getContractFactory("ConstituentAssembly");
  const assembly = await AsmF.deploy(coreAddr);
  await assembly.waitForDeployment();
  const newAddr = await assembly.getAddress();
  console.log(`      ✓ New ConstituentAssembly : ${newAddr}`);

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
  console.log("Then regenerate the ABI if the contract interface changed:");
  console.log("  npx hardhat compile");
  console.log("  (copy artifacts/contracts/governance/ConstituentAssembly.sol/ConstituentAssembly.json ABI to src/lib/abis/)");
  console.log("─────────────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
