import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy all ANA contracts in the correct dependency order.
 *
 * Order:
 *  1. AssociationCore (relayerAddress from env)
 *  2. FactoryRegistry
 *  3. ConstituentAssembly (institutional roles only)
 *  4. core.authorizeModule(assembly)
 *  5. WorkRegistry
 *  6. Save addresses to deployments/<chainId>.json
 *
 * Run:
 *  npm run deploy:sepolia
 *  npm run deploy:base
 *
 * ── Two DIFFERENT addresses are involved, do not confuse them ──────────────
 *
 *  DEPLOYER (whichever wallet's DEPLOYER_PRIVATE_KEY/RELAYER_PRIVATE_KEY in
 *  hardhat.config.ts actually broadcasts this script) becomes the OWNER of
 *  every Ownable contract here (`Ownable(msg.sender)` in each constructor —
 *  this is implicit, never an explicit constructor argument). The owner is
 *  the ONLY address that can call onlyOwner functions: authorizeModule(),
 *  openSession()/closeSession() on ConstituentAssembly, setRelayer(), etc.
 *  This is the governance authority — keep it cold/safe.
 *
 *  RELAYER_ADDRESS (env var, passed explicitly to AssociationCore's
 *  constructor below) is a SEPARATE hot automation wallet. It can only do
 *  the specific things the contracts explicitly grant it: relay EIP-712
 *  registration attestations, cast votes on members' behalf
 *  (castVoteAsRelayer), call ANAEditions.initialize(). It can NEVER call an
 *  onlyOwner function, including openSession() — that's why automated
 *  cron jobs using this key cannot open an election session by themselves.
 *
 *  A third role, the TreasuryModule / "association vault" address used by
 *  scripts/deploy-editions.ts, is yet another distinct thing again: a pure
 *  payment destination with NO admin power at all, just where revenue
 *  shares get sent.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId    = (await ethers.provider.getNetwork()).chainId;
  const balance    = await ethers.provider.getBalance(deployer.address);

  console.log("─────────────────────────────────────────");
  console.log(`Network  : ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer : ${deployer.address}  ← becomes OWNER of every contract below (Ownable(msg.sender))`);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log("─────────────────────────────────────────");

  const relayerAddress = process.env.RELAYER_ADDRESS;
  if (!relayerAddress || relayerAddress === "0x...") {
    throw new Error("RELAYER_ADDRESS is not set in .env.local");
  }
  console.log(`Relayer  : ${relayerAddress}  ← separate hot wallet, NOT the owner — cannot call onlyOwner functions\n`);

  // ── 1. AssociationCore ────────────────────────────────────────────────────
  console.log("\n[1/5] Deploying AssociationCore...");
  const CoreF = await ethers.getContractFactory("AssociationCore");
  const core  = await CoreF.deploy(
    relayerAddress,
    "Agentic Normie Association",
    "ANA"
  );
  await core.waitForDeployment();
  console.log(`      ✓ AssociationCore : ${await core.getAddress()}`);

  // ── 2. FactoryRegistry ────────────────────────────────────────────────────
  console.log("\n[2/5] Deploying FactoryRegistry...");
  const RegF     = await ethers.getContractFactory("FactoryRegistry");
  const registry = await RegF.deploy();
  await registry.waitForDeployment();
  console.log(`      ✓ FactoryRegistry : ${await registry.getAddress()}`);

  // ── 3. ConstituentAssembly (roles hardcoded in contract from Roles.sol) ──────
  console.log("\n[3/5] Deploying ConstituentAssembly...");
  const AsmF    = await ethers.getContractFactory("ConstituentAssembly");
  const assembly = await AsmF.deploy(await core.getAddress());
  await assembly.waitForDeployment();
  console.log(`      ✓ ConstituentAssembly : ${await assembly.getAddress()}`);

  // ── 4. Authorize assembly in Core ─────────────────────────────────────────
  console.log("\n[4/5] Authorizing ConstituentAssembly in Core...");
  const tx = await core.authorizeModule(await assembly.getAddress());
  await tx.wait();
  console.log(`      ✓ Assembly authorized`);

  // ── 5. WorkRegistry ───────────────────────────────────────────────────────
  console.log("\n[5/5] Deploying WorkRegistry...");
  const WRF          = await ethers.getContractFactory("WorkRegistry");
  const workRegistry = await WRF.deploy(await core.getAddress());
  await workRegistry.waitForDeployment();
  console.log(`      ✓ WorkRegistry : ${await workRegistry.getAddress()}`);

  // ── Save addresses ─────────────────────────────────────────────────────────
  const deployment = {
    network:    network.name,
    chainId:    chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer:   deployer.address, // also the OWNER of every Ownable contract deployed here
    relayer:    relayerAddress,   // separate hot wallet — cannot call onlyOwner functions
    contracts: {
      AssociationCore:      await core.getAddress(),
      FactoryRegistry:      await registry.getAddress(),
      ConstituentAssembly:  await assembly.getAddress(),
      WorkRegistry:         await workRegistry.getAddress(),
    },
  };

  const outDir  = path.join(__dirname, "../deployments");
  const outPath = path.join(outDir, `${chainId}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  console.log("\n─────────────────────────────────────────");
  console.log(`Deployment saved → deployments/${chainId}.json`);
  console.log("\nNext steps:");
  console.log("  1. Copy contract addresses to .env.local (NEXT_PUBLIC_*)");
  console.log("  2. Verify on Basescan: npx hardhat verify --network <net> <addr> <args>");
  console.log("─────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
