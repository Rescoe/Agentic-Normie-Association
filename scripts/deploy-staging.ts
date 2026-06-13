/**
 * deploy-staging.ts — Full ANA stack on Base Sepolia
 *
 * Deploys everything fresh:
 *   1. AssociationCore
 *   2. FactoryRegistry
 *   3. ConstituentAssembly  → authorized in Core
 *   4. WorkRegistry
 *   5. CollectionFactory
 *
 * No mock NFT needed: the relayer signs attestations off-chain,
 * so Normies ownership is verified by the relayer (not on-chain).
 * On staging, the relayer can accept any tokenId without NFT check
 * (set STAGING_SKIP_NFT_CHECK=true in .env.local).
 *
 * Run:
 *   npm run deploy:staging
 *
 * Requires in .env.local:
 *   RELAYER_ADDRESS          — the relayer's public address
 *   RELAYER_PRIVATE_KEY      — used as deployer (also becomes temp owner)
 *   VAULT_ADDRESS            — final owner (can be same as relayer for staging)
 */

import { ethers, network } from "hardhat";
import * as fs   from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId    = (await ethers.provider.getNetwork()).chainId;
  const balance    = await ethers.provider.getBalance(deployer.address);

  const relayerAddress = process.env.RELAYER_ADDRESS;
  const vaultAddress   = process.env.VAULT_ADDRESS ?? deployer.address;

  if (!relayerAddress) throw new Error("RELAYER_ADDRESS not set in .env.local");
  if (chainId !== 84532n) throw new Error(`Expected Base Sepolia (84532), got ${chainId}`);

  console.log("══════════════════════════════════════════════════════════");
  console.log("  ANA — STAGING FULL DEPLOY (Base Sepolia)");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`  Network  : ${network.name} (chainId: ${chainId})`);
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  Relayer  : ${relayerAddress}`);
  console.log(`  Vault    : ${vaultAddress}`);
  console.log(`  Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log("══════════════════════════════════════════════════════════\n");

  // ── 1. AssociationCore ────────────────────────────────────────────────────
  console.log("[1/5] Deploying AssociationCore...");
  const CoreF = await ethers.getContractFactory("AssociationCore");
  const core  = await CoreF.deploy(relayerAddress, "Agentic Normie Association", "ANA");
  await core.waitForDeployment();
  const coreAddr = await core.getAddress();
  console.log(`      ✓ ${coreAddr}`);

  // ── 2. FactoryRegistry ────────────────────────────────────────────────────
  console.log("\n[2/5] Deploying FactoryRegistry...");
  const RegF     = await ethers.getContractFactory("FactoryRegistry");
  const registry = await RegF.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`      ✓ ${registryAddr}`);

  // ── 3. ConstituentAssembly ────────────────────────────────────────────────
  console.log("\n[3/5] Deploying ConstituentAssembly...");
  const AsmF    = await ethers.getContractFactory("ConstituentAssembly");
  const assembly = await AsmF.deploy(coreAddr);
  await assembly.waitForDeployment();
  const assemblyAddr = await assembly.getAddress();
  console.log(`      ✓ ${assemblyAddr}`);

  console.log("      → authorizeModule(assembly)...");
  await (await core.authorizeModule(assemblyAddr)).wait();
  console.log("      ✓ authorized");

  // ── 4. WorkRegistry ───────────────────────────────────────────────────────
  console.log("\n[4/5] Deploying WorkRegistry (patched)...");
  const WRF = await ethers.getContractFactory("WorkRegistry");
  const wr  = await WRF.deploy(coreAddr);
  await wr.waitForDeployment();
  const wrAddr = await wr.getAddress();
  console.log(`      ✓ ${wrAddr}`);

  // ── 5. CollectionFactory ──────────────────────────────────────────────────
  console.log("\n[5/5] Deploying CollectionFactory (patched)...");
  const CFF = await ethers.getContractFactory("CollectionFactory");
  const cf  = await CFF.deploy(coreAddr);
  await cf.waitForDeployment();
  const cfAddr = await cf.getAddress();
  console.log(`      ✓ ${cfAddr}`);

  // ── Transfer ownership to vault ───────────────────────────────────────────
  if (vaultAddress !== deployer.address) {
    console.log(`\n→ Transferring ownership to vault (${vaultAddress})...`);
    for (const [label, contract] of [
      ["AssociationCore",     core],
      ["WorkRegistry",        wr],
      ["CollectionFactory",   cf],
    ] as const) {
      await (await (contract as any).transferOwnership(vaultAddress)).wait();
      console.log(`  ✓ ${label}`);
    }
  } else {
    console.log("\n  ⚠ VAULT_ADDRESS not set — owner stays deployer (ok for staging)");
  }

  // ── Save deployment ───────────────────────────────────────────────────────
  const deployment = {
    network:    network.name,
    chainId:    chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer:   deployer.address,
    relayer:    relayerAddress,
    vault:      vaultAddress,
    contracts: {
      AssociationCore:     coreAddr,
      FactoryRegistry:     registryAddr,
      ConstituentAssembly: assemblyAddr,
      WorkRegistry:        wrAddr,
      CollectionFactory:   cfAddr,
    },
  };

  const outDir  = path.join(__dirname, "../deployments");
  const outPath = path.join(outDir, `${chainId}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  // ── Print env vars ────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  COPIE CES VALEURS dans .env.staging ET Vercel (staging):");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS=${coreAddr}
NEXT_PUBLIC_WORK_REGISTRY_ADDRESS=${wrAddr}
NEXT_PUBLIC_COLLECTION_FACTORY_ADDRESS=${cfAddr}
NEXT_PUBLIC_FACTORY_REGISTRY_ADDRESS=${registryAddr}
NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS=${assemblyAddr}

# Normies NFT — pointe vers un mock ou laisse vide sur staging
# NORMIES_CONTRACT_ADDRESS=<mock_address_or_leave_empty>
STAGING_SKIP_NFT_CHECK=true
`);
  console.log("══════════════════════════════════════════════════════════");
  console.log(`  Deployment saved → deployments/${chainId}.json`);
  console.log("\n  Verify (optionnel):");
  console.log(`  npx hardhat verify --network baseSepolia ${coreAddr} "${relayerAddress}" "Agentic Normie Association" "ANA"`);
  console.log(`  npx hardhat verify --network baseSepolia ${wrAddr} "${coreAddr}"`);
  console.log(`  npx hardhat verify --network baseSepolia ${cfAddr} "${coreAddr}"`);
  console.log("══════════════════════════════════════════════════════════");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
