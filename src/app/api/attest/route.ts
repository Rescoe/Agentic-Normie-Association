/**
 * POST /api/attest
 *
 * Request body:
 *   { tokenId: number, ownerAddress: string }
 *
 * Response (200):
 *   {
 *     attestation: {
 *       tokenId: string,          // bigint serialized as decimal string
 *       ownerAddress: string,
 *       targetChainId: string,
 *       targetAssociationCore: string,
 *       action: string,           // bytes32 hex
 *       nonce: string,
 *       deadline: string,
 *     },
 *     signature: string           // 0x... hex
 *   }
 *
 * Response (400 / 403 / 500):
 *   { error: string }
 *
 * Security:
 *   - Rate limiting should be added at the reverse-proxy / Vercel edge level
 *   - The relayer verifies ownership on mainnet before signing
 *   - Signed attestations expire after 15 minutes (deadline field)
 *   - On-chain nonce tracking prevents replay attacks
 */

import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { createAttestation } from "@/server/relayer/attestationRelayer";

export async function POST(req: NextRequest) {
  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { tokenId, ownerAddress } = body as Record<string, unknown>;

  // Validate tokenId
  if (typeof tokenId !== "number" || !Number.isInteger(tokenId) || tokenId < 0) {
    return NextResponse.json(
      { error: "tokenId must be a non-negative integer" },
      { status: 400 }
    );
  }

  // Validate ownerAddress
  if (typeof ownerAddress !== "string" || !isAddress(ownerAddress)) {
    return NextResponse.json(
      { error: "ownerAddress must be a valid Ethereum address" },
      { status: 400 }
    );
  }

  const checksummedOwner = getAddress(ownerAddress);

  // Create attestation (verifies ownership on mainnet, signs EIP-712)
  try {
    const { attestation, signature } = await createAttestation(
      tokenId,
      checksummedOwner
    );

    // BigInts must be serialized as strings for JSON transport.
    // The frontend reconstructs them via BigInt(value).
    return NextResponse.json({
      attestation: {
        tokenId:               attestation.tokenId.toString(),
        ownerAddress:          attestation.ownerAddress,
        targetChainId:         attestation.targetChainId.toString(),
        targetAssociationCore: attestation.targetAssociationCore,
        action:                attestation.action,
        nonce:                 attestation.nonce.toString(),
        deadline:              attestation.deadline.toString(),
      },
      signature,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // Ownership mismatch → 403
    if (message.includes("not owned by")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    // Cannot verify (API/RPC down) → 503
    if (message.includes("Cannot verify")) {
      return NextResponse.json({ error: message }, { status: 503 });
    }

    // Config error (missing keys) → 500
    if (message.includes("not configured") || message.includes("not deployed")) {
      return NextResponse.json({ error: "Relayer not available" }, { status: 500 });
    }

    // Unexpected
    console.error("[/api/attest]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
