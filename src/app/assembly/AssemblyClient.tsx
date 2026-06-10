"use client";

/**
 * AssemblyClient — interface de vote de l'assemblée constituante.
 *
 * Flux :
 *   1. Wallet non connecté → invite à connecter
 *   2. Session non active → état d'attente
 *   3. Session active → charge les Normies membres du wallet → vote par rôle
 *   4. Vote soumis → mise à jour des leaders
 */

import { useState, useCallback, useEffect } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import { parseAbi } from "viem";
import { CONSTITUENT_ASSEMBLY_ABI, CONTRACT_ADDRESSES, ROLES } from "@/lib/contracts";

// parseAbi converts human-readable strings to Abi type required by useReadContracts
const IS_MEMBER_ABI = parseAbi([
  "function isMember(uint256 tokenId) external view returns (bool)",
]);
import { getNormieImageUrl } from "@/lib/normiesApi";

// ─── Types ────────────────────────────────────────────────────────────────────

const contractsDeployed = !!CONTRACT_ADDRESSES.AssociationCore;

// Ordered roles for display
const ORDERED_ROLES = [
  { hash: ROLES.PRESIDENT,      label: "Président",                  type: "institutional" },
  { hash: ROLES.VICE_PRESIDENT, label: "Vice-Président / Trésorier", type: "institutional" },
  { hash: ROLES.SECRETARY,      label: "Secrétaire",                 type: "institutional" },
  { hash: ROLES.AUTHOR,         label: "Auteur",                     type: "creative" },
  { hash: ROLES.CURATOR,        label: "Curateur",                   type: "creative" },
  { hash: ROLES.RAPPORTEUR,     label: "Rapporteur",                 type: "creative" },
];

// ─── Not deployed state ───────────────────────────────────────────────────────

function NotDeployed() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
      <div className="border border-[--border] bg-[--bg-card] p-10 max-w-lg space-y-4">
        <span className="live-dot w-2 h-2 rounded-full bg-yellow-500 inline-block" />
        <h2 className="text-2xl font-bold">Assemblée constituante</h2>
        <p className="text-[--fg-muted] leading-relaxed">
          Les contrats ANA sont en cours de déploiement sur Base.
          L'assemblée constituante ouvrira dès que les membres
          fondateurs seront inscrits.
        </p>
      </div>
    </div>
  );
}

// ─── RoleCard — affiche le leader actuel + permet de voter ───────────────────

