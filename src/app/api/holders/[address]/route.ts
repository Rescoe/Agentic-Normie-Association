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
    let raw: unknown[] = [];
    if (Array.isArray(data)) {
      raw = data;
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj.tokenIds)) raw = obj.tokenIds;
      else if (Array.isArray(obj.tokens)) raw = obj.tokens;
      else if (Array.isArray(obj.ids)) raw = obj.ids;
    }

    // Coerce chaque élément en number (l'API peut retourner des strings "1234")
    const tokenIds: number[] = raw
      .map((v) => {
        if (typeof v === "number") return v;
        if (typeof v === "string") return parseInt(v, 10);
        if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          const raw = o.tokenId ?? o.id ?? o.token_id;
          return typeof raw === "number" ? raw : parseInt(String(raw), 10);
        }
        return NaN;
      })
      .filter((n) => Number.isInteger(n) && n >= 0);

    return NextResponse.json(tokenIds);
  } catch {
    // En cas d'erreur réseau, retourne tableau vide (fail silently)
    return NextResponse.json([]);
  }
}
