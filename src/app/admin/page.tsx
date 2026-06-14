"use client";

/**
 * /admin — Panneau de contrôle de l'association.
 *
 * Sécurité : chaque action est protégée par onlyOwner dans le contrat.
 * Même si quelqu'un accède à cette page, le contrat refusera toute tx
 * non signée par le wallet propriétaire. L'UI n'est que commodité.
 *
 * Fonctions disponibles au owner :
 *   AssociationCore   → authorizeModule, revokeModule, setRelayer
 *   ConstituentAssembly → openSession, closeSession
 */

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useRouter } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { isAddress } from "viem";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import {
  ASSOCIATION_CORE_ABI,
  CONSTITUENT_ASSEMBLY_ABI,
  WORK_REGISTRY_ABI,
  CONTRACT_ADDRESSES,
  ROLES,
  ROLE_LABELS,
} from "@/lib/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────

const CORE_ADDR = CONTRACT_ADDRESSES.AssociationCore     as `0x${string}`;
const CA_ADDR   = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`;
const WR_ADDR   = CONTRACT_ADDRESSES.WorkRegistry        as `0x${string}`;
const contractsDeployed = !!CONTRACT_ADDRESSES.AssociationCore;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function basescanTx(hash: string) {
  return `https://basescan.org/tx/${hash}`;
}
function basescanAddr(addr: string) {
  return `https://basescan.org/address/${addr}`;
}

// ─── AdminAction — un bouton d'action avec état tx ────────────────────────────

