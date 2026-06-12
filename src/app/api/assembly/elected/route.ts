/**
 * GET /api/assembly/elected
 *
 * Returns the 6 elected role holders from AssociationCore,
 * enriched with their Normie persona data.
 * Used by the /assembly page and the LLM discuss pipeline.
 */

import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES, ROLES, ROLE_LABELS } from "@/lib/contracts";
import { buildPersona, type NormiePersona } from "@/lib/normiesPersona";

export interface ElectedMember {
  role:          string;
  roleLabel:     string;
  tokenId:       number;
  holderAddress: string;
  assignedAt:    number;
  persona:       NormiePersona | null;
}

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

const CORE = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000";

export async function GET() {
  if (!CORE) {
    return NextResponse.json({ error: "AssociationCore not configured" }, { status: 500 });
  }

  const roleEntries = Object.entries(ROLES) as [string, `0x${string}`][];

  const assignments = await Promise.all(
    roleEntries.map(([, roleHash]) =>
      client.readContract({
        address:      CORE,
        abi:          ASSOCIATION_CORE_ABI,
        functionName: "getRoleHolder",
        args:         [roleHash],
      }) as Promise<{ tokenId: bigint; holderAddress: string; assignedAt: bigint }>
    )
  );

  const elected: ElectedMember[] = await Promise.all(
    roleEntries.map(async ([roleName, roleHash], i) => {
      const ra = assignments[i];
      const isElected = ra.holderAddress !== ZERO && ra.tokenId > 0n;

      let persona: NormiePersona | null = null;
      if (isElected) {
        persona = await buildPersona(Number(ra.tokenId)).catch(() => null);
      }

      return {
        role:          roleHash,
        roleLabel:     ROLE_LABELS[roleHash] ?? roleName,
        tokenId:       Number(ra.tokenId),
        holderAddress: ra.holderAddress,
        assignedAt:    Number(ra.assignedAt),
        persona,
      };
    })
  );

  return NextResponse.json({ elected });
}
