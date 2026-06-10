/**
 * GET /api/holders/:address
 *
 * Proxy vers l'API Normies pour éviter les problèmes CORS côté client.
 * Retourne le tableau de tokenIds détenus par l'adresse.
 *
 * Réponse : number[]
 */

import { NextRequest, NextResponse } from "next/server";

const NORMIES_API_BASE =
  process.env.NORMIES_API_BASE_URL ?? "https://api.normies.art";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;

  // Validation basique de l'adresse
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json(
      { error: "Invalid Ethereum address" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${NORMIES_API_BASE}/holders/${address}`, {
      next: { revalidate: 30 }, // ownership cache court
    });

    if (!res.ok) {
      // API Normies down ou adresse inconnue → retourne tableau vide
      return NextResponse.json([]);
    }

    const data: unknown = await res.json();

    // Normalise les différents formats de réponse
    let tokenIds: number[] = [];
    if (Array.isArray(data)) {
      tokenIds = data as number[];
    } else if (
      data &&
      typeof data === "object" &&
      "tokenIds" in data &&
      Array.isArray((data as { tokenIds: number[] }).tokenIds)
    ) {
      tokenIds = (data as { tokenIds: number[] }).tokenIds;
    } else if (
      data &&
      typeof data === "object" &&
      "tokens" in data &&
      Array.isArray((data as { tokens: number[] }).tokens)
    ) {
      tokenIds = (data as { tokens: number[] }).tokens;
    }

    return NextResponse.json(tokenIds);
  } catch {
    // En cas d'erreur réseau, retourne tableau vide (fail silently)
    return NextResponse.json([]);
  }
}
