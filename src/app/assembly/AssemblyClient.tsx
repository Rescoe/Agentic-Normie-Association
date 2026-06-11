"use client";

/**
 * AssemblyClient — interface complète de l'assemblée constituante.
 *
 * Fonctionnalités :
 *   - SessionControls : ouvrir / clôturer la session (owner du contrat)
 *   - Vérification si ConstituentAssembly est autorisé dans AssociationCore
 *   - RoleVoteCard : vote par rôle avec liste de membres cliquable
 *   - Support multi-tokens : chacun de vos Normies membres peut voter
 *   - Statut hasVoted per-token affiché en temps réel
 */

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import {
  CONSTITUENT_ASSEMBLY_ABI,
  ASSOCIATION_CORE_ABI,
  CONTRACT_ADDRESSES,
  ROLES,
} from "@/lib/contracts";
import { getNormieImageUrl } from "@/lib/normiesApi";

// ─── Constants ────────────────────────────────────────────────────────────────

const CA_ADDR   = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`;
const CORE_ADDR = CONTRACT_ADDRESSES.AssociationCore     as `0x${string}`;
const contractsDeployed = !!CONTRACT_ADDRESSES.AssociationCore;

// ─── Role definitions ─────────────────────────────────────────────────────────

const ORDERED_ROLES = [
  { hash: ROLES.PRESIDENT,      label: "Président",                  group: "institutional" },
  { hash: ROLES.VICE_PRESIDENT, label: "Vice-Président / Trésorier", group: "institutional" },
  { hash: ROLES.SECRETARY,      label: "Secrétaire",                 group: "institutional" },
  { hash: ROLES.AUTHOR,         label: "Auteur",                     group: "creative" },
  { hash: ROLES.CURATOR,        label: "Curateur",                   group: "creative" },
  { hash: ROLES.RAPPORTEUR,     label: "Rapporteur",                 group: "creative" },
] as const;

// ─── Shared hooks ─────────────────────────────────────────────────────────────

/** Lit la liste de tous les membres on-chain. */
function useAllMembers(): number[] {
  const { data } = useReadContract({
    address: CORE_ADDR,
    abi:     ASSOCIATION_CORE_ABI,
    functionName: "getMemberTokenIds",
    query: { enabled: contractsDeployed, refetchInterval: 15_000 },
  });
  return (data as bigint[] | undefined)?.map(Number) ?? [];
}

/** Lit les tokenIds du wallet connecté qui sont membres. */
function useMyMemberIds(): { ids: number[]; loading: boolean } {
  const { address, isConnected } = useAccount();
  const [holderIds, setHolderIds] = useState<number[]>([]);
  const [loading, setLoading]    = useState(false);

  useEffect(() => {
    if (!isConnected || !address) { setHolderIds([]); return; }
    setLoading(true);
    fetch(`/api/holders/${address}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ids: number[]) => setHolderIds(ids))
      .catch(() => setHolderIds([]))
      .finally(() => setLoading(false));
  }, [address, isConnected]);

  const { data: checks } = useReadContracts({
    contracts: holderIds.map((id) => ({
      address: CORE_ADDR,
      abi:     ASSOCIATION_CORE_ABI,
      functionName: "isMember" as const,
      args:    [BigInt(id)] as [bigint],
    })),
    query: { enabled: holderIds.length > 0 && contractsDeployed },
  });

  const ids = holderIds.filter((_, i) => checks?.[i]?.result === true);
  return { ids, loading };
}

// ─── SessionControls ─────────────────────────────────────────────────────────

