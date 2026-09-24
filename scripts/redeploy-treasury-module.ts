import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Redeploy TreasuryModule pointing at a (typically newly redeployed)
 * AssociationCore.
 *
 * TreasuryModule only READS Core (to resolve the current holder of each role
 * when splitting incoming revenue in _distribute()) — no authorization call
 * needed on Core. Default role allocations (25/20/15/10/5/5%, 20% reserve)
 * are set in the constructor; not reconfigured here.
 *
 * Note for whoever runs this next: _distribute() pays
 * core.getRoleHolder(role).holderAddress directly, with NO relayer fallback
 * for role holders who never registered a personal wallet (unlike
 * ANACollectionFactory/ANAMemorials, which do fall back to the relayer).
 * Worth checking with scripts/check-relayer.ts after the whole redeploy is
 * done, once real roles are re-elected on the new ConstituentAssembly.
 *
 * Required env var:
 *  - NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS — the (new) AssociationCore to point at
 *
 * Run:
 *  npx hardhat run scripts/redeploy-treasury-module.ts --network base
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId    = (await ethers.provider.getNetwork()).chainId;
  const balance    = await ethers.provider.getBalance(deployer.address);

  console.log("─────────────────────────────────────────────────────");
  console.log(`Network  : ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer : ${deployer.address}  ← pays gas AND becomes owner (Ownable(msg.sender))`);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log("─────────────────────────────────────────────────────");

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const deploymentFile = path.join(deploymentsDir, `${chainId}.json`);
  let existing: Record<string, string> = {};
  if (fs.existsSync(deploymentFile)) {
    existing = JSON.parse(fs.readFileSync(deploymentFile, "utf-8"));
    console.log("Loaded existing deployment:", existing);
  }

  const coreAddr = existing.AssociationCore ?? process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS;
  if (!coreAddr || coreAddr === "0x") throw new Error("NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS is not set (or missing from deployments/<chainId>.json)");

  console.log(`\nCore : ${coreAddr}\n`);

  console.log("[1/1] Deploying TreasuryModule...");
  const TreasuryF = await ethers.getContractFactory("TreasuryModule");
  const treasury  = await TreasuryF.deploy(coreAddr);
  await treasury.waitForDeployment();
  const addr = await treasury.getAddress();
  console.log(`      ✓ TreasuryModule : ${addr}`);

  const updated = { ...existing, TreasuryModule: addr };
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(updated, null, 2));

  console.log("\n─────────────────────────────────────────────────────");
  console.log("✅ Deployment complete!");
  console.log(`\nAdd to .env.local / Vercel:\n  NEXT_PUBLIC_TREASURY_MODULE_ADDRESS=${addr}`);
  console.log("\nNote: ANACollectionFactory's redeploy (deploy-editions.ts) reads this");
  console.log("var too — redeploy Treasury BEFORE ANACollectionFactory, not after.");
  console.log("─────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
