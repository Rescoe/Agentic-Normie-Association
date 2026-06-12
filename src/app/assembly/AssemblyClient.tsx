"use client";

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
  WORK_REGISTRY_ABI,
  CONTRACT_ADDRESSES,
  ROLES,
  ROLE_LABELS,
} from "@/lib/contracts";
import { getNormieImageUrl } from "@/lib/normiesApi";
import type { NormiePersona } from "@/lib/normiesPersona";

// ─── Types shared with /api/assembly/elected ─────────────────────────────────

interface ElectedMember {
  role:          string;
  roleLabel:     string;
  tokenId:       number;
  holderAddress: string;
  assignedAt:    number;
  persona:       NormiePersona | null;
}

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

// ─── ElectionResults ─────────────────────────────────────────────────────────

function ElectionResults({
  allMemberIds,
  sessionResolved,
}: {
  allMemberIds:    number[];
  sessionResolved: boolean;
}) {
  // For every (role, candidate) pair, read voteCount — batched in one call
  const pairs: { roleHash: `0x${string}`; label: string; candidateId: number }[] = [];
  for (const r of ORDERED_ROLES) {
    for (const id of allMemberIds) {
      pairs.push({ roleHash: r.hash, label: r.label, candidateId: id });
    }
  }

  const { data: rawCounts, isLoading } = useReadContracts({
    contracts: pairs.map(p => ({
      address:      CA_ADDR,
      abi:          CONSTITUENT_ASSEMBLY_ABI,
      functionName: "getVoteCount" as const,
      args:         [p.roleHash, BigInt(p.candidateId)] as [`0x${string}`, bigint],
    })),
    query: { enabled: allMemberIds.length > 0 && contractsDeployed, refetchInterval: 8_000 },
  });

  // Organize: roleHash → candidateId → voteCount
  const tally: Record<string, Record<number, number>> = {};
  pairs.forEach((p, i) => {
    tally[p.roleHash] ??= {};
    tally[p.roleHash][p.candidateId] = Number(rawCounts?.[i]?.result ?? 0n);
  });

  const totalVotes = Object.values(tally).reduce((sum, candidates) =>
    sum + Object.values(candidates).reduce((s, c) => s + c, 0), 0
  );

  if (allMemberIds.length === 0) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            Résultats en temps réel
          </p>
          {sessionResolved && (
            <p className="font-mono text-xs text-green-600 mt-0.5">
              ✓ Session clôturée — résultats définitifs
            </p>
          )}
        </div>
        {isLoading && (
          <div className="w-4 h-4 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
        )}
      </div>

      {totalVotes === 0 && !isLoading && (
        <p className="font-mono text-xs text-[--fg-muted]">Aucun vote enregistré pour l'instant.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ORDERED_ROLES.map(role => {
          const roleTally = tally[role.hash] ?? {};
          const sorted    = [...allMemberIds]
            .map(id => ({ id, votes: roleTally[id] ?? 0 }))
            .filter(c => c.votes > 0)
            .sort((a, b) => b.votes - a.votes || a.id - b.id);

          const leader    = sorted[0];
          const maxVotes  = leader?.votes ?? 1;

          return (
            <div key={role.hash} className={`border ${sessionResolved && leader ? "border-green-300" : "border-[--border]"} bg-[--bg]`}>
              <div className={`px-4 py-2.5 flex items-center justify-between ${sessionResolved && leader ? "bg-green-50/30" : "bg-[--bg-card]"} border-b border-[--border]`}>
                <div>
                  <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-wide">
                    {role.group === "institutional" ? "Institutionnel" : "Créatif"}
                  </p>
                  <p className="font-bold text-sm">{role.label}</p>
                </div>
                {sessionResolved && leader && (
                  <span className="font-mono text-xs text-green-700 border border-green-300 bg-green-100 px-2 py-0.5">
                    Élu
                  </span>
                )}
              </div>

              <div className="px-4 py-3 space-y-2">
                {sorted.length === 0 ? (
                  <p className="font-mono text-xs text-[--fg-muted] italic">Pas de votes</p>
                ) : (
                  sorted.map((c, rank) => {
                    const pct = Math.round((c.votes / maxVotes) * 100);
                    return (
                      <div key={c.id} className={`space-y-1 ${rank === 0 && sessionResolved ? "opacity-100" : rank === 0 ? "opacity-100" : "opacity-70"}`}>
                        <div className="flex items-center gap-2">
                          <div className="relative w-7 h-7 shrink-0 overflow-hidden">
                            <Image
                              src={getNormieImageUrl(c.id)}
                              alt={`#${c.id}`}
                              fill
                              className="object-contain"
                              style={{ imageRendering: "pixelated" }}
                              unoptimized
                            />
                          </div>
                          <span className="font-mono text-xs font-bold">#{c.id}</span>
                          {rank === 0 && <span className="font-mono text-xs">← tête</span>}
                          <span className="font-mono text-xs text-[--fg-muted] ml-auto">
                            {c.votes} vote{c.votes > 1 ? "s" : ""}
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="h-1.5 bg-[--bg-card] border border-[--border] overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${rank === 0 ? "bg-[--fg]" : "bg-[--fg]/30"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CreativeAssemblySection ──────────────────────────────────────────────────

const WR_ADDR = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

function CreativeAssemblySection() {
  const { address } = useAccount();

  // Load elected members + personas from API
  const [elected, setElected]   = useState<ElectedMember[]>([]);
  const [loading, setLoading]   = useState(false);
  const [loadErr, setLoadErr]   = useState<string | null>(null);

  // LLM discussion state
  const [discussing, setDiscussing] = useState(false);
  const [transcript, setTranscript] = useState<string>("");
  const [llmError,   setLlmError]   = useState<string | null>(null);
  const [brief,      setBrief]      = useState<string | null>(null);

  // Artwork generation
  const [generating,    setGenerating]    = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [genError,      setGenError]      = useState<string | null>(null);

  // initiateWorkSession tx
  const [txHash,  setTxHash]  = useState<`0x${string}` | null>(null);
  const [txState, setTxState] = useState<"idle"|"pending"|"confirming"|"done"|"error">("idle");
  const [txError, setTxError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });
  useEffect(() => {
    if (txConfirmed && txState === "confirming") setTxState("done");
  }, [txConfirmed, txState]);

  // Owner check for WorkRegistry
  const { data: wrOwnerRaw } = useReadContract({
    address: WR_ADDR, abi: WORK_REGISTRY_ABI, functionName: "owner",
    query: { enabled: !!WR_ADDR },
  });
  const isWROwner = !!(address && wrOwnerRaw &&
    address.toLowerCase() === (wrOwnerRaw as string).toLowerCase());

  // Load elected on mount
  useEffect(() => {
    setLoading(true);
    fetch("/api/assembly/elected")
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: { elected: ElectedMember[] }) => setElected(d.elected))
      .catch(e => setLoadErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const activeElected = elected.filter(m => m.tokenId > 0);
  const hasGroq = true; // determined at runtime — error shown if key missing

  // ── Lancer la discussion ────────────────────────────────────────────────────
  const launchDiscussion = useCallback(async () => {
    if (discussing || activeElected.length === 0) return;
    setDiscussing(true);
    setTranscript("");
    setBrief(null);
    setLlmError(null);

    try {
      const res = await fetch("/api/llm/discuss", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ elected: activeElected, rounds: 2 }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
      }

      // Stream SSE from Groq
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const chunk = JSON.parse(raw);
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            if (delta) setTranscript(prev => prev + delta);
          } catch { /* skip malformed */ }
        }
      }

      // Extract brief from transcript
      setTranscript(prev => {
        const briefMatch = prev.match(/BRIEF ARTISTIQUE[:\s]+([\s\S]+)/i);
        if (briefMatch) setBrief(briefMatch[0]);
        return prev;
      });
    } catch (e) {
      setLlmError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscussing(false);
    }
  }, [discussing, activeElected]);

  // ── Générer l'œuvre HTML depuis le brief ───────────────────────────────────
  const generateArtwork = useCallback(async (briefText: string) => {
    setGenerating(true);
    setGeneratedHtml(null);
    setGenError(null);
    try {
      const res = await fetch("/api/llm/generate-artwork", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ brief: briefText, elected: activeElected }),
      });
      const data = await res.json() as { html?: string; error?: string };
      if (!res.ok || !data.html) throw new Error(data.error ?? "Aucun HTML retourné");
      setGeneratedHtml(data.html);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [activeElected]);

  // ── Initier une session de création ────────────────────────────────────────
  const initiateSession = useCallback(async () => {
    setTxError(null);
    setTxState("pending");
    try {
      const hash = await writeContractAsync({
        address: WR_ADDR, abi: WORK_REGISTRY_ABI, functionName: "initiateWorkSession",
      });
      setTxHash(hash);
      setTxState("confirming");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxError(msg.includes("rejected") ? "Transaction annulée" : msg.slice(0, 120));
      setTxState("error");
    }
  }, [writeContractAsync]);

  if (loading) return (
    <div className="flex items-center gap-3 py-6">
      <div className="w-4 h-4 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
      <p className="font-mono text-xs text-[--fg-muted]">Chargement des élus…</p>
    </div>
  );

  if (loadErr) return (
    <div className="border border-red-300 p-5">
      <p className="font-mono text-xs text-red-600">Erreur : {loadErr}</p>
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Section header */}
      <div className="border-t-2 border-[--fg] pt-8">
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-2">
          Phase créative — post-assemblée
        </p>
        <h2 className="text-2xl font-bold mb-2">Assemblée Créative</h2>
        <p className="text-[--fg-muted] text-sm max-w-2xl">
          Les 6 Normies élus discutent et se mettent d'accord sur la première œuvre collective.
          La discussion est simulée par LLM à partir de leurs personas on-chain.
          Le résultat est un brief artistique que le Rapporteur publie directement dans le contrat.
        </p>
      </div>

      {/* Elected members grid */}
      {activeElected.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {activeElected.map(m => (
            <div key={m.role} className="border border-[--border] bg-[--bg-card] p-3 space-y-2 text-center">
              <div className="relative w-12 h-12 mx-auto overflow-hidden">
                <Image
                  src={getNormieImageUrl(m.tokenId)}
                  alt={`#${m.tokenId}`}
                  fill
                  className="object-contain"
                  style={{ imageRendering: "pixelated" }}
                  unoptimized
                />
              </div>
              <div>
                <p className="font-mono text-xs font-bold">#{m.tokenId}</p>
                <p className="font-mono text-xs text-[--fg-muted] leading-tight">{m.roleLabel}</p>
                {m.persona?.archetype && (
                  <p className="font-mono text-xs text-[--fg-muted]/70 truncate" title={m.persona.archetype}>
                    {m.persona.archetype}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-[--border] bg-[--bg-card] p-6 text-center">
          <p className="font-mono text-xs text-[--fg-muted]">
            Aucun rôle encore attribué — clôturez d'abord l'assemblée constituante.
          </p>
        </div>
      )}

      {/* Actions */}
      {activeElected.length > 0 && (
        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={launchDiscussion}
            disabled={discussing}
            className="font-mono text-xs bg-[--fg] text-[--bg] px-6 py-3 hover:opacity-80 disabled:opacity-40 disabled:cursor-wait"
          >
            {discussing ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border border-[--bg] border-t-transparent rounded-full animate-spin" />
                Discussion en cours…
              </span>
            ) : "Lancer la discussion →"}
          </button>

          {(isWROwner || txState !== "idle") && (
            <button
              onClick={initiateSession}
              disabled={txState === "pending" || txState === "confirming"}
              className="font-mono text-xs border border-[--border] px-5 py-3 hover:bg-[--bg-card] disabled:opacity-40"
            >
              {txState === "pending"    ? "Signez dans votre wallet…" :
               txState === "confirming" ? "Confirmation…" :
               txState === "done"       ? "✓ Session initiée" :
               "Initier une session on-chain →"}
            </button>
          )}

          {(txState === "done") && (
            <a
              href="/publish"
              className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-3 hover:opacity-80"
            >
              Publier l'œuvre →
            </a>
          )}
        </div>
      )}

      {txError && (
        <p className="font-mono text-xs text-red-600">{txError}</p>
      )}

      {/* LLM error */}
      {llmError && (
        <div className="border border-red-300 bg-red-50/20 p-4">
          <p className="font-mono text-xs text-red-600">
            {llmError.includes("GROQ_API_KEY")
              ? "LLM non configuré — ajoutez GROQ_API_KEY dans .env.local"
              : llmError}
          </p>
        </div>
      )}

      {/* Discussion transcript */}
      {transcript && (
        <div className="border border-[--border] bg-[--bg]">
          <div className="flex items-center justify-between px-4 py-2.5 bg-[--bg-card] border-b border-[--border]">
            <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">
              Transcript — Discussion des Normies élus
            </p>
            {discussing && (
              <span className="flex items-center gap-1.5 font-mono text-xs text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                En direct
              </span>
            )}
          </div>
          <pre className="p-5 text-xs font-mono leading-relaxed whitespace-pre-wrap text-[--fg] max-h-[500px] overflow-y-auto">
            {transcript}
          </pre>
        </div>
      )}

      {/* Brief artistique extracted */}
      {brief && !discussing && (
        <div className="border-2 border-[--fg] p-6 space-y-4">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
            Brief artistique — décision de l'assemblée
          </p>
          <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap">{brief}</pre>

          {/* Generate artwork from brief */}
          <div className="border-t border-[--border] pt-4 space-y-4">
            <p className="font-mono text-xs text-[--fg-muted]">
              Étape suivante : générer le programme HTML/JS qui incarne ce brief.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => generateArtwork(brief)}
                disabled={generating}
                className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 disabled:cursor-wait"
              >
                {generating ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border border-[--bg] border-t-transparent rounded-full animate-spin" />
                    Génération en cours…
                  </span>
                ) : "Générer l'œuvre →"}
              </button>
              <a
                href="/publish"
                className="font-mono text-xs border border-[--border] px-5 py-2.5 hover:bg-[--bg-card]"
              >
                Publier manuellement →
              </a>
            </div>

            {genError && (
              <p className="font-mono text-xs text-red-600">
                {genError.includes("GROQ_API_KEY")
                  ? "LLM non configuré — ajoutez GROQ_API_KEY dans .env.local"
                  : genError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Generated artwork preview */}
      {generatedHtml && (
        <div className="space-y-4">
          <div className="border-2 border-green-400 bg-[--bg]">
            <div className="flex items-center justify-between px-5 py-3 bg-green-50/20 border-b border-green-300">
              <p className="font-mono text-xs text-green-700 uppercase tracking-widest">
                Œuvre générée — preview sandbox
              </p>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="font-mono text-xs text-green-700">Prête à publier</span>
              </div>
            </div>
            <iframe
              srcDoc={generatedHtml}
              className="w-full h-[480px] border-0 bg-black"
              sandbox="allow-scripts"
              title="Œuvre générée"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Pass HTML as sessionStorage key to /publish */}
            <button
              onClick={() => {
                sessionStorage.setItem("ana_generated_html", generatedHtml);
                window.location.href = "/publish";
              }}
              className="font-mono text-xs bg-[--fg] text-[--bg] px-6 py-3 hover:opacity-80"
            >
              Publier cette œuvre on-chain →
            </button>
            <button
              onClick={() => generateArtwork(brief ?? "")}
              disabled={generating}
              className="font-mono text-xs border border-[--border] px-5 py-3 hover:bg-[--bg-card] disabled:opacity-40"
            >
              {generating ? "Régénération…" : "↺ Régénérer"}
            </button>
          </div>

          <p className="font-mono text-xs text-[--fg-muted]">
            Le HTML sera encodé base64 et stocké directement dans WorkRegistry — aucun service externe.
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

      {/* Election results — visible during and after session */}
      {allMemberIds.length > 0 && (
        <div className="border-t border-[--border] pt-8">
          <ElectionResults
            allMemberIds={allMemberIds}
            sessionResolved={liveSession?.resolved ?? false}
          />
        </div>
      )}

      {/* Creative assembly — visible once session is resolved */}
      {liveSession?.resolved && <CreativeAssemblySection />}
    </div>
  );
}
