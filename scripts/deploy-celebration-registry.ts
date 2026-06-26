import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy CelebrationRegistry.
 *
 * Required env vars:
 *  - RELAYER_ADDRESS  — pre-authorized to register/link celebrations (same relayer
 *                       wallet used everywhere else in the pipeline)
 *
 * Run:
 *  npx hardhat run scripts/deploy-celebration-registry.ts --network base
 *
 * After deploy:
 *  1. Add to .env.local / Vercel:
 *       NEXT_PUBLIC_CELEBRATION_REGISTRY_ADDRESS=<deployed address>
 *  2. Fund its sponsorship pool (it pays for sponsored claims out of its own
 *     balance) — send ETH directly to the deployed address, or call
 *     fundSponsorship() from the admin panel once wired up.
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

  const relayerAddress = process.env.RELAYER_ADDRESS ?? deployer.address;
  console.log(`\nRelayer  : ${relayerAddress} (authorized to register/link celebrations)\n`);

  console.log("[1/1] Deploying CelebrationRegistry...");
  const RegistryF = await ethers.getContractFactory("CelebrationRegistry");
  const registry  = await RegistryF.deploy(deployer.address, relayerAddress);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`      ✓ CelebrationRegistry : ${registryAddr}`);

  const updated = { ...existing, CelebrationRegistry: registryAddr };
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(updated, null, 2));

  console.log("\n─────────────────────────────────────────────────────");
  console.log("✅ Deployment complete!");
  console.log(`\nAdd to .env / Vercel:\n  NEXT_PUBLIC_CELEBRATION_REGISTRY_ADDRESS=${registryAddr}`);
  console.log("\nDon't forget to fund its sponsorship pool — it pays for every");
  console.log("sponsored claim out of its own ETH balance.");
  console.log("─────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