function AdminAction({
  label,
  description,
  danger = false,
  disabled = false,
  disabledReason,
  onExec,
}: {
  label:          string;
  description:    string;
  danger?:        boolean;
  disabled?:      boolean;
  disabledReason?: string;
  onExec:         () => Promise<void>;
}) {
  const [state, setState]   = useState<"idle" | "pending" | "confirming" | "done" | "error">("idle");
  const [hash,  setHash]    = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const busy = state === "pending" || state === "confirming";

  const run = async () => {
    setState("pending");
    setError(null);
    try {
      await onExec();
      // onExec sets hash externally via callback — here we just mark confirming
      setState("confirming");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes("rejected") || msg.includes("denied") ? "Transaction annulée" : msg.slice(0, 150));
      setState("error");
    }
  };

  return (
    <div className="border border-[--border] p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="font-bold text-sm">{label}</p>
          <p className="font-mono text-xs text-[--fg-muted] mt-0.5 leading-relaxed">{description}</p>
        </div>
        <button
          onClick={run}
          disabled={busy || disabled || state === "done"}
          title={disabled ? disabledReason : undefined}
          className={`shrink-0 font-mono text-xs px-4 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            state === "done"
              ? "bg-green-100 text-green-700 border border-green-300"
              : danger
              ? "border border-red-400 text-red-600 hover:bg-red-50"
              : "bg-[--fg] text-[--bg] hover:opacity-80"
          }`}
        >
          {busy ? "En cours…" : state === "done" ? "✓ Confirmé" : label}
        </button>
      </div>
      {error && (
        <p className="font-mono text-xs text-red-600 leading-snug">{error}</p>
      )}
      {hash && (
        <a
          href={basescanTx(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-[--fg-muted] underline break-all"
        >
          {hash.slice(0, 18)}…{hash.slice(-6)} ↗
        </a>
      )}
    </div>
  );
}

// ─── StatusRow ────────────────────────────────────────────────────────────────

function StatusRow({ label, value, ok }: { label: string; value: React.ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[--border] last:border-none">
      <p className="font-mono text-xs text-[--fg-muted]">{label}</p>
      <div className="flex items-center gap-2">
        {ok !== undefined && (
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${ok ? "bg-green-500" : "bg-red-400"}`} />
        )}
        <span className="font-mono text-xs text-right break-all max-w-[280px]">{value}</span>
      </div>
    </div>
  );
}

// ─── WorkRegistrySection ─────────────────────────────────────────────────────

function WorkRegistrySection({
  isOwner,
  writeContractAsync,
  onRefresh,
}: {
  isOwner: boolean;
  writeContractAsync: ReturnType<typeof useWriteContract>["writeContractAsync"];
  onRefresh: () => void;
}) {
  const [txHash,  setTxHash]  = useState<`0x${string}` | null>(null);
  const [txState, setTxState] = useState<"idle"|"pending"|"confirming"|"done"|"error">("idle");
  const [txErr,   setTxErr]   = useState<string | null>(null);

  // Schedule config inputs
  const [periodDays,   setPeriodDays]   = useState("30");
  const [nextDateStr,  setNextDateStr]  = useState(""); // ISO date string
  const [scheduleActive, setScheduleActive] = useState(true);

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });
  useEffect(() => {
    if (txConfirmed && txState === "confirming") {
      setTxState("done");
      onRefresh();
      const t = setTimeout(() => setTxState("idle"), 4000);
      return () => clearTimeout(t);
    }
  }, [txConfirmed, txState, onRefresh]);

  const { data: scheduleRaw } = useReadContract({
    address: WR_ADDR, abi: WORK_REGISTRY_ABI, functionName: "getSchedule",
    query: { enabled: !!WR_ADDR, refetchInterval: 10_000 },
  });
  const schedule = scheduleRaw as { nextCreationAt: bigint; periodSeconds: bigint; active: boolean } | undefined;

  const { data: sessionCountRaw } = useReadContract({
    address: WR_ADDR, abi: WORK_REGISTRY_ABI, functionName: "sessionCount",
    query: { enabled: !!WR_ADDR },
  });
  const sessionCount = sessionCountRaw !== undefined ? Number(sessionCountRaw) : 0;

  const exec = async (fn: string, args: unknown[]) => {
    setTxErr(null);
    setTxState("pending");
    try {
      const hash = await writeContractAsync({
        address: WR_ADDR,
        abi: WORK_REGISTRY_ABI as Parameters<typeof writeContractAsync>[0]["abi"],
        functionName: fn as never,
        args: args as never,
      });
      setTxHash(hash);
      setTxState("confirming");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxErr(msg.includes("rejected") ? "Transaction annulée" : msg.slice(0, 150));
      setTxState("error");
    }
  };

  const busy = txState === "pending" || txState === "confirming";

  const nextTs = nextDateStr
    ? Math.floor(new Date(nextDateStr).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const periodSecs = Math.floor(parseFloat(periodDays) * 86400);

  return (
    <section className="space-y-4 border-t border-[--border] pt-10">
      <div>
        <h2 className="text-xl font-bold">WorkRegistry v2</h2>
        <p className="font-mono text-xs text-[--fg-muted] mt-1">
          Gestion des sessions de création collective et du calendrier automatique.
        </p>
      </div>

      {/* Status */}
      <div className="border border-[--border] p-5 space-y-0">
        <StatusRow label="Sessions initiées" value={String(sessionCount)} />
        <StatusRow
          label="Prochaine création"
          value={schedule?.nextCreationAt
            ? new Date(Number(schedule.nextCreationAt) * 1000).toLocaleString("fr-FR")
            : "—"}
        />
        <StatusRow
          label="Période"
          value={schedule?.periodSeconds
            ? `${Math.round(Number(schedule.periodSeconds) / 86400)} jours`
            : "Manuelle"}
        />
        <StatusRow
          label="Déclenchement auto"
          value={schedule?.active ? "Actif" : "Désactivé"}
          ok={schedule?.active}
        />
      </div>

      {/* Initier manuellement */}
      <div className="border border-[--border] p-5 space-y-3">
        <div>
          <p className="font-bold text-sm">Initier une session de création</p>
          <p className="font-mono text-xs text-[--fg-muted] mt-0.5 leading-relaxed">
            Déclenche l'événement <code>WorkSessionInitiated</code> que le pipeline LLM écoute.
            Accessible à l'owner à tout moment. Quand le calendrier est actif, n'importe qui peut
            appeler cette fonction une fois la date atteinte.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => exec("initiateWorkSession", [])}
            disabled={busy || !isOwner}
            className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "En cours…" : txState === "done" ? "✓ Session initiée" : "Initier →"}
          </button>
          {txErr && <p className="font-mono text-xs text-red-600">{txErr}</p>}
        </div>
        {txHash && (
          <a href={basescanTx(txHash)} target="_blank" rel="noopener noreferrer"
            className="font-mono text-xs text-[--fg-muted] underline">
            {txHash.slice(0, 16)}… ↗
          </a>
        )}
      </div>

      {/* Configurer le calendrier */}
      <div className="border border-[--border] p-5 space-y-4">
        <div>
          <p className="font-bold text-sm">Configurer le calendrier automatique</p>
          <p className="font-mono text-xs text-[--fg-muted] mt-0.5 leading-relaxed">
            Définit la prochaine date de création et la période de récurrence.
            Une fois actif, n'importe qui peut appeler <code>initiateWorkSession()</code>
            à partir de la date définie.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <p className="font-mono text-xs text-[--fg-muted] mb-1">Prochaine création</p>
            <input
              type="datetime-local"
              value={nextDateStr}
              onChange={e => setNextDateStr(e.target.value)}
              className="font-mono text-xs border border-[--border] bg-[--bg] px-3 py-2 w-full focus:outline-none focus:border-[--fg]"
            />
          </div>
          <div>
            <p className="font-mono text-xs text-[--fg-muted] mb-1">Période (jours)</p>
            <input
              type="number"
              min="0"
              value={periodDays}
              onChange={e => setPeriodDays(e.target.value)}
              className="font-mono text-xs border border-[--border] bg-[--bg] px-3 py-2 w-full focus:outline-none focus:border-[--fg]"
            />
          </div>
          <div>
            <p className="font-mono text-xs text-[--fg-muted] mb-1">Déclenchement auto</p>
            <button
              onClick={() => setScheduleActive(!scheduleActive)}
              className={`font-mono text-xs border px-3 py-2 w-full ${
                scheduleActive
                  ? "border-green-400 text-green-700 bg-green-50/30"
                  : "border-[--border] text-[--fg-muted]"
              }`}
            >
              {scheduleActive ? "Activé ✓" : "Désactivé"}
            </button>
          </div>
        </div>
        <button
          onClick={() => exec("setSchedule", [BigInt(nextTs), BigInt(periodSecs), scheduleActive])}
          disabled={busy || !isOwner}
          className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "En cours…" : "Enregistrer le calendrier →"}
        </button>
      </div>
    </section>
  );
}

// ─── SalonExchangeSection ────────────────────────────────────────────────────

function SalonExchangeSection() {
  const [running, setRunning] = useState(false);
  const [result,  setResult]  = useState<Record<string, unknown> | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  const run = async (salonId?: string) => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res  = await fetch("/api/keeper/salon-exchange", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(salonId ? { salonId } : {}),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) setError((data.error as string) ?? "Erreur");
      else setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => run()}
          disabled={running}
          className="font-mono text-xs border border-[--fg] bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {running ? "Échanges en cours…" : "Déclencher échanges (tous salons)"}
        </button>
        <button
          onClick={() => run("salon_agora_ana")}
          disabled={running}
          className="font-mono text-xs border border-[--border] px-5 py-2.5 hover:bg-[--bg-card] disabled:opacity-40 transition-colors"
        >
          Agora seulement
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 p-4">
          <p className="font-mono text-xs text-red-600">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-[--bg-card] border border-[--border] p-4 space-y-2">
          <p className="font-mono text-xs font-bold">
            ✓ {String(result.totalMessages ?? 0)} messages générés dans {String(result.salonsRun ?? 0)} salon(s)
          </p>
          {Array.isArray(result.results) && result.results.map((r: Record<string, unknown>, i: number) => (
            <div key={i} className="font-mono text-xs text-[--fg-muted]">
              {String(r.salonId)}: {String(r.messages)} msg
              {Array.isArray(r.skipped) && r.skipped.length > 0 && ` (skipped: ${(r.skipped as string[]).join(", ")})`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AutoVoteSection ─────────────────────────────────────────────────────────

function AutoVoteSection({ sessionActive }: { sessionActive: boolean }) {
  const [running,   setRunning]   = useState(false);
  const [result,    setResult]    = useState<Record<string, unknown> | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [expanded,  setExpanded]  = useState<number | null>(null);

  const run = async (mode: "simulate" | "execute") => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/keeper/auto-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      else         setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  type VoteDecision = {
    voterTokenId: number; voterName: string;
    roleLabel: string;
    candidateTokenId: number; candidateName: string;
    reasoning: string;
  };

  const decisions: VoteDecision[] = (result as { decisions?: VoteDecision[] })?.decisions ?? [];

  // Group by role
  const byRole: Record<string, VoteDecision[]> = {};
  for (const d of decisions) {
    byRole[d.roleLabel] = [...(byRole[d.roleLabel] ?? []), d];
  }

  // Vote counts per role
  const roleSummary: Record<string, Record<number, { name: string; count: number }>> = {};
  for (const [roleLabel, dvs] of Object.entries(byRole)) {
    roleSummary[roleLabel] = {};
    for (const d of dvs) {
      roleSummary[roleLabel][d.candidateTokenId] ??= { name: d.candidateName, count: 0 };
      roleSummary[roleLabel][d.candidateTokenId].count++;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => run("simulate")}
          disabled={running}
          className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 disabled:cursor-wait"
        >
          {running ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border border-[--bg] border-t-transparent rounded-full animate-spin" />
              Simulation LLM en cours…
            </span>
          ) : "Simuler les votes →"}
        </button>

        {!sessionActive && (
          <p className="font-mono text-xs text-[--fg-muted]">
            (Aucune session active — les votes seront simulés mais non appliqués)
          </p>
        )}
      </div>

      {error && (
        <div className="border border-red-300 p-4">
          <p className="font-mono text-xs text-red-600">{error}</p>
        </div>
      )}

      {result && !error && (
        <div className="space-y-4">
          <div className="border border-green-300 bg-green-50/20 px-5 py-3">
            <p className="font-mono text-xs text-green-700">
              ✓ {(result as { decisionCount?: number }).decisionCount ?? decisions.length} décisions générées
              — {(result as { memberCount?: number }).memberCount ?? 0} membres
              × {(result as { roleCount?: number }).roleCount ?? 0} rôles
            </p>
            <p className="font-mono text-xs text-[--fg-muted] mt-1">
              {(result as { note?: string }).note}
            </p>
          </div>

          {/* Role summaries */}
          {Object.entries(roleSummary).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(roleSummary).map(([roleLabel, candidates]) => {
                const sorted = Object.entries(candidates)
                  .sort((a, b) => b[1].count - a[1].count);
                const winner = sorted[0];
                return (
                  <div key={roleLabel} className="border border-[--border] bg-[--bg]">
                    <div className="bg-[--bg-card] border-b border-[--border] px-4 py-2.5 flex items-center justify-between">
                      <p className="font-bold text-sm">{roleLabel}</p>
                      {winner && (
                        <span className="font-mono text-xs text-green-700">
                          #{winner[0]} ({winner[1].count}v)
                        </span>
                      )}
                    </div>
                    <div className="px-4 py-3 space-y-1.5">
                      {sorted.map(([tokenId, info]) => (
                        <div key={tokenId} className="flex items-center gap-3">
                          <div className="h-1.5 flex-1 bg-[--bg-card] border border-[--border] overflow-hidden">
                            <div
                              className="h-full bg-[--fg]/60 transition-all"
                              style={{ width: `${Math.round(info.count / (sorted[0]?.[1].count || 1) * 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-[--fg-muted] w-28 shrink-0 text-right">
                            #{tokenId} — {info.count} vote{info.count > 1 ? "s" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Detail toggle */}
          <details className="border border-[--border]">
            <summary className="bg-[--bg-card] px-5 py-3 cursor-pointer font-mono text-xs text-[--fg-muted] hover:bg-[--bg]">
              Détail des {decisions.length} décisions individuelles →
            </summary>
            <div className="divide-y divide-[--border] max-h-96 overflow-y-auto">
              {decisions.map((d, i) => (
                <div key={i}
                  className="px-5 py-3 grid grid-cols-[1fr_auto] gap-4 cursor-pointer hover:bg-[--bg-card]"
                  onClick={() => setExpanded(expanded === i ? null : i)}
                >
                  <div>
                    <p className="font-mono text-xs">
                      <span className="font-bold">#{d.voterTokenId}</span> → <span className="font-bold">#{d.candidateTokenId}</span>
                      {" "}<span className="text-[--fg-muted]">({d.roleLabel})</span>
                    </p>
                    {expanded === i && (
                      <p className="font-mono text-xs text-[--fg-muted] mt-1 leading-relaxed">{d.reasoning}</p>
                    )}
                  </div>
                  <span className="font-mono text-xs text-[--fg-muted]">{expanded === i ? "▲" : "▼"}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// ─── WorkStatusSection ────────────────────────────────────────────────────────

type ANAWorkSummary = {
  id: string; title: string; state: string; isFoundingWork?: boolean; isBurnMemorial?: boolean;
  proposedByName: string; proposedAt: number; stateHistory: Array<{ state: string; at: number; note?: string }>;
};

const STATE_COLOR: Record<string, string> = {
  PROPOSED:     "text-blue-600",
  VOTE_OPEN:    "text-yellow-600",
  VOTE_TALLIED: "text-orange-600",
  BRIEFING:     "text-purple-600",
  CREATING:     "text-indigo-600",
  VALIDATING:   "text-cyan-600",
  PUBLISHING:   "text-teal-600",
  PUBLISHED:    "text-green-600",
  REJECTED:     "text-red-600",
};

function WorkStatusSection() {
  const [works,   setWorks]   = useState<ANAWorkSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [lcResult, setLcResult] = useState<Record<string, unknown> | null>(null);
  const [lcError,  setLcError]  = useState<string | null>(null);
  const [lcRunning, setLcRunning] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/works");
      if (r.ok) setWorks(await r.json() as ANAWorkSummary[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runLifecycle = async () => {
    setLcRunning(true); setLcResult(null); setLcError(null);
    try {
      const r = await fetch("/api/keeper/work-lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-call": "1" },
      });
      const d = await r.json() as Record<string, unknown>;
      if (!r.ok) setLcError((d.error as string) ?? `HTTP ${r.status}`);
      else { setLcResult(d); void refresh(); }
    } catch (e) {
      setLcError(e instanceof Error ? e.message : String(e));
    } finally { setLcRunning(false); }
  };

  const activeWorks = works.filter(w =>
    ["PROPOSED","VOTE_OPEN","VOTE_TALLIED","BRIEFING","CREATING","VALIDATING","PUBLISHING"].includes(w.state)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={runLifecycle}
          disabled={lcRunning}
          className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 disabled:cursor-wait"
        >
          {lcRunning ? "En cours…" : "🎨 Déclencher work-lifecycle"}
        </button>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="font-mono text-xs border border-[--border] px-4 py-2.5 hover:bg-[--bg-card] disabled:opacity-40"
        >
          {loading ? "…" : "↻ Rafraîchir"}
        </button>
      </div>

      {lcError && (
        <div className="border border-red-300 bg-red-50/20 px-4 py-3">
          <p className="font-mono text-xs text-red-600">{lcError}</p>
        </div>
      )}

      {lcResult && (
        <div className="border border-green-300 bg-green-50/20 px-4 py-3 space-y-1">
          <p className="font-mono text-xs font-bold text-green-700">
            ✓ {String(lcResult.advanced ?? 0)} / {String(lcResult.processed ?? 0)} œuvres avancées
            {(lcResult.foundingCreated as boolean) && " — ★ Œuvre fondatrice créée !"}
          </p>
          {Array.isArray(lcResult.results) && (lcResult.results as Array<{title: string; from: string; to: string; advanced: boolean}>).map((r, i) => (
            <p key={i} className="font-mono text-xs text-[--fg-muted]">
              {r.advanced ? "→" : "·"} {r.title} : {r.from} → {r.to}
            </p>
          ))}
          {lcResult.message && (
            <p className="font-mono text-xs text-[--fg-muted]">{String(lcResult.message)}</p>
          )}
        </div>
      )}

      {/* Active works */}
      {activeWorks.length > 0 ? (
        <div className="space-y-2">
          <p className="font-mono text-xs text-[--fg-muted]">{activeWorks.length} œuvre(s) active(s)</p>
          {activeWorks.map(w => (
            <div key={w.id} className="border border-[--border] p-4 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <p className="font-bold text-sm">
                  {w.isFoundingWork && "★ "}
                  {w.isBurnMemorial && "⬛ "}
                  {w.title}
                </p>
                <span className={`font-mono text-xs font-bold shrink-0 ${STATE_COLOR[w.state] ?? ""}`}>
                  {w.state}
                </span>
              </div>
              <p className="font-mono text-xs text-[--fg-muted]">
                par {w.proposedByName} · {new Date(w.proposedAt).toLocaleString("fr-FR")}
              </p>
              {w.stateHistory.length > 0 && (
                <p className="font-mono text-xs text-[--fg-muted]">
                  dernière étape : {w.stateHistory[w.stateHistory.length - 1]?.note ?? "—"}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        !loading && <p className="font-mono text-xs text-[--fg-muted]">Aucune œuvre active en cours.</p>
      )}

      {/* Published & rejected */}
      {works.filter(w => w.state === "PUBLISHED" || w.state === "REJECTED").length > 0 && (
        <details className="border border-[--border]">
          <summary className="bg-[--bg-card] px-4 py-3 cursor-pointer font-mono text-xs text-[--fg-muted] hover:bg-[--bg]">
            Historique ({works.filter(w => w.state === "PUBLISHED" || w.state === "REJECTED").length} terminées) →
          </summary>
          <div className="divide-y divide-[--border]">
            {works.filter(w => w.state === "PUBLISHED" || w.state === "REJECTED").map(w => (
              <div key={w.id} className="px-4 py-3 flex items-center justify-between">
                <p className="font-mono text-xs">{w.title}</p>
                <span className={`font-mono text-xs font-bold ${STATE_COLOR[w.state] ?? ""}`}>{w.state}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── BurnCheckSection ─────────────────────────────────────────────────────────

function BurnCheckSection() {
  const [running, setRunning] = useState(false);
  const [result,  setResult]  = useState<Record<string, unknown> | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  const run = async () => {
    setRunning(true); setResult(null); setError(null);
    try {
      const r = await fetch("/api/keeper/check-burns", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-call": "1" },
      });
      const d = await r.json() as Record<string, unknown>;
      if (!r.ok) setError((d.error as string) ?? `HTTP ${r.status}`);
      else setResult(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setRunning(false); }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={run}
        disabled={running}
        className="font-mono text-xs border border-[--border] px-5 py-2.5 hover:bg-[--bg-card] disabled:opacity-40 disabled:cursor-wait"
      >
        {running ? "Vérification…" : "⬛ Vérifier burns Normies"}
      </button>
      {error && <p className="font-mono text-xs text-red-600">{error}</p>}
      {result && (
        <div className="border border-[--border] bg-[--bg-card] px-4 py-3 space-y-1">
          <p className="font-mono text-xs font-bold">
            Supply : {String(result.supply ?? "?")} · Burns : {String(result.burns ?? 0)}
          </p>
          {(result.burns as number) > 0 && (
            <p className="font-mono text-xs text-orange-600">
              ⬛ {String(result.burns)} burn(s) détecté(s) — {String(result.worksCreated ?? 0)} œuvre(s) mémoriale(s) créée(s)
            </p>
          )}
          {result.message && <p className="font-mono text-xs text-[--fg-muted]">{String(result.message)}</p>}
          {result.skipped && <p className="font-mono text-xs text-[--fg-muted]">Ignoré : {String(result.skipped)}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const { writeContractAsync } = useWriteContract();

  // ── Read contract owner ───────────────────────────────────────────────────
  const { data: coreOwner } = useReadContract({
    address: CORE_ADDR, abi: ASSOCIATION_CORE_ABI, functionName: "owner",
    query: { enabled: contractsDeployed },
  });
  const { data: caOwner } = useReadContract({
    address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "owner",
    query: { enabled: contractsDeployed },
  });

  const isCoreOwner = isConnected && address && coreOwner &&
    address.toLowerCase() === (coreOwner as string).toLowerCase();
  const isCaOwner = isConnected && address && caOwner &&
    address.toLowerCase() === (caOwner as string).toLowerCase();

  // ── Read state ────────────────────────────────────────────────────────────
  const { data: memberCount } = useReadContract({
    address: CORE_ADDR, abi: ASSOCIATION_CORE_ABI, functionName: "getMemberCount",
    query: { enabled: contractsDeployed, refetchInterval: 10_000 },
  });
  const { data: relayer } = useReadContract({
    address: CORE_ADDR, abi: ASSOCIATION_CORE_ABI, functionName: "relayerAddress",
    query: { enabled: contractsDeployed },
  });
  const { data: isCAAuthorized } = useReadContract({
    address: CORE_ADDR, abi: ASSOCIATION_CORE_ABI, functionName: "authorizedModules",
    args: [CA_ADDR], query: { enabled: contractsDeployed },
  });
  const { data: sessionRaw } = useReadContract({
    address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "currentSession",
    query: { enabled: contractsDeployed, refetchInterval: 10_000 },
  });
  const session = sessionRaw as unknown as { id: bigint; openedAt: bigint; deadline: bigint; active: boolean; resolved: boolean } | undefined;

  // ── Role holders ──────────────────────────────────────────────────────────
  const { data: memberTokenIds } = useReadContract({
    address: CORE_ADDR, abi: ASSOCIATION_CORE_ABI, functionName: "getMemberTokenIds",
    query: { enabled: contractsDeployed },
  });

  // ── Input state ───────────────────────────────────────────────────────────
  const [moduleInput,  setModuleInput]  = useState<string>(CA_ADDR);
  const [relayerInput, setRelayerInput] = useState("");

  // ── Actions ───────────────────────────────────────────────────────────────
  const execTx = useCallback(async (
    address_: `0x${string}`,
    abi: typeof ASSOCIATION_CORE_ABI | typeof CONSTITUENT_ASSEMBLY_ABI,
    functionName: string,
    args?: unknown[]
  ) => {
    const hash = await writeContractAsync({
      address: address_,
      abi: abi as Parameters<typeof writeContractAsync>[0]["abi"],
      functionName: functionName as never,
      args: (args ?? []) as never,
    });
    router.refresh();
    return hash;
  }, [writeContractAsync, router]);

  // ─────────────────────────────────────────────────────────────────────────

  if (!contractsDeployed) {
    return (
      <>
        <Navbar />
        <main className="pt-28 px-6 max-w-3xl mx-auto">
          <p className="font-mono text-xs text-red-600">
            Contrats non configurés (NEXT_PUBLIC_* manquants dans les env vars).
          </p>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 px-6">
        <div className="max-w-4xl mx-auto space-y-12">

          {/* En-tête */}
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">
              Administration
            </p>
            <h1 className="text-4xl font-bold mb-4">Panneau de contrôle</h1>
            <p className="text-[--fg-muted] leading-relaxed max-w-2xl">
              Interface réservée au propriétaire des contrats. Chaque action est protégée
              on-chain par <code className="bg-[--bg-card] px-1">onlyOwner</code> — un wallet
              non-autorisé verra sa transaction révoquée par le contrat.
            </p>
          </div>

          {/* Connexion wallet */}
          {!isConnected ? (
            <div className="border border-[--border] bg-[--bg-card] p-8 flex flex-col items-center gap-6 text-center">
              <p className="font-bold">Connectez le wallet propriétaire des contrats</p>
              <ConnectButton />
            </div>
          ) : !isCoreOwner && !isCaOwner ? (
            <div className="border border-red-300 bg-red-50/30 px-6 py-5">
              <p className="font-bold text-red-700 mb-1">Accès refusé</p>
              <p className="font-mono text-xs text-red-600">
                Le wallet connecté ({address?.slice(0,6)}…{address?.slice(-4)}) n'est pas
                le propriétaire des contrats. Les boutons ci-dessous seront rejetés par le contrat.
              </p>
            </div>
          ) : (
            <div className="border border-green-300 bg-green-50/30 px-6 py-4">
              <p className="font-mono text-xs text-green-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                Wallet propriétaire connecté — {address?.slice(0,6)}…{address?.slice(-4)}
              </p>
            </div>
          )}

          {/* État des contrats */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold">État des contrats</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* AssociationCore */}
              <div className="border border-[--border] p-5 space-y-0">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-bold text-sm">AssociationCore</p>
                  <a
                    href={basescanAddr(CORE_ADDR)}
                    target="_blank" rel="noopener noreferrer"
                    className="font-mono text-xs text-[--fg-muted] hover:underline"
                  >
                    Basescan ↗
                  </a>
                </div>
                <StatusRow label="Adresse"    value={`${CORE_ADDR.slice(0,10)}…${CORE_ADDR.slice(-6)}`} />
                <StatusRow label="Membres"    value={memberCount !== undefined ? String(memberCount) : "—"} />
                <StatusRow label="Relayer"    value={relayer ? `${(relayer as string).slice(0,10)}…` : "—"} />
                <StatusRow
                  label="CA autorisé"
                  value={isCAAuthorized === true ? "Oui" : isCAAuthorized === false ? "Non" : "—"}
                  ok={isCAAuthorized === true}
                />
              </div>

              {/* ConstituentAssembly */}
              <div className="border border-[--border] p-5 space-y-0">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-bold text-sm">ConstituentAssembly</p>
                  <a
                    href={basescanAddr(CA_ADDR)}
                    target="_blank" rel="noopener noreferrer"
                    className="font-mono text-xs text-[--fg-muted] hover:underline"
                  >
                    Basescan ↗
                  </a>
                </div>
                <StatusRow label="Adresse"   value={`${CA_ADDR.slice(0,10)}…${CA_ADDR.slice(-6)}`} />
                <StatusRow label="Session #" value={session ? String(session.id) : "0"} />
                <StatusRow
                  label="Statut session"
                  value={session?.active ? "Ouverte" : session?.resolved ? "Clôturée" : "En attente"}
                  ok={session?.active}
                />
              </div>
            </div>

            {/* Members list */}
            {Array.isArray(memberTokenIds) && (memberTokenIds as bigint[]).length > 0 && (
              <div className="border border-[--border] p-5">
                <p className="font-mono text-xs text-[--fg-muted] mb-2">
                  Membres inscrits ({(memberTokenIds as bigint[]).length})
                </p>
                <p className="font-mono text-sm">
                  {(memberTokenIds as bigint[]).map(id => `#${id}`).join("  ·  ")}
                </p>
              </div>
            )}
          </section>

          {/* ── Actions AssociationCore ── */}
          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-bold">AssociationCore</h2>
              <p className="font-mono text-xs text-[--fg-muted] mt-1">
                Owner : {coreOwner ? String(coreOwner) : "—"}
              </p>
            </div>

            {/* authorizeModule */}
            <div className="border border-[--border] p-5 space-y-3">
              <div>
                <p className="font-bold text-sm">Autoriser un module</p>
                <p className="font-mono text-xs text-[--fg-muted] mt-0.5 leading-relaxed">
                  Donne à un contrat périphérique le droit d'appeler <code>grantRole()</code>.
                  {isCAAuthorized === false && (
                    <span className="text-orange-600"> ⚠ ConstituentAssembly n'est pas encore autorisé.</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  value={moduleInput}
                  onChange={e => setModuleInput(e.target.value)}
                  placeholder="0x… adresse du module"
                  className="font-mono text-xs border border-[--border] bg-[--bg] px-3 py-2 flex-1 focus:outline-none focus:border-[--fg]"
                />
                <button
                  disabled={!isCoreOwner || !isAddress(moduleInput)}
                  onClick={async () => {
                    await execTx(CORE_ADDR, ASSOCIATION_CORE_ABI, "authorizeModule", [moduleInput as `0x${string}`]);
                  }}
                  className="font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  Autoriser →
                </button>
              </div>
            </div>

            {/* revokeModule */}
            <AdminAction
              label="Révoquer un module"
              description="Retire les droits d'un module périphérique (ex: en cas de bug ou remplacement)."
              danger
              disabled={!isCoreOwner}
              disabledReason="Wallet propriétaire requis"
              onExec={async () => {
                await execTx(CORE_ADDR, ASSOCIATION_CORE_ABI, "revokeModule", [CA_ADDR]);
              }}
            />

            {/* setRelayer */}
            <div className="border border-[--border] p-5 space-y-3">
              <div>
                <p className="font-bold text-sm">Changer le relayer</p>
                <p className="font-mono text-xs text-[--fg-muted] mt-0.5 leading-relaxed">
                  Remplace l'adresse autorisée à signer les attestations EIP-712.
                  À n'utiliser qu'en cas de compromission de la clé.
                  Relayer actuel : <span className="text-[--fg]">{relayer ? String(relayer) : "—"}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  value={relayerInput}
                  onChange={e => setRelayerInput(e.target.value)}
                  placeholder="0x… nouvelle adresse relayer"
                  className="font-mono text-xs border border-[--border] bg-[--bg] px-3 py-2 flex-1 focus:outline-none focus:border-[--fg]"
                />
                <button
                  disabled={!isCoreOwner || !isAddress(relayerInput)}
                  onClick={async () => {
                    await execTx(CORE_ADDR, ASSOCIATION_CORE_ABI, "setRelayer", [relayerInput as `0x${string}`]);
                  }}
                  className="font-mono text-xs border border-red-400 text-red-600 px-4 py-2 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  Mettre à jour
                </button>
              </div>
            </div>
          </section>

          {/* ── Actions ConstituentAssembly ── */}
          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-bold">ConstituentAssembly</h2>
              <p className="font-mono text-xs text-[--fg-muted] mt-1">
                Owner : {caOwner ? String(caOwner) : "—"}
              </p>
            </div>

            {/* Session deadline countdown */}
            {session?.active && session.deadline > 0n && (
              <div className="border border-[--border] bg-[--bg-card] p-3 font-mono text-xs text-[--fg-muted]">
                {(() => {
                  const remaining = Number(session.deadline) - Math.floor(Date.now() / 1000);
                  if (remaining <= 0) return <span className="text-orange-600">⏰ Session expirée — triggerClose() disponible</span>;
                  const m = Math.floor(remaining / 60);
                  const s = remaining % 60;
                  return <span>⏱ Session active — fermeture dans {m}m {s}s</span>;
                })()}
              </div>
            )}

            {/* openSession */}
            <AdminAction
              label="Ouvrir la session de vote (10 min)"
              description={
                session?.active
                  ? "Une session est déjà active — clôturez-la d'abord."
                  : "Démarre la phase de vote pour 10 minutes. triggerClose() disponible après expiration."
              }
              disabled={!isCaOwner || !!session?.active}
              disabledReason={session?.active ? "Session déjà ouverte" : "Wallet propriétaire requis"}
              onExec={async () => {
                await execTx(CA_ADDR, CONSTITUENT_ASSEMBLY_ABI, "openSession", [600n]);
              }}
            />

            {/* Lancer le vote automatique (candidature + votes via LLM) */}
            <AdminAction
              label="🤖 Lancer le vote automatique (LLM + relayer)"
              description="Phase candidature puis vote : chaque Normie choisit ses rôles et vote via son persona LLM. Le relayer soumet les tx."
              disabled={!session?.active}
              disabledReason="Ouvrez une session d'abord"
              onExec={async () => {
                const r1 = await fetch("/api/keeper/auto-vote", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ phase: "candidacy" }),
                });
                const c = await r1.json();
                console.log("[auto-vote] candidacy:", c);
                const r2 = await fetch("/api/keeper/auto-vote", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ phase: "vote", mode: "execute" }),
                });
                const v = await r2.json();
                console.log("[auto-vote] vote:", v);
                if (v.failed?.length) throw new Error(`${v.failed.length} votes failed: ${v.failed[0]}`);
              }}
            />

            {/* closeSession — manuel (owner) */}
            <AdminAction
              label="Clôturer manuellement (owner)"
              description="Ferme le vote avant expiration. Attribue les 6 rôles on-chain."
              danger
              disabled={!isCaOwner || !session?.active || isCAAuthorized === false}
              disabledReason={
                !session?.active ? "Aucune session active" :
                isCAAuthorized === false ? "Module non autorisé dans Core" :
                "Wallet propriétaire requis"
              }
              onExec={async () => {
                await execTx(CA_ADDR, CONSTITUENT_ASSEMBLY_ABI, "closeSession");
              }}
            />

            {/* triggerClose — permissionless après deadline */}
            <AdminAction
              label="⏰ Clôturer après expiration (permissionless)"
              description="Appelle triggerClose() via le relayer — disponible quand la deadline est passée."
              disabled={!session?.active || (session?.deadline ? Number(session.deadline) > Math.floor(Date.now() / 1000) : true)}
              disabledReason="Session non expirée ou inactive"
              onExec={async () => {
                const r = await fetch("/api/keeper/auto-vote", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ phase: "close" }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error ?? "triggerClose failed");
              }}
            />
          </section>

          {/* ── WorkRegistry ── */}
          <WorkRegistrySection
            isOwner={!!isCoreOwner}
            writeContractAsync={writeContractAsync}
            onRefresh={() => router.refresh()}
          />

          {/* ── Auto-vote (test) ── */}
          <section className="space-y-4 border-t border-[--border] pt-10">
            <div>
              <h2 className="text-xl font-bold">Auto-vote (simulation LLM)</h2>
              <p className="font-mono text-xs text-[--fg-muted] mt-1">
                Simule les votes de tous les Normies membres via leurs personas LLM.
                Mode <code>simulate</code> : génère les décisions sans soumettre de transaction.
              </p>
            </div>
            <AutoVoteSection sessionActive={session?.active ?? false} />
          </section>

          {/* ── Work lifecycle + status ── */}
          <section className="space-y-4 border-t border-[--border] pt-10">
            <div>
              <h2 className="text-xl font-bold">Work Lifecycle</h2>
              <p className="font-mono text-xs text-[--fg-muted] mt-1">
                Avance toutes les œuvres actives d'un état. Crée l'œuvre fondatrice si les 6 rôles sont élus.
              </p>
            </div>
            <WorkStatusSection />
          </section>

          {/* ── Burns Normies ── */}
          <section className="space-y-4 border-t border-[--border] pt-10">
            <div>
              <h2 className="text-xl font-bold">Burns Normies</h2>
              <p className="font-mono text-xs text-[--fg-muted] mt-1">
                Compare la supply actuelle des Normies NFT (Ethereum mainnet) à la dernière valeur enregistrée.
                Si un burn est détecté, crée automatiquement une œuvre mémoriale.
              </p>
            </div>
            <BurnCheckSection />
          </section>

          {/* ── Salon exchange keeper ── */}
          <section className="space-y-6 border-t border-[--border] pt-10">
            <div>
              <h2 className="text-xl font-bold mb-1">Échanges automatiques — Salon</h2>
              <p className="text-sm text-[--fg-muted]">
                Déclenche une prise de parole autonome des Normies dans les salons ouverts (Agora + salons privés).
                Chaque Normie est limité à 4 messages/heure. Appeler toutes les 15-20 min max.
              </p>
            </div>
            <SalonExchangeSection />
          </section>

          {/* ── Documentation du flow ── */}
          <section className="space-y-6 border-t border-[--border] pt-10">
            <h2 className="text-xl font-bold">Déroulement de l'assemblée constituante</h2>

            <div className="space-y-0">
              {[
                {
                  n: "01",
                  phase: "Déploiement (terminé)",
                  done: true,
                  steps: [
                    "AssociationCore déployé avec l'adresse du relayer",
                    "ConstituentAssembly déployé avec l'adresse de Core",
                    "authorizeModule(CA) appelé sur Core → CA peut appeler grantRole()",
                    "FactoryRegistry déployé",
                  ],
                },
                {
                  n: "02",
                  phase: "Phase d'inscription (ouverte maintenant)",
                  done: false,
                  steps: [
                    "Tout détenteur de Normie se connecte sur /register",
                    "Le relayer vérifie ownerOf(tokenId) sur Ethereum mainnet",
                    "Le relayer signe une attestation EIP-712 (nonce + deadline)",
                    "register(attestation, sig) est appelé sur Base — membre permanent",
                  ],
                },
                {
                  n: "03",
                  phase: "Phase de vote (owner ouvre la session)",
                  done: false,
                  steps: [
                    "Owner appelle openSession() sur ConstituentAssembly",
                    "Chaque membre vote pour chacun des 6 rôles via castVote()",
                    "Un Normie = 1 voix par rôle, voter = le membre enregistré au snapshot",
                    "Votes visibles en temps réel sur /assembly",
                  ],
                },
                {
                  n: "04",
                  phase: "Résolution (owner clôture)",
                  done: false,
                  steps: [
                    "Owner appelle closeSession() sur ConstituentAssembly",
                    "Le contrat calcule le leader de chaque rôle (plus de votes, sinon tokenId le plus bas)",
                    "grantRole() appelé sur Core pour chaque rôle — 6 rôles attribués atomiquement",
                    "Rôles visibles sur /members et /assembly",
                  ],
                },
                {
                  n: "05",
                  phase: "Phase créative (après résolution)",
                  done: false,
                  steps: [
                    "Les rôles AUTHOR, CURATOR, RAPPORTEUR peuvent publier via WorkRegistry",
                    "publish(dataUri, authorId, curatorId, rapporteurId) — dataUri = data:text/html;base64,...",
                    "Chaque œuvre est permanente et vérifiable on-chain",
                  ],
                },
              ].map((item) => (
                <div key={item.n} className="grid grid-cols-[64px_1fr] gap-6 py-6 border-b border-[--border] last:border-none">
                  <div className="text-right">
                    <span className={`font-mono text-xs px-2 py-0.5 ${
                      item.done
                        ? "bg-green-100 text-green-700 border border-green-300"
                        : "bg-[--bg-card] text-[--fg-muted] border border-[--border]"
                    }`}>
                      {item.done ? "✓" : item.n}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <p className="font-bold">{item.phase}</p>
                    <ul className="space-y-1">
                      {item.steps.map((s, i) => (
                        <li key={i} className="font-mono text-xs text-[--fg-muted] flex gap-2">
                          <span className="shrink-0">→</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Adresses ── */}
          <section className="space-y-3 border-t border-[--border] pt-8">
            <h2 className="text-xl font-bold">Adresses de déploiement (Base mainnet)</h2>
            <div className="space-y-2">
              {[
                { name: "AssociationCore",     addr: CORE_ADDR },
                { name: "ConstituentAssembly", addr: CA_ADDR   },
                { name: "FactoryRegistry",     addr: CONTRACT_ADDRESSES.FactoryRegistry },
              ].map(c => (
                <div key={c.name} className="flex items-center justify-between border border-[--border] bg-[--bg-card] px-4 py-3">
                  <p className="font-mono text-xs font-bold">{c.name}</p>
                  <a
                    href={basescanAddr(c.addr)}
                    target="_blank" rel="noopener noreferrer"
                    className="font-mono text-xs text-[--fg-muted] hover:underline break-all"
                  >
                    {c.addr} ↗
                  </a>
                </div>
              ))}
            </div>
          </section>

        </div>
      </main>
      <Footer />
    </>
  );
}
