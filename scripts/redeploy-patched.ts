/**
 * Redeploy script — PATCH ONLY
 *
 * Redeploys WorkRegistry + CollectionFactory with the relayer-auth fix,
 * then immediately transfers ownership to the vault address.
 *
 * Flow:
 *   relayer wallet deploys → owns contracts for ~2 txs → transferOwnership(vault) → vault owns
 *
 * Requires in .env.local:
 *   RELAYER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY  (used as deployer)
 *   NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS          (existing core — unchanged)
 *   VAULT_ADDRESS                                 (final owner of new contracts)
 *
 * Run:
 *   npx hardhat run scripts/redeploy-patched.ts --network base
 */

import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId    = (await ethers.provider.getNetwork()).chainId;
  const balance    = await ethers.provider.getBalance(deployer.address);

  const coreAddr  = process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS;
  const vaultAddr = process.env.VAULT_ADDRESS;

  console.log("─────────────────────────────────────────────────────");
  console.log("  ANA — PATCH REDEPLOY (WorkRegistry + CollectionFactory)");
  console.log("─────────────────────────────────────────────────────");
  console.log(`  Network  : ${network.name} (chainId: ${chainId})`);
  console.log(`  Deployer : ${deployer.address}  (relayer — temp owner)`);
  console.log(`  Vault    : ${vaultAddr ?? "⚠ NOT SET — ownership will stay with deployer"}`);
  console.log(`  Balance  : ${ethers.formatEther(balance)} ETH`);
  console.log(`  Core     : ${coreAddr}  (unchanged)`);
  console.log("─────────────────────────────────────────────────────\n");

  if (!coreAddr) throw new Error("NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS not set in .env.local");

  // ── 1. WorkRegistry ───────────────────────────────────────────────────────

  console.log("[1/2] Deploying WorkRegistry (patched)...");
  const WRF = await ethers.getContractFactory("WorkRegistry");
  const wr  = await WRF.deploy(coreAddr);
  await wr.waitForDeployment();
  const wrAddr = await wr.getAddress();
  console.log(`      ✓ deployed : ${wrAddr}`);

  if (vaultAddr) {
    console.log(`      → transferOwnership(${vaultAddr})...`);
    const tx = await wr.transferOwnership(vaultAddr);
    await tx.wait();
    console.log(`      ✓ owner = vault\n`);
  } else {
    console.log(`      ⚠ no VAULT_ADDRESS — owner stays ${deployer.address}\n`);
  }

  // ── 2. CollectionFactory ──────────────────────────────────────────────────

  console.log("[2/2] Deploying CollectionFactory (patched)...");
  const CFF = await ethers.getContractFactory("CollectionFactory");
  const cf  = await CFF.deploy(coreAddr);
  await cf.waitForDeployment();
  const cfAddr = await cf.getAddress();
  console.log(`      ✓ deployed : ${cfAddr}`);

  if (vaultAddr) {
    console.log(`      → transferOwnership(${vaultAddr})...`);
    const tx = await cf.transferOwnership(vaultAddr);
    await tx.wait();
    console.log(`      ✓ owner = vault\n`);
  } else {
    console.log(`      ⚠ no VAULT_ADDRESS — owner stays ${deployer.address}\n`);
  }

  // ── Print update instructions ─────────────────────────────────────────────

  console.log("─────────────────────────────────────────────────────");
  console.log("  UPDATE THESE VALUES in .env.local AND Vercel:");
  console.log("─────────────────────────────────────────────────────");
  console.log(`\nWORK_REGISTRY_ADDRESS=${wrAddr}`);
  console.log(`NEXT_PUBLIC_WORK_REGISTRY_ADDRESS=${wrAddr}`);
  console.log(`\nCOLLECTION_FACTORY_ADDRESS=${cfAddr}`);
  console.log(`NEXT_PUBLIC_COLLECTION_FACTORY_ADDRESS=${cfAddr}`);
  console.log("\n─────────────────────────────────────────────────────");
  if (vaultAddr) {
    console.log(`  Owner of both contracts : ${vaultAddr} (vault) ✓`);
  }
  console.log(`  Relayer authorized in   : ${coreAddr} (AssociationCore)`);
  console.log("\n  Basescan verify (optional):");
  console.log(`  npx hardhat verify --network base ${wrAddr} "${coreAddr}"`);
  console.log(`  npx hardhat verify --network base ${cfAddr} "${coreAddr}"`);
  console.log("─────────────────────────────────────────────────────");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