function RoleVoteCard({
  role,
  sessionActive,
  myMemberTokenIds,
}: {
  role: { hash: `0x${string}`; label: string; type: string };
  sessionActive: boolean;
  myMemberTokenIds: number[];
}) {
  const [selectedVoter, setSelectedVoter] = useState<number | null>(
    myMemberTokenIds[0] ?? null
  );
  const [candidateInput, setCandidateInput] = useState<string>("");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();

  // Read current leader
  const { data: leaderData } = useReadContract({
    address: CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`,
    abi: CONSTITUENT_ASSEMBLY_ABI,
    functionName: "getLeader",
    args: [role.hash],
    query: { refetchInterval: 10000 },
  });

  const leader = leaderData as { tokenId: bigint; count: bigint } | undefined;
  const leaderTokenId = leader ? Number(leader.tokenId) : null;
  const leaderVotes = leader ? Number(leader.count) : 0;

  // Read candidates
  const { data: candidatesData } = useReadContract({
    address: CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`,
    abi: CONSTITUENT_ASSEMBLY_ABI,
    functionName: "getCandidates",
    args: [role.hash],
    query: { refetchInterval: 10000 },
  });
  const candidates = (candidatesData as bigint[] | undefined)?.map(Number) ?? [];

  // Check if my voter already voted
  const { data: hasVotedData, refetch: refetchHasVoted } = useReadContract({
    address: CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`,
    abi: CONSTITUENT_ASSEMBLY_ABI,
    functionName: "hasVoted",
    args: [BigInt(selectedVoter ?? 0), role.hash],
    query: { enabled: selectedVoter !== null },
  });
  const alreadyVoted = hasVotedData as boolean ?? false;

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  const handleVote = useCallback(async () => {
    if (!selectedVoter) return;
    const candidateId = parseInt(candidateInput);
    if (isNaN(candidateId) || candidateId < 0) {
      setVoteError("TokenId candidat invalide");
      return;
    }
    setVoteError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`,
        abi: CONSTITUENT_ASSEMBLY_ABI,
        functionName: "castVote",
        args: [BigInt(selectedVoter), role.hash, BigInt(candidateId)],
      });
      setTxHash(hash);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur lors du vote";
      setVoteError(msg.includes("rejected") ? "Transaction annulée" : "Erreur : " + msg.slice(0, 80));
    }
  }, [selectedVoter, candidateInput, writeContractAsync, role.hash]);

  // After confirmation, refetch
  if (txConfirmed) {
    refetchHasVoted();
  }

  return (
    <div className="border border-[--border] bg-[--bg]">
      {/* Role header */}
      <div className="bg-[--bg-card] border-b border-[--border] px-5 py-3 flex items-center justify-between">
        <div>
          <span className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">
            {role.type === "institutional" ? "Institutionnel" : "Créatif"}
          </span>
          <h3 className="font-bold mt-0.5">{role.label}</h3>
        </div>
        {leaderVotes > 0 && leaderTokenId ? (
          <div className="text-right">
            <p className="font-mono text-xs text-[--fg-muted]">Leader actuel</p>
            <p className="font-mono text-sm font-bold">
              #{leaderTokenId}
              <span className="text-[--fg-muted] font-normal ml-2">
                ({leaderVotes} vote{leaderVotes > 1 ? "s" : ""})
              </span>
            </p>
          </div>
        ) : (
          <span className="font-mono text-xs text-[--fg-muted]">Aucun vote</span>
        )}
      </div>

      {/* Leader image if exists */}
      {leaderVotes > 0 && leaderTokenId ? (
        <div className="flex items-center gap-4 px-5 py-4 border-b border-[--border]">
          <div className="relative w-14 h-14 shrink-0 bg-[--bg-card]">
            <Image
              src={getNormieImageUrl(leaderTokenId)}
              alt={`Normie #${leaderTokenId}`}
              fill
              className="object-contain"
              style={{ imageRendering: "pixelated" }}
              unoptimized
            />
          </div>
          <div>
            <p className="text-sm font-semibold">Normie #{leaderTokenId}</p>
            {candidates.length > 0 && (
              <p className="font-mono text-xs text-[--fg-muted]">
                {candidates.length} candidat{candidates.length > 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* Vote form */}
      {sessionActive && myMemberTokenIds.length > 0 && (
        <div className="px-5 py-4 space-y-3">
          {alreadyVoted || txConfirmed ? (
            <p className="font-mono text-xs text-green-600 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Vote enregistré pour Normie #{selectedVoter}
            </p>
          ) : (
            <>
              {/* Voter selector */}
              {myMemberTokenIds.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="font-mono text-xs text-[--fg-muted] shrink-0">
                    Voter avec :
                  </label>
                  <select
                    value={selectedVoter ?? ""}
                    onChange={(e) => setSelectedVoter(Number(e.target.value))}
                    className="font-mono text-xs border border-[--border] bg-[--bg] px-2 py-1"
                  >
                    {myMemberTokenIds.map((id) => (
                      <option key={id} value={id}>
                        Normie #{id}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Candidate input */}
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="TokenId du candidat…"
                  value={candidateInput}
                  onChange={(e) => setCandidateInput(e.target.value)}
                  className="font-mono text-xs border border-[--border] bg-[--bg] px-3 py-2 flex-1 focus:outline-none focus:border-[--fg]"
                  min={0}
                />
                <button
                  onClick={handleVote}
                  disabled={!candidateInput}
                  className="font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Voter →
                </button>
              </div>

              {voteError && (
                <p className="font-mono text-xs text-red-600">{voteError}</p>
              )}
            </>
          )}
        </div>
      )}

      {sessionActive && myMemberTokenIds.length === 0 && (
        <div className="px-5 py-4">
          <p className="font-mono text-xs text-[--fg-muted]">
            Inscrivez un Normie pour participer au vote.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Hook: charge les tokenIds membres du wallet connecté ────────────────────

function useMyMemberTokenIds(): { ids: number[]; loading: boolean } {
  const { address, isConnected } = useAccount();
  const [holderIds, setHolderIds] = useState<number[]>([]);
  const [loading, setLoading]    = useState(false);

  // 1. Fetch holder token IDs
  useEffect(() => {
    if (!isConnected || !address) { setHolderIds([]); return; }
    setLoading(true);
    fetch(`/api/holders/${address}`)
      .then((r) => r.ok ? r.json() : [])
      .then((ids: number[]) => setHolderIds(ids))
      .catch(() => setHolderIds([]))
      .finally(() => setLoading(false));
  }, [address, isConnected]);

  // 2. Check isMember on-chain for each held token (parseAbi needed for useReadContracts)
  const { data: memberChecks } = useReadContracts({
    contracts: holderIds.map((tokenId) => ({
      address: CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:     IS_MEMBER_ABI,
      functionName: "isMember" as const,
      args: [BigInt(tokenId)] as [bigint],
    })),
    query: { enabled: holderIds.length > 0 && contractsDeployed },
  });

  const memberIds = holderIds.filter((_, i) => memberChecks?.[i]?.result === true);

  return { ids: memberIds, loading };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function AssemblyClient({
  sessionActive,
  sessionId,
}: {
  sessionActive: boolean;
  sessionId: number;
}) {
  const { isConnected } = useAccount();
  const { ids: myMemberTokenIds, loading: memberLoading } = useMyMemberTokenIds();

  if (!contractsDeployed) return <NotDeployed />;

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div className="space-y-3">
          <h2 className="text-2xl font-bold">Connectez votre wallet pour voter</h2>
          <p className="text-[--fg-muted] max-w-sm">
            Pour participer au vote, connectez le wallet qui détient vos Normies membres.
          </p>
        </div>
        <ConnectButton />
      </div>
    );
  }

  if (memberLoading) {
    return (
      <div className="flex items-center justify-center py-24 gap-4">
        <div className="w-6 h-6 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
        <p className="font-mono text-xs text-[--fg-muted]">Vérification de vos Normies membres…</p>
      </div>
    );
  }

  if (!sessionActive) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div className="border border-[--border] bg-[--bg-card] p-10 max-w-lg space-y-4">
          <span className="live-dot w-2 h-2 rounded-full bg-yellow-500 inline-block" />
          <h2 className="text-2xl font-bold">Session en attente d'ouverture</h2>
          <p className="text-[--fg-muted] leading-relaxed">
            L'assemblée constituante n'a pas encore ouvert de session de vote.
            Dès que la session sera ouverte, vous pourrez voter ici.
          </p>
          <p className="font-mono text-xs text-[--fg-muted]">
            Les membres inscrits seront notifiés à l'ouverture.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Session info */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mb-1">
            Session #{sessionId} · En cours
          </p>
          {myMemberTokenIds.length > 0 ? (
            <p className="text-sm text-green-700 font-medium">
              {myMemberTokenIds.length} de vos Normies peuvent voter
            </p>
          ) : (
            <p className="text-sm text-[--fg-muted]">
              Aucun de vos Normies n'est membre de l'assemblée
            </p>
          )}
        </div>
        <span className="flex items-center gap-2 font-mono text-xs border border-green-300 bg-green-50 text-green-700 px-3 py-1.5">
          <span className="live-dot w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          Session ouverte
        </span>
      </div>

      {/* Rôles institutionnels */}
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4 border-b border-[--border] pb-2">
          Rôles institutionnels
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ORDERED_ROLES.filter((r) => r.type === "institutional").map((role) => (
            <RoleVoteCard
              key={role.hash}
              role={role}
              sessionActive={sessionActive}
              myMemberTokenIds={myMemberTokenIds}
            />
          ))}
        </div>
      </div>

      {/* Rôles créatifs */}
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4 border-b border-[--border] pb-2">
          Rôles créatifs
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ORDERED_ROLES.filter((r) => r.type === "creative").map((role) => (
            <RoleVoteCard
              key={role.hash}
              role={role}
              sessionActive={sessionActive}
              myMemberTokenIds={myMemberTokenIds}
            />
          ))}
        </div>
      </div>

      {/* Note */}
      <div className="border border-[--border] bg-[--bg-card] px-6 py-4">
        <p className="font-mono text-xs text-[--fg-muted] leading-relaxed">
          Chaque Normie membre dispose d'une voix par rôle. En cas d'égalité,
          le Normie avec le tokenId le plus bas remporte le rôle.
          Les résultats sont enregistrés on-chain à la clôture de la session.
        </p>
      </div>
    </div>
  );
}
