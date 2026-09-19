import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy ANAMemorials — the shared, all-burn-memorials-in-one collection that
 * replaces the old one-ANAEditions-per-memorial pattern.
 *
 * Required env vars:
 *  - RELAYER_ADDRESS       — pre-authorized to registerMemorial()/addReservedClaims()
 *                            (same relayer wallet used everywhere else in the pipeline)
 *  - ASSOCIATION_CORE_ADDRESS or NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS
 *                          — AssociationCore, source of truth for creator payout resolution
 *  - VAULT_ADDRESS         — where the relayer's 50% share of every paid mint goes.
 *                            Defaults to RELAYER_ADDRESS itself if unset (the whole point
 *                            of this contract is keeping the relayer solvent).
 *
 * Run:
 *  npx hardhat run scripts/deploy-ana-memorials.ts --network base
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

  const relayerAddress = process.env.RELAYER_ADDRESS;
  const coreAddress     = process.env.ASSOCIATION_CORE_ADDRESS
    ?? process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS
    ?? existing.AssociationCore;
  const vaultAddress    = process.env.VAULT_ADDRESS ?? relayerAddress;

  if (!relayerAddress) throw new Error("RELAYER_ADDRESS env var is required");
  if (!coreAddress)    throw new Error("ASSOCIATION_CORE_ADDRESS (or NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS, or deployments/<chainId>.json) is required");
  if (!vaultAddress)   throw new Error("VAULT_ADDRESS env var is required (or set RELAYER_ADDRESS, used as the default)");

  console.log(`\nRelayer  : ${relayerAddress} (authorized to register memorials / add reserved claims)`);
  console.log(`Core     : ${coreAddress} (creator payout resolution)`);
  console.log(`Vault    : ${vaultAddress} (receives the relayer's 50% share of every paid mint)\n`);

  console.log("[1/1] Deploying ANAMemorials...");
  const MemorialsF = await ethers.getContractFactory("ANAMemorials");
  const memorials  = await MemorialsF.deploy(deployer.address, relayerAddress, coreAddress, vaultAddress);
  await memorials.waitForDeployment();
  const memorialsAddr = await memorials.getAddress();
  console.log(`      ✓ ANAMemorials : ${memorialsAddr}`);

  const updated = { ...existing, ANAMemorials: memorialsAddr };
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(updated, null, 2));

  console.log("\n─────────────────────────────────────────────────────");
  console.log("✅ Deployment complete!");
  console.log(`\nAdd to .env.local / Vercel:\n  NEXT_PUBLIC_ANA_MEMORIALS_ADDRESS=${memorialsAddr}`);
  console.log("\nNo setter call needed on any existing contract — this deployment is additive only.");
  console.log("─────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
