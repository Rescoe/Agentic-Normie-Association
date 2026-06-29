import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy ANACollectionFactory (+ register in FactoryRegistry under "ANA_EDITIONS").
 *
 * Prerequisites (already deployed):
 *  - AssociationCore
 *  - TreasuryModule (= ANA on-chain vault)
 *  - FactoryRegistry
 *
 * Required env vars:
 *  - NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS — AssociationCore (claimFree() membership gate on every collection)
 *  - NEXT_PUBLIC_TREASURY_MODULE_ADDRESS  — ANA on-chain vault (associationAddr)
 *  - PLATFORM_ADDRESS                     — Real human loi 1901 association wallet (5% platform fee)
 *
 * Optional env vars:
 *  - NEXT_PUBLIC_CELEBRATION_REGISTRY_ADDRESS — if set, authorized as a free-minter
 *    on every newly deployed collection (CelebrationRegistry.claim() needs this to
 *    call ANAEditions.mintFreeTo()). Can also be wired later via setCelebrationRegistry().
 *
 * Run:
 *  npx hardhat run scripts/deploy-editions.ts --network base
 *
 * After deploy, add to .env.local:
 *  NEXT_PUBLIC_ANA_COLLECTION_FACTORY_ADDRESS=<deployed address>
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

  // Load existing deployment if present
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `${chainId}.json`);
  let existing: Record<string, string> = {};
  if (fs.existsSync(deploymentFile)) {
    existing = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    console.log("Loaded existing deployment:", existing);
  }

  const relayerAddress     = process.env.RELAYER_ADDRESS ?? deployer.address;
  const treasuryAddress    = existing.TreasuryModule ?? process.env.NEXT_PUBLIC_TREASURY_MODULE_ADDRESS;
  const platformAddress    = process.env.PLATFORM_ADDRESS;
  const coreAddress        = existing.AssociationCore ?? process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS;
  const registryAddress    = existing.FactoryRegistry ?? process.env.NEXT_PUBLIC_FACTORY_REGISTRY_ADDRESS;
  const celebrationAddress = existing.CelebrationRegistry ?? process.env.NEXT_PUBLIC_CELEBRATION_REGISTRY_ADDRESS;

  if (!treasuryAddress) throw new Error("TreasuryModule address required (NEXT_PUBLIC_TREASURY_MODULE_ADDRESS)");
  if (!platformAddress) throw new Error("Platform address required (PLATFORM_ADDRESS) — real human loi 1901 association wallet");
  if (!coreAddress)     throw new Error("AssociationCore address required (NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS) — claimFree() membership gate");

  console.log(`\nRelayer     : ${relayerAddress}`);
  console.log(`Vault       : ${treasuryAddress}  (ANA on-chain TreasuryModule)`);
  console.log(`Platform    : ${platformAddress}  (loi 1901 human association — 5% fee)`);
  console.log(`Core        : ${coreAddress}  (claimFree() membership gate on every collection)`);
  console.log(`Celebration : ${celebrationAddress ?? "(not wiring — free celebration claims won't work until set)"}`);
  console.log(`Registry    : ${registryAddress ?? "(not wiring — set manually)"}\n`);

  // ── Deploy ANACollectionFactory ───────────────────────────────────────────
  console.log("[1/2] Deploying ANACollectionFactory...");
  const FactoryF  = await ethers.getContractFactory("ANACollectionFactory");
  const factory   = await FactoryF.deploy(
    deployer.address,   // initialOwner
    relayerAddress,     // pre-authorized minter
    treasuryAddress,    // ANA on-chain vault (associationAddr)
    platformAddress,    // real human association (5% platform fee on all sales)
    coreAddress,        // AssociationCore — claimFree() membership gate
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log(`      ✓ ANACollectionFactory : ${factoryAddr}`);

  if (celebrationAddress) {
    console.log(`\nWiring CelebrationRegistry as free-minter on future collections...`);
    const tx = await factory.setCelebrationRegistry(celebrationAddress);
    await tx.wait();
    console.log(`      ✓ setCelebrationRegistry(${celebrationAddress})`);
  }

  // ── Register in FactoryRegistry (optional — requires registry ownership) ──
  if (registryAddress) {
    try {
      console.log("\n[2/2] Registering in FactoryRegistry...");
      const reg = await ethers.getContractAt("FactoryRegistry", registryAddress);
      const factoryType = ethers.keccak256(ethers.toUtf8Bytes("ANA_EDITIONS"));
      const tx = await reg.registerFactory(factoryType, factoryAddr);
      await tx.wait();
      console.log(`      ✓ Registered under keccak256("ANA_EDITIONS") = ${factoryType}`);
    } catch (e) {
      console.warn(`      ⚠ Could not register in FactoryRegistry (deployer may not be owner): ${e}`);
      console.warn(`        Register manually: FactoryRegistry.registerFactory(keccak256("ANA_EDITIONS"), "${factoryAddr}")`);
    }
  } else {
    console.log("[2/2] Skipping FactoryRegistry registration (address not provided)");
  }

  // ── Persist deployment ────────────────────────────────────────────────────
  const updated = { ...existing, ANACollectionFactory: factoryAddr };
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(updated, null, 2));

  console.log("\n─────────────────────────────────────────────────────");
  console.log("✅ Deployment complete!");
  console.log(`\nAdd to .env / Vercel:\n  NEXT_PUBLIC_ANA_COLLECTION_FACTORY_ADDRESS=${factoryAddr}`);
  console.log("─────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
