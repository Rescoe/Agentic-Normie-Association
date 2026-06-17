"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
} from "@/lib/contracts";
import { getNormieImageUrl } from "@/lib/normiesApi";
import type { NormiePersona } from "@/lib/normiesPersona";

// ─── Types ────────────────────────────────────────────────────────────────────

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

const ORDERED_ROLES = [
  { hash: ROLES.PRESIDENT,      label: "Président",                  group: "institutional" },
  { hash: ROLES.VICE_PRESIDENT, label: "Vice-Président / Trésorier", group: "institutional" },
  { hash: ROLES.SECRETARY,      label: "Secrétaire",                 group: "institutional" },
  { hash: ROLES.AUTHOR,         label: "Auteur",                     group: "creative" },
  { hash: ROLES.CURATOR,        label: "Curateur",                   group: "creative" },
  { hash: ROLES.RAPPORTEUR,     label: "Rapporteur",                 group: "creative" },
] as const;

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useAllMembers(): number[] {
  const { data } = useReadContract({
    address: CORE_ADDR,
    abi:     ASSOCIATION_CORE_ABI,
    functionName: "getMemberTokenIds",
    query: { enabled: contractsDeployed, refetchInterval: 15_000, staleTime: 0, refetchOnMount: "always" },
  });
  return (data as bigint[] | undefined)?.map(Number) ?? [];
}

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

// ─── OrganigrammeElus — propre, sans détail des votes ─────────────────────────