function SessionControls({ sessionActive }: { sessionActive: boolean }) {
  const { address } = useAccount();
  const router = useRouter();

  const [txHash,   setTxHash]   = useState<`0x${string}` | null>(null);
  const [txState,  setTxState]  = useState<"idle" | "pending" | "confirming" | "done" | "error">("idle");
  const [txError,  setTxError]  = useState<string | null>(null);

  // Owner of ConstituentAssembly (only owner can open/close)
  const { data: ownerRaw } = useReadContract({
    address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "owner",
    query: { enabled: contractsDeployed },
  });
  const contractOwner = ownerRaw as `0x${string}` | undefined;
  const isOwner = !!(address && contractOwner && address.toLowerCase() === contractOwner.toLowerCase());

  // Is ConstituentAssembly authorized as module in Core?
  const { data: isAuthorized } = useReadContract({
    address: CORE_ADDR, abi: ASSOCIATION_CORE_ABI, functionName: "authorizedModules",
    args: [CA_ADDR],
    query: { enabled: contractsDeployed },
  });

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });

  useEffect(() => {
    if (txConfirmed && txState === "confirming") {
      setTxState("done");
      router.refresh(); // revalidate server component
      const t = setTimeout(() => setTxState("idle"), 4000);
      return () => clearTimeout(t);
    }
  }, [txConfirmed, txState, router]);

  const exec = useCallback(async (fn: "openSession" | "closeSession") => {
    setTxError(null);
    setTxState("pending");
    try {
      const hash = await writeContractAsync({
        address: CA_ADDR,
        abi: CONSTITUENT_ASSEMBLY_ABI,
        functionName: fn,
      });
      setTxHash(hash);
      setTxState("confirming");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTxError(msg.includes("rejected") || msg.includes("denied") ? "Transaction annulée" : msg.slice(0, 120));
      setTxState("error");
    }
  }, [writeContractAsync]);

  if (!contractsDeployed) return null;

  const busy = txState === "pending" || txState === "confirming";

  return (
    <div className="space-y-3">
      {/* Authorization warning */}
      {isAuthorized === false && (
        <div className="border border-orange-400/60 bg-orange-50/40 px-5 py-3">
          <p className="font-mono text-xs text-orange-700 leading-relaxed">
            ⚠ ConstituentAssembly n'est pas autorisé dans AssociationCore.
            Appelez <code className="bg-orange-100 px-1">authorizeModule()</code> sur Core avant de clôturer —
            sinon la résolution des rôles échouera.
          </p>
          <p className="font-mono text-xs text-orange-600 mt-1 break-all">Core : {CORE_ADDR}</p>
        </div>
      )}

      {/* Owner controls */}
      {isOwner ? (
        <div className="border border-[--border] bg-[--bg-card] px-5 py-4 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs text-[--fg-muted] mb-0.5">Contrôles du propriétaire du contrat</p>
            {txState === "done" && (
              <p className="font-mono text-xs text-green-600">✓ Transaction confirmée — page rechargée</p>
            )}
            {txState === "error" && txError && (
              <p className="font-mono text-xs text-red-600 break-words">{txError}</p>
            )}
          </div>

          {!sessionActive ? (
            <button
              onClick={() => exec("openSession")}
              disabled={busy}
              className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 disabled:cursor-wait shrink-0"
            >
              {busy ? "En cours…" : "Ouvrir la session →"}
            </button>
          ) : (
            <button
              onClick={() => exec("closeSession")}
              disabled={busy || isAuthorized === false}
              className="font-mono text-xs border border-red-400 text-red-600 px-5 py-2.5 hover:bg-red-50/50 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {busy ? "En cours…" : "Clôturer et résoudre →"}
            </button>
          )}
        </div>
      ) : address ? (
        /* Non-owner info */
        <div className="border border-[--border] bg-[--bg-card] px-5 py-3">
          <p className="font-mono text-xs text-[--fg-muted]">
            Seul le propriétaire du contrat peut ouvrir / clôturer la session.
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ─── RoleVoteCard ─────────────────────────────────────────────────────────────

function RoleVoteCard({
  role,
  sessionActive,
  myMemberIds,
  allMemberIds,
}: {
  role: { hash: `0x${string}`; label: string; group: string };
  sessionActive: boolean;
  myMemberIds: number[];
  allMemberIds: number[];
}) {
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);
  const [votingWith, setVotingWith]               = useState<number | null>(null);
  const [txHash, setTxHash]   = useState<`0x${string}` | null>(null);
  const [txPending, setTxPending] = useState(false);
  const [txError, setTxError]     = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();

  // ── Leader ──────────────────────────────────────────────────────────────
  const { data: leaderRaw, refetch: refetchLeader } = useReadContract({
    address: CA_ADDR,
    abi:     CONSTITUENT_ASSEMBLY_ABI,
    functionName: "getLeader",
    args: [role.hash],
    query: { enabled: contractsDeployed, refetchInterval: 8_000 },
  });
  const leader      = leaderRaw as unknown as { tokenId: bigint; count: bigint } | undefined;
  const leaderTid   = leader ? Number(leader.tokenId) : null;
  const leaderVotes = leader ? Number(leader.count)   : 0;

  // ── hasVoted for each of my tokens ──────────────────────────────────────
  const { data: hasVotedData, refetch: refetchVoted } = useReadContracts({
    contracts: myMemberIds.map((id) => ({
      address: CA_ADDR,
      abi:     CONSTITUENT_ASSEMBLY_ABI,
      functionName: "hasVoted" as const,
      args: [BigInt(id), role.hash] as [bigint, `0x${string}`],
    })),
    query: { enabled: myMemberIds.length > 0 && contractsDeployed },
  });

  const hasVotedMap: Record<number, boolean> = Object.fromEntries(
    myMemberIds.map((id, i) => [id, hasVotedData?.[i]?.result === true])
  );
  const pendingVoters = myMemberIds.filter((id) => !hasVotedMap[id]);
  const allVoted      = myMemberIds.length > 0 && pendingVoters.length === 0;

  // Auto-select first pending voter
  useEffect(() => {
    if (pendingVoters.length > 0 && (votingWith === null || hasVotedMap[votingWith])) {
      setVotingWith(pendingVoters[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVotedData]);

  // ── Tx confirmation ──────────────────────────────────────────────────────
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });
  useEffect(() => {
    if (txConfirmed) {
      setTxPending(false);
      refetchVoted();
      refetchLeader();
    }
  }, [txConfirmed, refetchVoted, refetchLeader]);

  // ── Vote handler ─────────────────────────────────────────────────────────
  const handleVote = useCallback(async () => {
    if (votingWith === null || selectedCandidate === null) return;
    setTxError(null);
    setTxPending(true);
    try {
      const hash = await writeContractAsync({
        address: CA_ADDR,
        abi:     CONSTITUENT_ASSEMBLY_ABI,
        functionName: "castVote",
        args: [BigInt(votingWith), role.hash, BigInt(selectedCandidate)],
      });
      setTxHash(hash);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTxError(msg.includes("rejected") || msg.includes("denied") ? "Annulé" : msg.slice(0, 100));
      setTxPending(false);
    }
  }, [votingWith, selectedCandidate, writeContractAsync, role.hash]);

  return (
    <div className="border border-[--border] bg-[--bg] flex flex-col">
      {/* Role header */}
      <div className="bg-[--bg-card] border-b border-[--border] px-4 py-3">
        <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mb-0.5">
          {role.group === "institutional" ? "Institutionnel" : "Créatif"}
        </p>
        <p className="font-bold text-sm">{role.label}</p>
      </div>

      {/* Current leader */}
      <div className="px-4 py-3 border-b border-[--border] flex items-center gap-3 min-h-[60px]">
        {leaderVotes > 0 && leaderTid ? (
          <>
            <div className="relative w-10 h-10 shrink-0 bg-[--bg-card] overflow-hidden">
              <Image
                src={getNormieImageUrl(leaderTid)}
                alt={`#${leaderTid}`}
                fill
                className="object-contain"
                style={{ imageRendering: "pixelated" }}
                unoptimized
              />
            </div>
            <div>
              <p className="font-mono text-sm font-bold">#{leaderTid}</p>
              <p className="font-mono text-xs text-[--fg-muted]">
                {leaderVotes} vote{leaderVotes > 1 ? "s" : ""}
              </p>
            </div>
          </>
        ) : (
          <p className="font-mono text-xs text-[--fg-muted] italic">Aucun vote</p>
        )}
      </div>

      {/* Voting interface */}
      {sessionActive && (
        <div className="px-4 py-4 space-y-3 flex-1">
          {myMemberIds.length === 0 ? (
            <p className="font-mono text-xs text-[--fg-muted]">
              Inscrivez un Normie pour pouvoir voter.
            </p>
          ) : allVoted ? (
            <p className="font-mono text-xs text-green-600 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              {myMemberIds.length > 1 ? "Tous vos Normies ont voté" : "Vote enregistré ✓"}
            </p>
          ) : (
            <>
              {/* Voter selector (mes tokens pas encore votés) */}
              {pendingVoters.length > 1 && (
                <div>
                  <p className="font-mono text-xs text-[--fg-muted] mb-1.5">Voter avec :</p>
                  <div className="flex flex-wrap gap-1.5">
                    {pendingVoters.map((id) => (
                      <button
                        key={id}
                        onClick={() => setVotingWith(id)}
                        className={`font-mono text-xs px-2.5 py-1 border transition-colors ${
                          votingWith === id
                            ? "border-[--fg] bg-[--fg] text-[--bg]"
                            : "border-[--border] hover:bg-[--bg-card]"
                        }`}
                      >
                        #{id}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Candidate selector (tous les membres) */}
              {allMemberIds.length > 0 && (
                <div>
                  <p className="font-mono text-xs text-[--fg-muted] mb-1.5">Voter pour :</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allMemberIds.map((id) => (
                      <button
                        key={id}
                        onClick={() => setSelectedCandidate(id === selectedCandidate ? null : id)}
                        title={`Normie #${id}`}
                        className={`relative w-10 h-10 border-2 transition-all overflow-hidden ${
                          selectedCandidate === id
                            ? "border-[--fg] ring-2 ring-[--fg]/20"
                            : "border-[--border] hover:border-[--fg]/50"
                        }`}
                      >
                        <Image
                          src={getNormieImageUrl(id)}
                          alt={`#${id}`}
                          fill
                          className="object-contain"
                          style={{ imageRendering: "pixelated" }}
                          unoptimized
                        />
                      </button>
                    ))}
                  </div>
                  {selectedCandidate !== null && (
                    <p className="font-mono text-xs text-[--fg-muted] mt-1">
                      Candidat sélectionné : #{selectedCandidate}
                    </p>
                  )}
                </div>
              )}

              {/* Vote button */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleVote}
                  disabled={selectedCandidate === null || votingWith === null || txPending}
                  className="font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {txPending ? "Confirmation…" : "Voter →"}
                </button>
                {txPending && (
                  <div className="w-4 h-4 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
                )}
              </div>

              {txError && (
                <p className="font-mono text-xs text-red-600 leading-snug">{txError}</p>
              )}
            </>
          )}

          {/* Déjà votés */}
          {myMemberIds.some((id) => hasVotedMap[id]) && !allVoted && (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-[--border]">
              {myMemberIds.filter((id) => hasVotedMap[id]).map((id) => (
                <span key={id} className="font-mono text-xs text-green-600">
                  #{id} ✓
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Session inactive + pas encore voté */}
      {!sessionActive && myMemberIds.length > 0 && (
        <div className="px-4 py-3 flex-1">
          <p className="font-mono text-xs text-[--fg-muted]">
            En attente d'ouverture de session.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function AssemblyClient({
  sessionActive: initialSessionActive,
  sessionId:     initialSessionId,
}: {
  sessionActive: boolean;
  sessionId:     number;
}) {
  const { isConnected } = useAccount();
  const { ids: myMemberIds, loading: memberLoading } = useMyMemberIds();
  const allMemberIds = useAllMembers();

  // Live session state (overrides server props after client-side tx)
  const { data: sessionRaw } = useReadContract({
    address: CA_ADDR,
    abi:     CONSTITUENT_ASSEMBLY_ABI,
    functionName: "currentSession",
    query: { enabled: contractsDeployed, refetchInterval: 6_000 },
  });
  const liveSession = sessionRaw as unknown as {
    id: bigint; active: boolean; resolved: boolean;
  } | undefined;

  const sessionActive = liveSession ? liveSession.active : initialSessionActive;
  const sessionId     = liveSession ? Number(liveSession.id) : initialSessionId;

  // ── Not deployed ─────────────────────────────────────────────────────────
  if (!contractsDeployed) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div className="border border-[--border] bg-[--bg-card] p-10 max-w-lg space-y-4">
          <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
          <h2 className="text-2xl font-bold">Contrats non déployés</h2>
          <p className="text-[--fg-muted] leading-relaxed">
            Configurez les adresses dans les variables d'environnement pour activer l'assemblée.
          </p>
        </div>
      </div>
    );
  }

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">Connectez votre wallet</h2>
          <p className="text-[--fg-muted] max-w-sm">
            Pour participer au vote ou gérer la session, connectez le wallet
            qui détient vos Normies membres.
          </p>
        </div>
        <ConnectButton />
      </div>
    );
  }

  // ── Loading membership ────────────────────────────────────────────────────
  if (memberLoading) {
    return (
      <div className="flex items-center justify-center py-24 gap-4">
        <div className="w-6 h-6 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
        <p className="font-mono text-xs text-[--fg-muted]">
          Vérification de vos Normies membres…
        </p>
      </div>
    );
  }

  const institutionalRoles = ORDERED_ROLES.filter((r) => r.group === "institutional");
  const creativeRoles      = ORDERED_ROLES.filter((r) => r.group === "creative");

  return (
    <div className="space-y-8">
      {/* Session management */}
      <SessionControls sessionActive={sessionActive} />

      {/* Member status banner */}
      {myMemberIds.length > 0 ? (
        <div className="flex items-center gap-3 border border-green-300/60 bg-green-50/30 px-5 py-3">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block shrink-0" />
          <p className="text-sm text-green-700">
            {myMemberIds.length === 1
              ? `Normie #${myMemberIds[0]} est membre fondateur — vous pouvez voter.`
              : `${myMemberIds.length} de vos Normies sont membres fondateurs — ils peuvent voter.`}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 border border-[--border] bg-[--bg-card] px-5 py-3">
          <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block shrink-0" />
          <p className="font-mono text-xs text-[--fg-muted]">
            Aucun de vos Normies n'est encore membre.{" "}
            <a href="/register" className="underline hover:no-underline">Inscrire →</a>
          </p>
        </div>
      )}

      {/* Session inactive */}
      {!sessionActive && (
        <div className="border border-[--border] bg-[--bg-card] px-6 py-8 text-center space-y-3">
          <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
          <p className="font-bold">Session non ouverte</p>
          <p className="text-sm text-[--fg-muted] max-w-sm mx-auto">
            Le propriétaire du contrat doit ouvrir la session pour démarrer les votes.
          </p>
        </div>
      )}

      {/* Voting grid (toujours visible pour voir l'état des leaders) */}
      <div className="space-y-6">
        {/* Rôles institutionnels */}
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3 pb-2 border-b border-[--border]">
            Rôles institutionnels
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {institutionalRoles.map((role) => (
              <RoleVoteCard
                key={role.hash}
                role={role}
                sessionActive={sessionActive}
                myMemberIds={myMemberIds}
                allMemberIds={allMemberIds}
              />
            ))}
          </div>
        </div>

        {/* Rôles créatifs */}
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3 pb-2 border-b border-[--border]">
            Rôles créatifs
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {creativeRoles.map((role) => (
              <RoleVoteCard
                key={role.hash}
                role={role}
                sessionActive={sessionActive}
                myMemberIds={myMemberIds}
                allMemberIds={allMemberIds}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Légende */}
      {sessionActive && allMemberIds.length > 0 && (
        <div className="border border-[--border] bg-[--bg-card] px-6 py-4">
          <p className="font-mono text-xs text-[--fg-muted] leading-relaxed">
            Membres actuels ({allMemberIds.length}) :{" "}
            {allMemberIds.map((id) => `#${id}`).join(", ")} —
            Chaque Normie membre dispose d'une voix par rôle.
            En cas d'égalité, le tokenId le plus bas l'emporte.
          </p>
        </div>
      )}
    </div>
  );
}
