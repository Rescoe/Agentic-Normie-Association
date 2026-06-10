"use client";

/**
 * RegisterClient — logique complète de la page d'inscription.
 *
 * Flux :
 *   1. Wallet non connecté → invite à connecter
 *   2. Wallet connecté → fetch /holders/:address → liste des tokenIds
 *   3. Pour chaque tokenId → fetch metadata → carte Normie
 *   4. Bouton "Inscrire" par Normie :
 *      - Désactivé si contrats pas encore déployés (CONTRACT_ADDRESSES vide)
 *      - Actif → appelle useAttestation.register(tokenId)
 */

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import { getNormieImageUrl, type NormieMetadata } from "@/lib/normiesApi";
import { useAttestation, type RegistrationStatus } from "@/lib/useAttestation";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NormieCard {
  tokenId:  number;
  metadata: NormieMetadata | null;
  loading:  boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const contractsDeployed = !!CONTRACT_ADDRESSES.AssociationCore;

function statusLabel(status: RegistrationStatus): string {
  switch (status) {
    case "requesting_attestation": return "Vérification…";
    case "awaiting_signature":     return "Signez dans votre wallet…";
    case "pending_tx":             return "Transaction en cours…";
    case "success":                return "Inscrit ✓";
    case "error":                  return "Erreur";
    default:                       return "Inscrire";
  }
}

// ─── NormieCard component ─────────────────────────────────────────────────────

function NormieCardItem({
  card,
  onRegister,
  registerStatus,
  registerError,
}: {
  card: NormieCard;
  onRegister: (tokenId: number) => void;
  registerStatus: RegistrationStatus;
  registerError: string | null;
}) {
  const busy =
    registerStatus === "requesting_attestation" ||
    registerStatus === "awaiting_signature" ||
    registerStatus === "pending_tx";

  const isSuccess = registerStatus === "success";
  const isError = registerStatus === "error";

  return (
    <div className={`border border-[--border] bg-[--bg] flex flex-col overflow-hidden transition-all ${
      isSuccess ? "border-green-500/50 bg-green-50/30" : ""
    }`}>
      {/* Image */}
      <div className="relative aspect-square bg-[--bg-card] overflow-hidden">
        {card.loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
          </div>
        ) : (
          <Image
            src={getNormieImageUrl(card.tokenId)}
            alt={card.metadata?.name ?? `Normie #${card.tokenId}`}
            fill
            className="object-contain"
            style={{ imageRendering: "pixelated" }}
            unoptimized // external URL
          />
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mb-1">
            Normie
          </p>
          <p className="font-bold text-sm">
            {card.metadata?.name ?? `#${card.tokenId}`}
          </p>
          <p className="font-mono text-xs text-[--fg-muted]">#{card.tokenId}</p>
        </div>

        {/* Traits (top 3) */}
        {card.metadata?.attributes && card.metadata.attributes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.metadata.attributes.slice(0, 3).map((attr) => (
              <span
                key={attr.trait_type}
                className="font-mono text-xs bg-[--bg-card] border border-[--border] px-2 py-0.5"
              >
                {attr.value}
              </span>
            ))}
          </div>
        )}

        {/* Register button */}
        <div className="mt-auto pt-2">
          {!contractsDeployed ? (
            <div className="space-y-1.5">
              <button
                disabled
                className="w-full font-mono text-xs border border-[--border] text-[--fg-muted] px-4 py-2.5 cursor-not-allowed opacity-50"
              >
                Inscrire (bientôt disponible)
              </button>
              <p className="font-mono text-xs text-[--fg-muted] text-center">
                Contrats en cours de déploiement
              </p>
            </div>
          ) : isSuccess ? (
            <div className="w-full font-mono text-xs bg-green-100 text-green-700 border border-green-300 px-4 py-2.5 text-center">
              ✓ Inscrit dans l'assemblée
            </div>
          ) : (
            <div className="space-y-1.5">
              <button
                onClick={() => onRegister(card.tokenId)}
                disabled={busy}
                className={`w-full font-mono text-xs px-4 py-2.5 transition-all ${
                  busy
                    ? "bg-[--bg-card] text-[--fg-muted] border border-[--border] cursor-wait"
                    : "bg-[--fg] text-[--bg] hover:opacity-80 cursor-pointer"
                }`}
              >
                {busy ? statusLabel(registerStatus) : "Inscrire →"}
              </button>
              {isError && registerError && (
                <p className="font-mono text-xs text-red-600 text-center leading-snug">
                  {registerError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RegisterClient() {
  const { address, isConnected } = useAccount();
  const { register, status: regStatus, error: regError } = useAttestation();

  const [cards, setCards] = useState<NormieCard[]>([]);
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [registeredTokenIds, setRegisteredTokenIds] = useState<Set<number>>(new Set());

  // Track per-token registration status
  const [activeTokenId, setActiveTokenId] = useState<number | null>(null);

  // Fetch holder tokens when wallet connects
  const fetchNormies = useCallback(async (walletAddress: string) => {
    setFetchState("loading");
    setCards([]);

    try {
      // Step 1: get tokenIds
      const res = await fetch(`/api/holders/${encodeURIComponent(walletAddress)}`);
      if (!res.ok) throw new Error("API error");
      const tokenIds: number[] = await res.json();

      if (tokenIds.length === 0) {
        setFetchState("done");
        return;
      }

      // Step 2: init cards as loading, then fetch metadata in parallel
      const initialCards: NormieCard[] = tokenIds.map((id) => ({
        tokenId: id,
        metadata: null,
        loading: true,
      }));
      setCards(initialCards);
      setFetchState("done");

      // Step 3: fetch metadata for each token (non-blocking, fills cards as they arrive)
      await Promise.allSettled(
        tokenIds.map(async (tokenId) => {
          try {
            const metaRes = await fetch(
              `https://api.normies.art/normie/${tokenId}/metadata`
            );
            const metadata: NormieMetadata = metaRes.ok ? await metaRes.json() : null;
            setCards((prev) =>
              prev.map((c) =>
                c.tokenId === tokenId ? { ...c, metadata, loading: false } : c
              )
            );
          } catch {
            setCards((prev) =>
              prev.map((c) =>
                c.tokenId === tokenId ? { ...c, loading: false } : c
              )
            );
          }
        })
      );
    } catch {
      setFetchState("error");
    }
  }, []);

  useEffect(() => {
    if (isConnected && address) {
      fetchNormies(address);
    } else {
      setCards([]);
      setFetchState("idle");
    }
  }, [isConnected, address, fetchNormies]);

  // When registration succeeds, mark the token
  useEffect(() => {
    if (regStatus === "success" && activeTokenId !== null) {
      setRegisteredTokenIds((prev) => new Set([...prev, activeTokenId]));
    }
  }, [regStatus, activeTokenId]);

  const handleRegister = useCallback(
    (tokenId: number) => {
      setActiveTokenId(tokenId);
      register(tokenId);
    },
    [register]
  );

  // ─── Render states ─────────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-8 text-center">
        <div className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            Étape 1
          </p>
          <h2 className="text-2xl font-bold">Connectez votre wallet</h2>
          <p className="text-[--fg-muted] max-w-sm">
            Pour inscrire un Normie, vous devez d'abord connecter le wallet
            qui le détient sur Ethereum mainnet.
          </p>
        </div>
        <ConnectButton />
        <div className="border border-[--border] bg-[--bg-card] px-6 py-4 max-w-sm">
          <p className="font-mono text-xs text-[--fg-muted] leading-relaxed">
            L'ownership est vérifié via un relayer signataire.
            Aucune transaction n'est requise sur Ethereum.
            L'inscription se fait sur Base.
          </p>
        </div>
      </div>
    );
  }

  if (fetchState === "loading") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-8 h-8 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
        <p className="font-mono text-xs text-[--fg-muted]">
          Récupération de vos Normies…
        </p>
        <p className="font-mono text-xs text-[--fg-muted] opacity-60">
          {address?.slice(0, 6)}…{address?.slice(-4)}
        </p>
      </div>
    );
  }

  if (fetchState === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <p className="font-bold">Impossible de récupérer vos Normies</p>
        <p className="text-[--fg-muted] text-sm max-w-sm">
          L'API Normies est peut-être indisponible. Réessayez dans quelques instants.
        </p>
        <button
          onClick={() => address && fetchNormies(address)}
          className="font-mono text-xs border border-[--border] px-4 py-2 hover:bg-[--bg-card]"
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (fetchState === "done" && cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div className="border border-[--border] bg-[--bg-card] p-8 max-w-md space-y-4">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            Aucun Normie trouvé
          </p>
          <h3 className="text-xl font-bold">
            Ce wallet ne détient pas de Normies
          </h3>
          <p className="text-[--fg-muted] text-sm leading-relaxed">
            Le wallet{" "}
            <span className="font-mono">
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </span>{" "}
            ne détient aucun Normie sur Ethereum mainnet. Pour participer à
            l'assemblée constituante, vous devez posséder au moins un Normie.
          </p>
          <a
            href="https://normies.art"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-mono text-xs border border-[--border] px-4 py-2 hover:bg-[--bg-card]"
          >
            Découvrir les Normies ↗
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-1">
            {cards.length} Normie{cards.length > 1 ? "s" : ""} trouvé
            {cards.length > 1 ? "s" : ""}
          </p>
          <h2 className="text-xl font-bold">Vos Normies</h2>
          <p className="font-mono text-xs text-[--fg-muted] mt-1">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </p>
        </div>

        {!contractsDeployed && (
          <div className="flex items-center gap-2 border border-yellow-400/50 bg-yellow-50/50 px-3 py-2">
            <span className="live-dot w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
            <span className="font-mono text-xs text-yellow-700">
              Contrats non déployés — mode aperçu
            </span>
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <NormieCardItem
            key={card.tokenId}
            card={
              registeredTokenIds.has(card.tokenId)
                ? { ...card }
                : card
            }
            onRegister={handleRegister}
            registerStatus={
              activeTokenId === card.tokenId ? regStatus : "idle"
            }
            registerError={
              activeTokenId === card.tokenId ? regError : null
            }
          />
        ))}
      </div>

      {/* Info bloc si contrats pas déployés */}
      {!contractsDeployed && (
        <div className="border border-[--border] bg-[--bg-card] p-6 space-y-2">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            Prochaine étape
          </p>
          <p className="text-sm text-[--fg-muted] leading-relaxed">
            Les contrats ANA sont en cours de déploiement sur Base Sepolia.
            Dès qu'ils seront en ligne, les boutons d'inscription seront activés.
            Votre wallet et vos Normies sont déjà vérifiés.
          </p>
        </div>
      )}
    </div>
  );
}