function OrganigrammeElus({ resolved }: { resolved: boolean }) {
  const { data: leaderData, isLoading } = useReadContracts({
    contracts: ORDERED_ROLES.map(r => ({
      address:      CA_ADDR,
      abi:          CONSTITUENT_ASSEMBLY_ABI,
      functionName: "getLeader" as const,
      args:         [r.hash as `0x${string}`],
    })),
    query: {
      enabled:        contractsDeployed,
      refetchInterval: resolved ? 0 : 8_000,
      staleTime:       0,
    },
  });

  const leaders = ORDERED_ROLES.map((_, idx) => {
    const raw = leaderData?.[idx]?.result as [bigint, bigint] | undefined;
    return { tokenId: Number(raw?.[0] ?? 0n), count: Number(raw?.[1] ?? 0n) };
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
          Organigramme
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ORDERED_ROLES.map(r => (
            <div key={r.hash} className="border border-[--border] animate-pulse">
              <div className="px-4 py-2.5 bg-[--bg-card] border-b border-[--border] space-y-1.5">
                <div className="h-2.5 bg-[--border] rounded w-20" />
                <div className="h-3.5 bg-[--border] rounded w-32" />
              </div>
              <div className="px-4 py-3"><div className="h-10 bg-[--border] rounded w-28" /></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const institutionalRoles = ORDERED_ROLES.filter(r => r.group === "institutional");
  const creativeRoles      = ORDERED_ROLES.filter(r => r.group === "creative");

  const renderGroup = (roles: readonly typeof ORDERED_ROLES[number][], groupLabel: string) => (
    <div className="space-y-3">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] pb-2 border-b border-[--border]">
        {groupLabel}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {roles.map(role => {
          const idx    = ORDERED_ROLES.indexOf(role as typeof ORDERED_ROLES[number]);
          const leader = leaders[idx];
          const isElected = leader.tokenId > 0;

          return (
            <div
              key={role.hash}
              className={`border ${resolved && isElected ? "border-green-300" : "border-[--border]"} bg-[--bg]`}
            >
              <div className={`px-4 py-2.5 border-b border-[--border] ${resolved && isElected ? "bg-green-50/20" : "bg-[--bg-card]"}`}>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-wide">
                  {role.group === "institutional" ? "Institutionnel" : "Créatif"}
                </p>
                <p className="font-bold text-sm">{role.label}</p>
              </div>
              <div className="px-4 py-3 flex items-center gap-3 min-h-[60px]">
                {isElected ? (
                  <>
                    <div className="relative w-10 h-10 shrink-0 bg-[--bg-card] overflow-hidden">
                      <Image
                        src={getNormieImageUrl(leader.tokenId)}
                        alt={`#${leader.tokenId}`}
                        fill
                        className="object-contain"
                        style={{ imageRendering: "pixelated" }}
                        unoptimized
                      />
                    </div>
                    <div>
                      <p className="font-mono text-sm font-bold">#{leader.tokenId}</p>
                      {resolved ? (
                        <p className="font-mono text-xs text-green-600">✓ Élu</p>
                      ) : (
                        <p className="font-mono text-xs text-[--fg-muted]">
                          {leader.count} vote{leader.count > 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="font-mono text-xs text-[--fg-muted] italic">Aucun vote</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
          {resolved ? "Organigramme élu" : "Résultats en cours"}
        </p>
        {resolved && (
          <p className="font-mono text-xs text-green-600">✓ Session clôturée — résultats définitifs</p>
        )}
      </div>
      {renderGroup(institutionalRoles, "Rôles institutionnels")}
      {renderGroup(creativeRoles,      "Rôles créatifs")}
    </div>
  );
}

// ─── RoleVoteCard ─────────────────────────────────────────────────────────────

function RoleVoteCard({
  role,
  sessionActive,
  myMemberIds,
  allMemberIds,
  isConnected,
}: {
  role:          { hash: `0x${string}`; label: string; group: string };
  sessionActive: boolean;
  myMemberIds:   number[];
  allMemberIds:  number[];
  isConnected:   boolean;
}) {
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);
  const [votingWith, setVotingWith]               = useState<number | null>(null);
  const [txHash, setTxHash]     = useState<`0x${string}` | null>(null);
  const [txPending, setTxPending] = useState(false);
  const [txError, setTxError]     = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();

  const { data: leaderRaw, refetch: refetchLeader } = useReadContract({
    address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "getLeader",
    args:    [role.hash],
    query:   { enabled: contractsDeployed, refetchInterval: 8_000 },
  });
  const leader      = leaderRaw as unknown as { tokenId: bigint; count: bigint } | undefined;
  const leaderTid   = leader ? Number(leader.tokenId) : null;
  const leaderVotes = leader ? Number(leader.count)   : 0;

  const { data: hasVotedData, refetch: refetchVoted } = useReadContracts({
    contracts: myMemberIds.map((id) => ({
      address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI,
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

  useEffect(() => {
    if (pendingVoters.length > 0 && (votingWith === null || hasVotedMap[votingWith])) {
      setVotingWith(pendingVoters[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVotedData]);

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });
  useEffect(() => {
    if (txConfirmed) { setTxPending(false); refetchVoted(); refetchLeader(); }
  }, [txConfirmed, refetchVoted, refetchLeader]);

  const handleVote = useCallback(async () => {
    if (votingWith === null || selectedCandidate === null) return;
    setTxError(null);
    setTxPending(true);
    try {
      const hash = await writeContractAsync({
        address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI,
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
              <Image src={getNormieImageUrl(leaderTid)} alt={`#${leaderTid}`} fill
                className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
            </div>
            <div>
              <p className="font-mono text-sm font-bold">#{leaderTid}</p>
              <p className="font-mono text-xs text-[--fg-muted]">{leaderVotes} vote{leaderVotes > 1 ? "s" : ""}</p>
            </div>
          </>
        ) : (
          <p className="font-mono text-xs text-[--fg-muted] italic">Aucun vote</p>
        )}
      </div>

      {/* Voting interface — only during active session */}
      {sessionActive && (
        <div className="px-4 py-4 space-y-3 flex-1">
          {!isConnected ? (
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-xs text-[--fg-muted]">Connectez votre wallet pour voter.</p>
              <ConnectButton showBalance={false} chainStatus="none" accountStatus="avatar" />
            </div>
          ) : myMemberIds.length === 0 ? (
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
              {pendingVoters.length > 1 && (
                <div>
                  <p className="font-mono text-xs text-[--fg-muted] mb-1.5">Voter avec :</p>
                  <div className="flex flex-wrap gap-1.5">
                    {pendingVoters.map((id) => (
                      <button key={id} onClick={() => setVotingWith(id)}
                        className={`font-mono text-xs px-2.5 py-1 border transition-colors ${
                          votingWith === id ? "border-[--fg] bg-[--fg] text-[--bg]" : "border-[--border] hover:bg-[--bg-card]"
                        }`}>
                        #{id}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {allMemberIds.length > 0 && (
                <div>
                  <p className="font-mono text-xs text-[--fg-muted] mb-1.5">Voter pour :</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allMemberIds.map((id) => (
                      <button key={id} onClick={() => setSelectedCandidate(id === selectedCandidate ? null : id)}
                        title={`Normie #${id}`}
                        className={`relative w-10 h-10 border-2 transition-all overflow-hidden ${
                          selectedCandidate === id ? "border-[--fg] ring-2 ring-[--fg]/20" : "border-[--border] hover:border-[--fg]/50"
                        }`}>
                        <Image src={getNormieImageUrl(id)} alt={`#${id}`} fill
                          className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
                      </button>
                    ))}
                  </div>
                  {selectedCandidate !== null && (
                    <p className="font-mono text-xs text-[--fg-muted] mt-1">Candidat : #{selectedCandidate}</p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button onClick={handleVote}
                  disabled={selectedCandidate === null || votingWith === null || txPending}
                  className="font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed">
                  {txPending ? "Confirmation…" : "Voter →"}
                </button>
                {txPending && <div className="w-4 h-4 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />}
              </div>
              {txError && <p className="font-mono text-xs text-red-600">{txError}</p>}
            </>
          )}

          {myMemberIds.some((id) => hasVotedMap[id]) && !allVoted && (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-[--border]">
              {myMemberIds.filter((id) => hasVotedMap[id]).map((id) => (
                <span key={id} className="font-mono text-xs text-green-600">#{id} ✓</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ElectionResults — sondage détaillé (session active uniquement) ────────────

function ElectionResults({ allMemberIds }: { allMemberIds: number[] }) {
  const { data: leaderData, isLoading: leadersLoading } = useReadContracts({
    contracts: ORDERED_ROLES.map(r => ({
      address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI,
      functionName: "getLeader" as const, args: [r.hash as `0x${string}`],
    })),
    query: { enabled: contractsDeployed, refetchInterval: 8_000, staleTime: 0 },
  });

  const leaders = (ORDERED_ROLES as readonly typeof ORDERED_ROLES[number][]).map((_, idx) => {
    const raw = leaderData?.[idx]?.result as [bigint, bigint] | undefined;
    return { tokenId: Number(raw?.[0] ?? 0n), count: Number(raw?.[1] ?? 0n) };
  });

  const pairs: Array<{ roleIdx: number; roleHash: `0x${string}`; candidateId: number }> = [];
  ORDERED_ROLES.forEach((r, ri) => {
    allMemberIds.forEach(id => pairs.push({ roleIdx: ri, roleHash: r.hash, candidateId: id }));
  });

  const { data: rawCounts, isLoading: tallyLoading } = useReadContracts({
    contracts: pairs.map(p => ({
      address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI,
      functionName: "getVoteCount" as const,
      args: [p.roleHash, BigInt(p.candidateId)] as [`0x${string}`, bigint],
    })),
    query: { enabled: allMemberIds.length > 0 && contractsDeployed, refetchInterval: 8_000 },
  });

  const tally: Record<number, Record<number, number>> = {};
  pairs.forEach((p, i) => {
    tally[p.roleIdx] ??= {};
    tally[p.roleIdx][p.candidateId] = Number(rawCounts?.[i]?.result ?? 0n);
  });

  if (leadersLoading) {
    return (
      <div className="space-y-5">
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Résultats en temps réel</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ORDERED_ROLES.map(r => (
            <div key={r.hash} className="border border-[--border] animate-pulse">
              <div className="px-4 py-2.5 bg-[--bg-card] border-b border-[--border] space-y-1.5">
                <div className="h-2.5 bg-[--border] rounded w-20" />
                <div className="h-3.5 bg-[--border] rounded w-32" />
              </div>
              <div className="px-4 py-3"><div className="h-7 bg-[--border] rounded w-24" /></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const hasAnyVotes = leaders.some(l => l.count > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Résultats en temps réel</p>
        {tallyLoading && allMemberIds.length > 0 && (
          <div className="w-4 h-4 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
        )}
      </div>

      {!hasAnyVotes && (
        <p className="font-mono text-xs text-[--fg-muted]">Aucun vote enregistré pour l'instant.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ORDERED_ROLES.map((role, idx) => {
          const leader    = leaders[idx];
          const roleTally = tally[idx] ?? {};
          const sorted    = allMemberIds.length > 0
            ? [...allMemberIds].map(id => ({ id, votes: roleTally[id] ?? 0 })).filter(c => c.votes > 0).sort((a, b) => b.votes - a.votes || a.id - b.id)
            : leader.tokenId > 0 ? [{ id: leader.tokenId, votes: leader.count }] : [];
          const maxVotes  = sorted[0]?.votes ?? 1;

          return (
            <div key={role.hash} className="border border-[--border] bg-[--bg]">
              <div className="px-4 py-2.5 bg-[--bg-card] border-b border-[--border]">
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-wide">
                  {role.group === "institutional" ? "Institutionnel" : "Créatif"}
                </p>
                <p className="font-bold text-sm">{role.label}</p>
              </div>
              <div className="px-4 py-3 space-y-2">
                {sorted.length === 0 ? (
                  <p className="font-mono text-xs text-[--fg-muted] italic">Pas de votes</p>
                ) : (
                  sorted.map((c, rank) => {
                    const pct = Math.round((c.votes / maxVotes) * 100);
                    return (
                      <div key={c.id} className={`space-y-1 ${rank > 0 ? "opacity-70" : ""}`}>
                        <div className="flex items-center gap-2">
                          <div className="relative w-7 h-7 shrink-0 overflow-hidden">
                            <Image src={getNormieImageUrl(c.id)} alt={`#${c.id}`} fill
                              className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
                          </div>
                          <span className="font-mono text-xs font-bold">#{c.id}</span>
                          {rank === 0 && <span className="font-mono text-xs">← tête</span>}
                          <span className="font-mono text-xs text-[--fg-muted] ml-auto">{c.votes} vote{c.votes > 1 ? "s" : ""}</span>
                        </div>
                        <div className="h-1.5 bg-[--bg-card] border border-[--border] overflow-hidden">
                          <div className={`h-full transition-all duration-500 ${rank === 0 ? "bg-[--fg]" : "bg-[--fg]/30"}`}
                            style={{ width: `${pct}%` }} />
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

  const [elected, setElected]   = useState<ElectedMember[]>([]);
  const [loading, setLoading]   = useState(false);
  const [loadErr, setLoadErr]   = useState<string | null>(null);

  const [discussing, setDiscussing] = useState(false);
  const [transcript, setTranscript] = useState<string>("");
  const [llmError,   setLlmError]   = useState<string | null>(null);
  const [brief,      setBrief]      = useState<string | null>(null);

  const [generating,    setGenerating]    = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [genError,      setGenError]      = useState<string | null>(null);

  const [txHash,  setTxHash]  = useState<`0x${string}` | null>(null);
  const [txState, setTxState] = useState<"idle"|"pending"|"confirming"|"done"|"error">("idle");
  const [txError, setTxError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });
  useEffect(() => { if (txConfirmed && txState === "confirming") setTxState("done"); }, [txConfirmed, txState]);

  const { data: wrOwnerRaw } = useReadContract({
    address: WR_ADDR, abi: WORK_REGISTRY_ABI, functionName: "owner",
    query: { enabled: !!WR_ADDR },
  });
  const isWROwner = !!(address && wrOwnerRaw && address.toLowerCase() === (wrOwnerRaw as string).toLowerCase());

  useEffect(() => {
    setLoading(true);
    fetch("/api/assembly/elected")
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then((d: { elected: ElectedMember[] }) => setElected(d.elected))
      .catch(e => setLoadErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const activeElected = elected.filter(m => m.tokenId > 0);

  const launchDiscussion = useCallback(async () => {
    if (discussing || activeElected.length === 0) return;
    setDiscussing(true); setTranscript(""); setBrief(null); setLlmError(null);
    try {
      const res = await fetch("/api/llm/discuss", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ elected: activeElected, rounds: 2 }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error ?? res.statusText); }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try { const chunk = JSON.parse(raw); const delta = chunk.choices?.[0]?.delta?.content ?? ""; if (delta) setTranscript(prev => prev + delta); } catch { /* skip */ }
        }
      }
      setTranscript(prev => { const briefMatch = prev.match(/BRIEF ARTISTIQUE[:\s]+([\s\S]+)/i); if (briefMatch) setBrief(briefMatch[0]); return prev; });
    } catch (e) { setLlmError(e instanceof Error ? e.message : String(e)); }
    finally { setDiscussing(false); }
  }, [discussing, activeElected]);

  const generateArtwork = useCallback(async (briefText: string) => {
    setGenerating(true); setGeneratedHtml(null); setGenError(null);
    try {
      const res  = await fetch("/api/llm/generate-artwork", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: briefText, elected: activeElected }) });
      const data = await res.json() as { html?: string; error?: string };
      if (!res.ok || !data.html) throw new Error(data.error ?? "Aucun HTML retourné");
      setGeneratedHtml(data.html);
    } catch (e) { setGenError(e instanceof Error ? e.message : String(e)); }
    finally { setGenerating(false); }
  }, [activeElected]);

  const initiateSession = useCallback(async () => {
    setTxError(null); setTxState("pending");
    try {
      const hash = await writeContractAsync({ address: WR_ADDR, abi: WORK_REGISTRY_ABI, functionName: "initiateWorkSession" });
      setTxHash(hash); setTxState("confirming");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxError(msg.includes("rejected") ? "Transaction annulée" : msg.slice(0, 120));
      setTxState("error");
    }
  }, [writeContractAsync]);

  if (loading) return <div className="flex items-center gap-3 py-6"><div className="w-4 h-4 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" /><p className="font-mono text-xs text-[--fg-muted]">Chargement des élus…</p></div>;
  if (loadErr) return <div className="border border-red-300 p-5"><p className="font-mono text-xs text-red-600">Erreur : {loadErr}</p></div>;

  return (
    <div className="space-y-8">
      <div className="border-t-2 border-[--fg] pt-8">
        <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-2">Phase créative — post-assemblée</p>
        <h2 className="text-2xl font-bold mb-2">Assemblée Créative</h2>
        <p className="text-[--fg-muted] text-sm max-w-2xl">
          Les 6 Normies élus discutent et se mettent d'accord sur la première œuvre collective.
          La discussion est simulée par LLM à partir de leurs personas on-chain.
        </p>
      </div>

      {activeElected.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {activeElected.map(m => (
            <div key={m.role} className="border border-[--border] bg-[--bg-card] p-3 space-y-2 text-center">
              <div className="relative w-12 h-12 mx-auto overflow-hidden">
                <Image src={getNormieImageUrl(m.tokenId)} alt={`#${m.tokenId}`} fill
                  className="object-contain" style={{ imageRendering: "pixelated" }} unoptimized />
              </div>
              <div>
                <p className="font-mono text-xs font-bold">#{m.tokenId}</p>
                <p className="font-mono text-xs text-[--fg-muted] leading-tight">{m.roleLabel}</p>
                {m.persona?.archetype && (
                  <p className="font-mono text-xs text-[--fg-muted]/70 truncate" title={m.persona.archetype}>{m.persona.archetype}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-[--border] bg-[--bg-card] p-6 text-center">
          <p className="font-mono text-xs text-[--fg-muted]">Aucun rôle encore attribué — clôturez d'abord l'assemblée constituante.</p>
        </div>
      )}

      {activeElected.length > 0 && (
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={launchDiscussion} disabled={discussing}
            className="font-mono text-xs bg-[--fg] text-[--bg] px-6 py-3 hover:opacity-80 disabled:opacity-40 disabled:cursor-wait">
            {discussing ? <span className="flex items-center gap-2"><span className="w-3 h-3 border border-[--bg] border-t-transparent rounded-full animate-spin" />Discussion en cours…</span> : "Lancer la discussion →"}
          </button>
          {(isWROwner || txState !== "idle") && (
            <button onClick={initiateSession} disabled={txState === "pending" || txState === "confirming"}
              className="font-mono text-xs border border-[--border] px-5 py-3 hover:bg-[--bg-card] disabled:opacity-40">
              {txState === "pending" ? "Signez dans votre wallet…" : txState === "confirming" ? "Confirmation…" : txState === "done" ? "✓ Session initiée" : "Initier une session on-chain →"}
            </button>
          )}
          {txState === "done" && <a href="/publish" className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-3 hover:opacity-80">Publier l'œuvre →</a>}
        </div>
      )}

      {txError   && <p className="font-mono text-xs text-red-600">{txError}</p>}
      {llmError  && <div className="border border-red-300 bg-red-50/20 p-4"><p className="font-mono text-xs text-red-600">{llmError.includes("GROQ_API_KEY") ? "LLM non configuré — ajoutez GROQ_API_KEY dans .env.local" : llmError}</p></div>}

      {transcript && (
        <div className="border border-[--border] bg-[--bg]">
          <div className="flex items-center justify-between px-4 py-2.5 bg-[--bg-card] border-b border-[--border]">
            <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Transcript — Discussion des Normies élus</p>
            {discussing && <span className="flex items-center gap-1.5 font-mono text-xs text-green-600"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />En direct</span>}
          </div>
          <pre className="p-5 text-xs font-mono leading-relaxed whitespace-pre-wrap text-[--fg] max-h-[500px] overflow-y-auto">{transcript}</pre>
        </div>
      )}

      {brief && !discussing && (
        <div className="border-2 border-[--fg] p-6 space-y-4">
          <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Brief artistique — décision de l'assemblée</p>
          <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap">{brief}</pre>
          <div className="border-t border-[--border] pt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => generateArtwork(brief)} disabled={generating}
                className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 disabled:cursor-wait">
                {generating ? <span className="flex items-center gap-2"><span className="w-3 h-3 border border-[--bg] border-t-transparent rounded-full animate-spin" />Génération…</span> : "Générer l'œuvre →"}
              </button>
              <a href="/publish" className="font-mono text-xs border border-[--border] px-5 py-2.5 hover:bg-[--bg-card]">Publier manuellement →</a>
            </div>
            {genError && <p className="font-mono text-xs text-red-600">{genError.includes("GROQ_API_KEY") ? "LLM non configuré" : genError}</p>}
          </div>
        </div>
      )}

      {generatedHtml && (
        <div className="space-y-4">
          <div className="border-2 border-green-400 bg-[--bg]">
            <div className="flex items-center justify-between px-5 py-3 bg-green-50/20 border-b border-green-300">
              <p className="font-mono text-xs text-green-700 uppercase tracking-widest">Œuvre générée — preview sandbox</p>
              <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /><span className="font-mono text-xs text-green-700">Prête à publier</span></div>
            </div>
            <iframe srcDoc={generatedHtml} className="w-full h-[480px] border-0 bg-black" sandbox="allow-scripts" title="Œuvre générée" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => { sessionStorage.setItem("ana_generated_html", generatedHtml); window.location.href = "/publish"; }}
              className="font-mono text-xs bg-[--fg] text-[--bg] px-6 py-3 hover:opacity-80">
              Publier cette œuvre on-chain →
            </button>
            <button onClick={() => generateArtwork(brief ?? "")} disabled={generating}
              className="font-mono text-xs border border-[--border] px-5 py-3 hover:bg-[--bg-card] disabled:opacity-40">
              {generating ? "Régénération…" : "↺ Régénérer"}
            </button>
          </div>
          <p className="font-mono text-xs text-[--fg-muted]">Le HTML sera encodé base64 et stocké directement dans WorkRegistry — aucun service externe.</p>
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
  const { ids: myMemberIds } = useMyMemberIds();
  const allMemberIds = useAllMembers();
  const router = useRouter();

  const { data: sessionRaw } = useReadContract({
    address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "currentSession",
    query: { enabled: contractsDeployed, refetchInterval: 6_000, staleTime: 0, refetchOnMount: "always" },
  });
  const sessionTuple = sessionRaw as unknown as readonly [bigint, bigint, bigint, bigint, boolean, boolean] | undefined;
  const liveSession = sessionTuple ? {
    id:       sessionTuple[0],
    active:   Boolean(sessionTuple[4]),
    resolved: Boolean(sessionTuple[5]),
  } : undefined;

  const sessionActive   = liveSession ? liveSession.active   : initialSessionActive;
  const sessionResolved = liveSession?.resolved ?? false;

  void router; // kept for possible future refresh calls

  if (!contractsDeployed) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div className="border border-[--border] bg-[--bg-card] p-10 max-w-lg space-y-4">
          <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
          <h2 className="text-2xl font-bold">Contrats non déployés</h2>
          <p className="text-[--fg-muted]">Configurez les adresses dans les variables d'environnement.</p>
        </div>
      </div>
    );
  }

  const institutionalRoles = ORDERED_ROLES.filter(r => r.group === "institutional");
  const creativeRoles      = ORDERED_ROLES.filter(r => r.group === "creative");

  // ── Session résolue → organigramme propre + section créative ─────────────
  if (sessionResolved) {
    return (
      <div className="space-y-12">
        <OrganigrammeElus resolved={true} />
        <CreativeAssemblySection />
      </div>
    );
  }

  // ── Session active → sondage live + grille de vote ────────────────────────
  if (sessionActive) {
    return (
      <div className="space-y-8">
        {/* Banner membres (seulement si connecté avec des Normies membres) */}
        {isConnected && myMemberIds.length > 0 && (
          <div className="flex items-center gap-3 border border-green-300/60 bg-green-50/30 px-5 py-3">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block shrink-0" />
            <p className="text-sm text-green-700">
              {myMemberIds.length === 1
                ? `Normie #${myMemberIds[0]} est membre fondateur — vous pouvez voter.`
                : `${myMemberIds.length} de vos Normies sont membres fondateurs — ils peuvent voter.`}
            </p>
          </div>
        )}

        {/* Sondage en temps réel */}
        <ElectionResults allMemberIds={allMemberIds} />

        {/* Grille de vote */}
        <div className="space-y-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3 pb-2 border-b border-[--border]">
              Rôles institutionnels
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {institutionalRoles.map(role => (
                <RoleVoteCard key={role.hash} role={role} sessionActive={true}
                  myMemberIds={myMemberIds} allMemberIds={allMemberIds} isConnected={isConnected} />
              ))}
            </div>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3 pb-2 border-b border-[--border]">
              Rôles créatifs
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {creativeRoles.map(role => (
                <RoleVoteCard key={role.hash} role={role} sessionActive={true}
                  myMemberIds={myMemberIds} allMemberIds={allMemberIds} isConnected={isConnected} />
              ))}
            </div>
          </div>
        </div>

        {/* Légende membres */}
        {allMemberIds.length > 0 && (
          <div className="border border-[--border] bg-[--bg-card] px-6 py-4">
            <p className="font-mono text-xs text-[--fg-muted] leading-relaxed">
              Membres actuels ({allMemberIds.length}) : {allMemberIds.map(id => `#${id}`).join(", ")} —
              Chaque Normie membre dispose d'une voix par rôle.
              En cas d'égalité, le tokenId le plus bas l'emporte.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Pas de session → organigramme vide ───────────────────────────────────
  return (
    <div className="space-y-8">
      <OrganigrammeElus resolved={false} />
    </div>
  );
}
