/**
 * attestationRelayer.ts
 *
 * Signs EIP-712 OwnershipAttestation structs.
 *
 * Flow:
 *   1. Caller provides tokenId + claimedOwner
 *   2. Relayer verifies ownerOf on Ethereum mainnet
 *   3. Relayer generates a nonce and sets a deadline
 *   4. Relayer signs the EIP-712 typed data with RELAYER_PRIVATE_KEY
 *   5. Returns { attestation, signature } to the API route
 *
 * The on-chain contract (AssociationCore) will:
 *   - Verify the signature against the registered relayer address
 *   - Verify the attestation fields match the transaction context
 *   - Consume the nonce (replay protection)
 */

import { createWalletClient, http, keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { getNormieOwnerOnMainnet } from "./normiesOwnership";
import { generateNonce } from "./nonceStore";

// ─── Config ───────────────────────────────────────────────────────────────────

const RELAYER_PRIVATE_KEY =
  process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;

const ASSOCIATION_CORE_ADDRESS =
  process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS as `0x${string}` | undefined;

const TARGET_CHAIN_ID =
  process.env.NEXT_PUBLIC_CHAIN === "base" ? 8453 : 84532;

const TARGET_CHAIN = process.env.NEXT_PUBLIC_CHAIN === "base" ? base : baseSepolia;

// Attestation valid for 15 minutes
const DEADLINE_BUFFER_SECONDS = 15 * 60;

// EIP-712 domain MUST match the constructor exactly : EIP712("ANACore", "1")
const DOMAIN_NAME = "ANACore";
const DOMAIN_VERSION = "1";

// ACTION_REGISTER = keccak256("REGISTER") — mirrors AssociationCore.ACTION_REGISTER
const ACTION_REGISTER = keccak256(stringToBytes("REGISTER"));

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AttestationPayload {
  tokenId: bigint;
  ownerAddress: `0x${string}`;
  targetChainId: bigint;
  targetAssociationCore: `0x${string}`;
  action: `0x${string}`;
  nonce: bigint;
  deadline: bigint;
}

export interface AttestationResult {
  attestation: AttestationPayload;
  signature: `0x${string}`;
}

// ─── EIP-712 Types ────────────────────────────────────────────────────────────

const ATTESTATION_TYPES = {
  OwnershipAttestation: [
    { name: "tokenId",              type: "uint256" },
    { name: "ownerAddress",         type: "address" },
    { name: "targetChainId",        type: "uint256" },
    { name: "targetAssociationCore", type: "address" },
    { name: "action",               type: "bytes32" },
    { name: "nonce",                type: "uint256" },
    { name: "deadline",             type: "uint256" },
  ],
} as const;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Verifies ownership of a Normie token on Ethereum mainnet and returns a
 * signed EIP-712 attestation that can be submitted to AssociationCore.register().
 *
 * @throws Error with a human-readable message if anything fails
 */
export async function createAttestation(
  tokenId: number,
  claimedOwner: `0x${string}`
): Promise<AttestationResult> {
  // Guard: relayer key must be configured
  if (!RELAYER_PRIVATE_KEY) {
    throw new Error("Relayer not configured: RELAYER_PRIVATE_KEY missing");
  }
  if (!ASSOCIATION_CORE_ADDRESS) {
    throw new Error(
      "Contract not deployed: NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS missing"
    );
  }

  // Step 1: Verify ownership on mainnet
  // On staging (STAGING_SKIP_NFT_CHECK=true) skip on-chain verification
  // so we can test the full register flow without a real Normies NFT.
  const skipNftCheck = process.env.STAGING_SKIP_NFT_CHECK === "true";
  if (!skipNftCheck) {
    const actualOwner = await getNormieOwnerOnMainnet(tokenId);
    if (!actualOwner) {
      throw new Error(
        `Cannot verify ownership of Normie #${tokenId} on Ethereum mainnet`
      );
    }
    if (actualOwner.toLowerCase() !== claimedOwner.toLowerCase()) {
      throw new Error(
        `Normie #${tokenId} is not owned by ${claimedOwner} (owner: ${actualOwner})`
      );
    }
  }

  // Step 2: Build attestation
  const nonce = generateNonce(tokenId);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_BUFFER_SECONDS);

  const attestation: AttestationPayload = {
    tokenId:              BigInt(tokenId),
    ownerAddress:         claimedOwner,
    targetChainId:        BigInt(TARGET_CHAIN_ID),
    targetAssociationCore: ASSOCIATION_CORE_ADDRESS,
    action:               ACTION_REGISTER,
    nonce,
    deadline,
  };

  // Step 3: Sign with relayer key
  const account = privateKeyToAccount(RELAYER_PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: TARGET_CHAIN,
    transport: http(),
  });

  const signature = await walletClient.signTypedData({
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: TARGET_CHAIN_ID,
      verifyingContract: ASSOCIATION_CORE_ADDRESS,
    },
    types: ATTESTATION_TYPES,
    primaryType: "OwnershipAttestation",
    message: attestation,
  });

  return { attestation, signature };
}
