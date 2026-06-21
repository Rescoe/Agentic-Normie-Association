"use client";

/**
 * RegisterClient — logique complète de la page d'inscription.
 *
 * Flux :
 *   1. Wallet non connecté → invite à connecter
 *   2. Wallet connecté → fetch /holders/:address → liste des tokenIds
 *   3. isMember on-chain check pour chaque tokenId
 *   4. Pour chaque tokenId → fetch metadata → carte Normie
 *   5. Bouton "Inscrire" si non membre, "Déjà inscrit ✓" si déjà membre
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useAccount, useReadContracts } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import { getNormieImageUrl, type NormieMetadata } from "@/lib/normiesApi";
import { useAttestation, type RegistrationStatus } from "@/lib/useAttestation";
import { CONTRACT_ADDRESSES, ASSOCIATION_CORE_ABI } from "@/lib/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────

const contractsDeployed = !!CONTRACT_ADDRESSES.AssociationCore;
const CORE_ADDR = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface NormieCard {
  tokenId:  number;
  metadata: NormieMetadata | null;
  loading:  boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(status: RegistrationStatus, t: (key: string) => string): string {
  switch (status) {
    case "requesting_attestation": return t("status.verifying");
    case "awaiting_signature":     return t("status.signWallet");
    case "pending_tx":             return t("status.pendingTx");
    case "success":                return t("status.registered");
    case "error":                  return t("status.errorRetry");
    default:                       return t("status.register");
  }
}

// ─── NormieCardItem ───────────────────────────────────────────────────────────

function NormieCardItem({
  card,
  isMember,
  onRegister,
  registerStatus,
  registerError,
}: {
  card: NormieCard;
  isMember: boolean;
  onRegister: (tokenId: number) => void;
  registerStatus: RegistrationStatus;
  registerError: string | null;
}) {
  const t = useTranslations("register");
  const busy =
    registerStatus === "requesting_attestation" ||
    registerStatus === "awaiting_signature"     ||
    registerStatus === "pending_tx";

  const isSuccess  = registerStatus === "success" || isMember;
  const isError    = registerStatus === "error";

  return (
    <div className={`border flex flex-col overflow-hidden transition-all ${
      isSuccess ? "border-green-400/50" : "border-[--border]"
    } bg-[--bg]`}>

      {/* Image */}
      <div className="relative aspect-square bg-[--bg-card] overflow-hidden">
        {card.loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
          </div>
        ) : (
          <Image
            src={getNormieImageUrl(card.tokenId)}
            alt={card.metadata?.name ?? `Normie #${card.tokenId}`}
            fill
            className="object-contain"
            style={{ imageRendering: "pixelated" }}
            unoptimized
          />
        )}
        {isSuccess && (
          <div className="absolute top-2 right-2 bg-green-500 text-white font-mono text-xs px-1.5 py-0.5">
            ✓
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-2.5 flex-1">
        <div>
          <p className="font-bold text-sm leading-tight">
            {card.metadata?.name ?? `#${card.tokenId}`}
          </p>
          <p className="font-mono text-xs text-[--fg-muted]">#{card.tokenId}</p>
        </div>

        {/* Top 3 traits */}
        {card.metadata?.attributes && card.metadata.attributes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.metadata.attributes.slice(0, 3).map((attr) => (
              <span
                key={attr.trait_type}
                className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1.5 py-0.5"
              >
                {attr.value}
              </span>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-auto pt-1">
          {!contractsDeployed ? (
            <button disabled className="w-full font-mono text-xs border border-[--border] text-[--fg-muted] px-3 py-2 cursor-not-allowed opacity-40">
              {t("contractsDeploying")}
            </button>
          ) : isSuccess ? (
            <div className="w-full font-mono text-xs bg-green-50 text-green-700 border border-green-300 px-3 py-2 text-center">
              {t("foundingMember")}
            </div>
          ) : (
            <div className="space-y-1">
              <button
                onClick={() => onRegister(card.tokenId)}
                disabled={busy}
                className={`w-full font-mono text-xs px-3 py-2 transition-all ${
                  busy
                    ? "bg-[--bg-card] text-[--fg-muted] border border-[--border] cursor-wait"
                    : isError
                    ? "bg-red-50 text-red-700 border border-red-300 hover:bg-red-100 cursor-pointer"
                    : "bg-[--fg] text-[--bg] hover:opacity-80 cursor-pointer"
                }`}
              >
                {busy ? statusLabel(registerStatus, t) : isError ? t("retry") : t("status.register")}
              </button>
              {isError && registerError && (
                <p className="font-mono text-xs text-red-600 leading-snug text-center">
                  {registerError.slice(0, 80)}
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
  const t = useTranslations("register");
  const { address, isConnected } = useAccount();
  const { register, status: regStatus, error: regError } = useAttestation();

  const [cards, setCards] = useState<NormieCard[]>([]);
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [activeTokenId, setActiveTokenId] = useState<number | null>(null);
  // Track locally confirmed registrations (for immediate UI feedback)
  const [justRegistered, setJustRegistered] = useState<Set<number>>(new Set());

  // ── Fetch holder tokenIds when wallet connects ────────────────────────────
  const fetchNormies = useCallback(async (walletAddress: string) => {
    setFetchState("loading");
    setCards([]);
    try {
      const res = await fetch(`/api/holders/${encodeURIComponent(walletAddress)}`);
      if (!res.ok) throw new Error("API error");
      const tokenIds: number[] = await res.json();

      if (tokenIds.length === 0) { setFetchState("done"); return; }

      // Init skeleton cards
      setCards(tokenIds.map((id) => ({ tokenId: id, metadata: null, loading: true })));
      setFetchState("done");

      // Fetch metadata in parallel (fill in as they arrive)
      await Promise.allSettled(
        tokenIds.map(async (tokenId) => {
          try {
            const metaRes = await fetch(`https://api.normies.art/normie/${tokenId}/metadata`);
            const metadata: NormieMetadata = metaRes.ok ? await metaRes.json() : null;
            setCards((prev) =>
              prev.map((c) => c.tokenId === tokenId ? { ...c, metadata, loading: false } : c)
            );
          } catch {
            setCards((prev) =>
              prev.map((c) => c.tokenId === tokenId ? { ...c, loading: false } : c)
            );
          }
        })
      );
    } catch {
      setFetchState("error");
    }
  }, []);

  useEffect(() => {
    if (isConnected && address) fetchNormies(address);
    else { setCards([]); setFetchState("idle"); }
  }, [isConnected, address, fetchNormies]);

  // ── isMember on-chain check for all held tokens ───────────────────────────
  const { data: memberChecks } = useReadContracts({
    contracts: cards.map((c) => ({
      address: CORE_ADDR,
      abi:     ASSOCIATION_CORE_ABI,
      functionName: "isMember" as const,
      args: [BigInt(c.tokenId)] as [bigint],
    })),
    query: { enabled: cards.length > 0 && contractsDeployed, refetchInterval: 10000 },
  });

  const isMemberMap: Record<number, boolean> = Object.fromEntries(
    cards.map((c, i) => [
      c.tokenId,
      memberChecks?.[i]?.result === true || justRegistered.has(c.tokenId),
    ])
  );

  // Track successful registrations
  useEffect(() => {
    if (regStatus === "success" && activeTokenId !== null) {
      setJustRegistered((prev) => new Set([...prev, activeTokenId]));
    }
  }, [regStatus, activeTokenId]);

  const handleRegister = useCallback((tokenId: number) => {
    setActiveTokenId(tokenId);
    register(tokenId);
  }, [register]);

  // ── Render states ─────────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-8 text-center">
        <div className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">{t("step1Label")}</p>
          <h2 className="text-2xl font-bold">{t("connectWalletHeading")}</h2>
          <p className="text-[--fg-muted] max-w-sm">
            {t("connectWalletDescription")}
          </p>
        </div>
        <ConnectButton />
        <div className="border border-[--border] bg-[--bg-card] px-6 py-4 max-w-sm">
          <p className="font-mono text-xs text-[--fg-muted] leading-relaxed">
            {t("ownershipNotice")}
          </p>
        </div>
      </div>
    );
  }

  if (fetchState === "loading") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="w-8 h-8 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
        <p className="font-mono text-xs text-[--fg-muted]">{t("fetchingNormies")}</p>
        <p className="font-mono text-xs text-[--fg-muted] opacity-50">
          {address?.slice(0, 6)}…{address?.slice(-4)}
        </p>
      </div>
    );
  }

  if (fetchState === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <p className="font-bold">{t("fetchErrorHeading")}</p>
        <p className="text-[--fg-muted] text-sm max-w-sm">
          {t("fetchErrorDescription")}
        </p>
        <button
          onClick={() => address && fetchNormies(address)}
          className="font-mono text-xs border border-[--border] px-4 py-2 hover:bg-[--bg-card]"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (fetchState === "done" && cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div className="border border-[--border] bg-[--bg-card] p-8 max-w-md space-y-4">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">{t("noNormieLabel")}</p>
          <h3 className="text-xl font-bold">{t("noNormieHeading")}</h3>
          <p className="text-[--fg-muted] text-sm leading-relaxed">
            {t("noNormieDescriptionPrefix")}{" "}
            <span className="font-mono">{address?.slice(0, 6)}…{address?.slice(-4)}</span>{" "}
            {t("noNormieDescriptionSuffix")}
          </p>
          <a
            href="https://normies.art"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-mono text-xs border border-[--border] px-4 py-2 hover:bg-[--bg]"
          >
            {t("discoverNormiesLink")}
          </a>
        </div>
      </div>
    );
  }

  const memberCount = cards.filter((c) => isMemberMap[c.tokenId]).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-1">
            {t("normiesFound", { count: cards.length })}
          </p>
          <h2 className="text-xl font-bold">{t("yourNormies")}</h2>
          <p className="font-mono text-xs text-[--fg-muted] mt-0.5">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </p>
        </div>

        {contractsDeployed && memberCount > 0 && (
          <div className="flex items-center gap-2 border border-green-300 bg-green-50/50 px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            <span className="font-mono text-xs text-green-700">
              {t("alreadyRegistered", { count: memberCount })}
            </span>
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <NormieCardItem
            key={card.tokenId}
            card={card}
            isMember={isMemberMap[card.tokenId] ?? false}
            onRegister={handleRegister}
            registerStatus={activeTokenId === card.tokenId ? regStatus : "idle"}
            registerError={activeTokenId === card.tokenId ? regError : null}
          />
        ))}
      </div>

      {/* Info if already all registered */}
      {contractsDeployed && memberCount === cards.length && cards.length > 0 && (
        <div className="border border-green-300 bg-green-50/30 px-6 py-5 space-y-2">
          <p className="font-bold text-green-800">
            {t("allRegisteredHeading")}
          </p>
          <p className="text-sm text-green-700">
            {t("allRegisteredDescription")}
          </p>
          <a
            href="/assembly"
            className="inline-flex items-center font-mono text-xs text-green-700 border border-green-300 px-4 py-2 hover:bg-green-100 mt-2"
          >
            {t("goToAssemblyButton")}
          </a>
        </div>
      )}
    </div>
  );
}
