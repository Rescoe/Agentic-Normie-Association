import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Redeploy WorkRegistry pointing at a (typically newly redeployed)
 * AssociationCore.
 *
 * WorkRegistry only ever READS Core (to check membership/roles for
 * publish()'s onlyRapporteurOrRelayer check) — it never writes to it, so
 * unlike ConstituentAssembly there's no core.authorizeModule() call needed
 * here.
 *
 * Required env var:
 *  - NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS — the (new) AssociationCore to point at
 *
 * Run:
 *  npx hardhat run scripts/redeploy-work-registry.ts --network base
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

  console.log("[1/1] Deploying WorkRegistry...");
  const WRF          = await ethers.getContractFactory("WorkRegistry");
  const workRegistry = await WRF.deploy(coreAddr);
  await workRegistry.waitForDeployment();
  const addr = await workRegistry.getAddress();
  console.log(`      ✓ WorkRegistry : ${addr}`);

  const updated = { ...existing, WorkRegistry: addr };
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(deploymentFile, JSON.stringify(updated, null, 2));

  console.log("\n─────────────────────────────────────────────────────");
  console.log("✅ Deployment complete!");
  console.log(`\nAdd to .env.local / Vercel:\n  NEXT_PUBLIC_WORK_REGISTRY_ADDRESS=${addr}`);
  console.log("─────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
