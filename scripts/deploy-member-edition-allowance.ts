import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy MemberEditionAllowance — sponsors one free edition mint per registered
 * ANA member per published collection. Does not touch AssociationCore,
 * WorkRegistry, ANACollectionFactory or ANAEditions.
 *
 * Required env vars:
 *  - CORE_ADDRESS     — deployed AssociationCore address (source of truth for membership)
 *  - RELAYER_ADDRESS  — pre-authorized to open/close allowances (same relayer
 *                       wallet used everywhere else in the pipeline)
 *
 * Run:
 *  npx hardhat run scripts/deploy-member-edition-allowance.ts --network base
 *
 * After deploy:
 *  1. Add to .env.local / Vercel:
 *       NEXT_PUBLIC_MEMBER_EDITION_ALLOWANCE_ADDRESS=<deployed address>
 *  2. Fund its sponsorship pool — it pays for every free claim out of its own
 *     balance. Send ETH directly to the deployed address, or call
 *     fundSponsorship() from the admin panel once wired up.
 *  3. After each new collection is published, the relayer must call
 *     openAllowance(editionsAddr) before members can claim.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId    = (await ethers.provider.getNetwork()).chainId;
  const balance    = await ethers.provider.getBalance(deployer.address);

  console.log("─────────────────────────────────────────────────────");
  console.log(`Network            : ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer           : ${deployer.address}`);
  console.log(`Balance            : ${ethers.formatEther(balance)} ETH`);
  console.log("─────────────────────────────────────────────────────");

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `${chainId}.json`);
  let existing: Record<string, string> = {};
  if (fs.existsSync(deploymentFile)) {
    existing = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    console.log("Loaded existing deployment:", existing);
  }

  const coreAddress = process.env.CORE_ADDRESS ?? existing.AssociationCore;
  if (!coreAddress) throw new Error("CORE_ADDRESS not set and no AssociationCore found in deployments file");
  const relayerAddress = process.env.RELAYER_ADDRESS ?? deployer.address;

  console.log(`\nAssociationCore : ${coreAddress}`);
  console.log(`Relayer         : ${relayerAddress} (authorized to open/close allowances)\n`);

  console.log("[1/1] Deploying MemberEditionAllowance...");
  const AllowanceF = await ethers.getContractFactory("MemberEditionAllowance");
  const allowance  = await AllowanceF.deploy(deployer.address, coreAddress, relayerAddress);
  await allowance.waitForDeployment();
  const allowanceAddr = await allowance.getAddress();
  console.log(`      ✓ MemberEditionAllowance : ${allowanceAddr}`);

  const updated = { ...existing, MemberEditionAllowance: allowanceAddr };
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(updated, null, 2));

  console.log("\n─────────────────────────────────────────────────────");
  console.log("✅ Deployment complete!");
  console.log(`\nAdd to .env / Vercel:\n  NEXT_PUBLIC_MEMBER_EDITION_ALLOWANCE_ADDRESS=${allowanceAddr}`);
  console.log("\nDon't forget to fund its sponsorship pool — it pays for every");
  console.log("free claim out of its own ETH balance. And call openAllowance(editionsAddr)");
  console.log("after each new collection publishes, before members can claim.");
  console.log("─────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
