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
  ANA_COLLECTION_FACTORY_ABI,
  CONTRACT_ADDRESSES,
  ROLES,
  ROLE_LABELS,
} from "@/lib/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────

const CORE_ADDR    = CONTRACT_ADDRESSES.AssociationCore       as `0x${string}`;
const CA_ADDR      = CONTRACT_ADDRESSES.ConstituentAssembly   as `0x${string}`;
const WR_ADDR      = CONTRACT_ADDRESSES.WorkRegistry          as `0x${string}`;
const FACTORY_ADDR = CONTRACT_ADDRESSES.ANACollectionFactory  as `0x${string}`;
const contractsDeployed = !!CONTRACT_ADDRESSES.AssociationCore;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function basescanTx(hash: string) {
  return `https://basescan.org/tx/${hash}`;
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000)     return "à l'instant";
  if (d < 3_600_000)  return `il y a ${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `il y a ${Math.floor(d / 3_600_000)} h`;
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
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

type PipelineStep = "idle" | "tx_pending" | "tx_confirming" | "proposing" | "lifecycle" | "done" | "error";

function WorkRegistrySection({
  isOwner,
  writeContractAsync,
  onRefresh,
}: {
  isOwner: boolean;
  writeContractAsync: ReturnType<typeof useWriteContract>["writeContractAsync"];
  onRefresh: () => void;
}) {
  const [txHash,    setTxHash]    = useState<`0x${string}` | null>(null);
  const [schedTx,   setSchedTx]   = useState<`0x${string}` | null>(null);
  const [schedState, setSchedState] = useState<"idle"|"pending"|"confirming"|"done"|"error">("idle");
  const [schedErr,   setSchedErr]   = useState<string | null>(null);

  // Full pipeline state for "Initier une session"
  const [pipeStep,    setPipeStep]    = useState<PipelineStep>("idle");
  const [pipeErr,     setPipeErr]     = useState<string | null>(null);
  const [pipeWork,    setPipeWork]    = useState<{ title: string; proposedBy: string } | null>(null);
  const [pipeLC,      setPipeLC]      = useState<{ advanced: number; processed: number } | null>(null);

  // Schedule config inputs
  const [periodDays,     setPeriodDays]     = useState("30");
  const [nextDateStr,    setNextDateStr]    = useState("");
  const [scheduleActive, setScheduleActive] = useState(true);

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash ?? undefined });
  const { isSuccess: schedConfirmed } = useWaitForTransactionReceipt({ hash: schedTx ?? undefined });

  // Pipeline: after initiateWorkSession tx confirms → propose-work → work-lifecycle
  useEffect(() => {
    if (!txConfirmed || pipeStep !== "tx_confirming") return;

    async function runPipeline() {
      setPipeStep("proposing");
      try {
        const r1 = await fetch("/api/keeper/propose-work", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-call": "1" },
        });
        const d1 = await r1.json() as { work?: { title: string; proposedBy: string }; error?: string };
        if (!r1.ok) throw new Error(d1.error ?? `HTTP ${r1.status}`);
        setPipeWork(d1.work ?? null);

        setPipeStep("lifecycle");
        const r2 = await fetch("/api/keeper/work-lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-call": "1" },
        });
        const d2 = await r2.json() as { advanced?: number; processed?: number; error?: string };
        if (!r2.ok) throw new Error(d2.error ?? `HTTP ${r2.status}`);
        setPipeLC({ advanced: d2.advanced ?? 0, processed: d2.processed ?? 0 });

        setPipeStep("done");
        onRefresh();
      } catch (e) {
        setPipeErr(e instanceof Error ? e.message : String(e));
        setPipeStep("error");
      }
    }

    void runPipeline();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txConfirmed]);

  // Schedule tx confirmation
  useEffect(() => {
    if (schedConfirmed && schedState === "confirming") {
      setSchedState("done");
      onRefresh();
      const t = setTimeout(() => setSchedState("idle"), 3000);
      return () => clearTimeout(t);
    }
  }, [schedConfirmed, schedState, onRefresh]);

  const { data: scheduleRaw } = useReadContract({
    address: WR_ADDR, abi: WORK_REGISTRY_ABI, functionName: "getSchedule",
    query: { enabled: !!WR_ADDR, refetchInterval: 10_000 },
  });
  const schedule = scheduleRaw as { nextCreationAt: bigint; periodSeconds: bigint; active: boolean } | undefined;

  const { data: sessionCountRaw } = useReadContract({
    address: WR_ADDR, abi: WORK_REGISTRY_ABI, functionName: "sessionCount",
    query: { enabled: !!WR_ADDR, refetchInterval: 5_000 },
  });
  const sessionCount = sessionCountRaw !== undefined ? Number(sessionCountRaw) : 0;

  const initiate = async () => {
    setPipeErr(null);
    setPipeWork(null);
    setPipeLC(null);
    setPipeStep("tx_pending");
    try {
      const hash = await writeContractAsync({
        address:      WR_ADDR,
        abi:          WORK_REGISTRY_ABI as Parameters<typeof writeContractAsync>[0]["abi"],
        functionName: "initiateWorkSession" as never,
        args:         [] as never,
      });
      setTxHash(hash);
      setPipeStep("tx_confirming");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPipeErr(msg.includes("rejected") ? "Transaction annulée" : msg.slice(0, 150));
      setPipeStep("error");
    }
  };

  const execSchedule = async () => {
    setSchedErr(null);
    setSchedState("pending");
    try {
      const hash = await writeContractAsync({
        address:      WR_ADDR,
        abi:          WORK_REGISTRY_ABI as Parameters<typeof writeContractAsync>[0]["abi"],
        functionName: "setSchedule" as never,
        args:         [BigInt(nextTs), BigInt(periodSecs), scheduleActive] as never,
      });
      setSchedTx(hash);
      setSchedState("confirming");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSchedErr(msg.includes("rejected") ? "Transaction annulée" : msg.slice(0, 150));
      setSchedState("error");
    }
  };

  const pipeBusy = pipeStep === "tx_pending" || pipeStep === "tx_confirming" || pipeStep === "proposing" || pipeStep === "lifecycle";

  const PIPE_LABEL: Record<PipelineStep, string> = {
    idle:          "Initier + proposer →",
    tx_pending:    "Signature wallet…",
    tx_confirming: "Confirmation on-chain…",
    proposing:     "LLM génère la proposition…",
    lifecycle:     "Ouverture du vote + salon…",
    done:          "✓ Œuvre proposée et vote ouvert",
    error:         "Erreur — réessayer",
  };

  const nextTs    = nextDateStr ? Math.floor(new Date(nextDateStr).getTime() / 1000) : Math.floor(Date.now() / 1000);
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

      {/* Initier + pipeline complet */}
      <div className="border border-[--border] p-5 space-y-4">
        <div>
          <p className="font-bold text-sm">Initier une session de création</p>
          <p className="font-mono text-xs text-[--fg-muted] mt-0.5 leading-relaxed">
            Enregistre la session on-chain, puis un Normie propose automatiquement un sujet via LLM,
            et le vote est ouvert avec un salon dédié.
          </p>
        </div>

        {/* Steps tracker */}
        <div className="flex items-center gap-0">
          {[
            { key: "tx",      label: "Tx" },
            { key: "propose", label: "Sujet" },
            { key: "vote",    label: "Vote + Salon" },
          ].map((s, i) => {
            const done = pipeStep === "done" || (i === 0 && ["tx_confirming","proposing","lifecycle","done"].includes(pipeStep))
                      || (i === 1 && ["lifecycle","done"].includes(pipeStep));
            const active = (i === 0 && ["tx_pending","tx_confirming"].includes(pipeStep))
                        || (i === 1 && pipeStep === "proposing")
                        || (i === 2 && pipeStep === "lifecycle");
            return (
              <div key={s.key} className="flex items-center">
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center font-mono text-[9px] transition-colors ${
                  done   ? "bg-green-500 border-green-500 text-white" :
                  active ? "border-[--fg] text-[--fg] animate-pulse" :
                           "border-[--border] text-[--fg-muted]"
                }`}>
                  {done ? "✓" : i + 1}
                </div>
                <p className={`font-mono text-[9px] ml-1 mr-3 ${active ? "text-[--fg]" : "text-[--fg-muted]"}`}>{s.label}</p>
                {i < 2 && <div className={`w-6 h-px mr-3 ${done ? "bg-green-500" : "bg-[--border]"}`} />}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={pipeStep === "done" || pipeStep === "error" ? () => { setPipeStep("idle"); setPipeErr(null); } : initiate}
            disabled={pipeBusy || !isOwner}
            className={`font-mono text-xs px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
              pipeStep === "done"
                ? "bg-green-100 text-green-700 border border-green-300"
                : pipeStep === "error"
                ? "border border-red-400 text-red-600 hover:bg-red-50"
                : "bg-[--fg] text-[--bg] hover:opacity-80"
            }`}
          >
            {pipeBusy ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border border-[--bg] border-t-transparent rounded-full animate-spin inline-block" />
                {PIPE_LABEL[pipeStep]}
              </span>
            ) : pipeStep === "done" || pipeStep === "error" ? PIPE_LABEL[pipeStep] : PIPE_LABEL["idle"]}
          </button>
          {pipeErr && <p className="font-mono text-xs text-red-600">{pipeErr}</p>}
        </div>

        {txHash && (
          <a href={basescanTx(txHash)} target="_blank" rel="noopener noreferrer"
            className="font-mono text-xs text-[--fg-muted] underline">
            tx: {txHash.slice(0, 16)}… ↗
          </a>
        )}

        {pipeWork && (
          <div className="border border-green-300 bg-green-50/10 px-4 py-3 space-y-1">
            <p className="font-mono text-xs font-bold text-green-700">
              Œuvre proposée par {pipeWork.proposedBy}
            </p>
            <p className="font-mono text-xs text-[--fg-muted]">« {pipeWork.title} »</p>
          </div>
        )}

        {pipeLC && (
          <p className="font-mono text-xs text-[--fg-muted]">
            Lifecycle : {pipeLC.advanced}/{pipeLC.processed} œuvre(s) avancée(s) — salon ouvert
          </p>
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
        <div className="flex items-center gap-3">
          <button
            onClick={execSchedule}
            disabled={schedState === "pending" || schedState === "confirming" || !isOwner}
            className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {schedState === "pending" || schedState === "confirming" ? "En cours…" : schedState === "done" ? "✓ Calendrier enregistré" : "Enregistrer le calendrier →"}
          </button>
          {schedErr && <p className="font-mono text-xs text-red-600">{schedErr}</p>}
        </div>
        {schedTx && (
          <a href={basescanTx(schedTx)} target="_blank" rel="noopener noreferrer"
            className="font-mono text-xs text-[--fg-muted] underline">
            tx: {schedTx.slice(0, 16)}… ↗
          </a>
        )}
      </div>
    </section>
  );
}

// ─── SalonExchangeSection ────────────────────────────────────────────────────

function SalonExchangeSection() {
  const [running, setRunning]   = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result,  setResult]    = useState<Record<string, unknown> | null>(null);
  const [error,   setError]     = useState<string | null>(null);

  const run = async (salonId?: string) => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res  = await fetch("/api/keeper/salon-exchange", {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-admin-call": "1" },
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

  const resetSalon = async () => {
    if (!confirm("Vider tous les échanges du salon Agora ? Les Normies repartiront de zéro.")) return;
    setResetting(true);
    setError(null);
    try {
      const res  = await fetch("/api/keeper/reset-salon", {
        method:  "POST",
        headers: { "x-admin-call": "1" },
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) setError((data.error as string) ?? "Erreur reset");
      else setResult({ reset: true, message: data.message });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => run()}
          disabled={running || resetting}
          className="font-mono text-xs border border-[--fg] bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {running ? "Échanges en cours…" : "Déclencher échanges (tous salons)"}
        </button>
        <button
          onClick={() => run("salon_agora_ana")}
          disabled={running || resetting}
          className="font-mono text-xs border border-[--border] px-5 py-2.5 hover:bg-[--bg-card] disabled:opacity-40 transition-colors"
        >
          Agora seulement
        </button>
        <button
          onClick={resetSalon}
          disabled={running || resetting}
          className="font-mono text-xs border border-red-400 text-red-600 px-5 py-2.5 hover:bg-red-50 disabled:opacity-40 transition-colors"
        >
          {resetting ? "Réinitialisation…" : "🗑 Vider l'Agora"}
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

// ─── CollectionFactorySection ────────────────────────────────────────────────

function CollectionFactorySection({
  isOwner,
  writeContractAsync,
}: {
  isOwner: boolean;
  writeContractAsync: ReturnType<typeof useWriteContract>["writeContractAsync"];
}) {
  const [authorizeAddr, setAuthorizeAddr] = useState("");
  const [authState, setAuthState]         = useState<"idle"|"pending"|"done"|"error">("idle");
  const [authErr,   setAuthErr]           = useState<string | null>(null);
  const [authTx,    setAuthTx]            = useState<string | null>(null);

  const { data: factoryOwner } = useReadContract({
    address: FACTORY_ADDR, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "owner",
    query: { enabled: !!FACTORY_ADDR },
  });
  const { data: assocAddr } = useReadContract({
    address: FACTORY_ADDR, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "associationAddr",
    query: { enabled: !!FACTORY_ADDR },
  });
  const { data: platformAddr } = useReadContract({
    address: FACTORY_ADDR, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "platformAddr",
    query: { enabled: !!FACTORY_ADDR },
  });
  const { data: defaultAuthorPct } = useReadContract({
    address: FACTORY_ADDR, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "defaultAuthorPct",
    query: { enabled: !!FACTORY_ADDR },
  });
  const { data: defaultCuratorPct } = useReadContract({
    address: FACTORY_ADDR, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "defaultCuratorPct",
    query: { enabled: !!FACTORY_ADDR },
  });
  const { data: defaultRapporteurPct } = useReadContract({
    address: FACTORY_ADDR, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "defaultRapporteurPct",
    query: { enabled: !!FACTORY_ADDR },
  });
  const { data: allCollections } = useReadContract({
    address: FACTORY_ADDR, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "getAllCollections",
    query: { enabled: !!FACTORY_ADDR, refetchInterval: 10_000 },
  });

  const relayerFromEnv = process.env.NEXT_PUBLIC_RELAYER_ADDRESS ?? "";

  const authorizeRelayer = async () => {
    const addr = authorizeAddr.trim() || relayerFromEnv;
    if (!isAddress(addr)) { setAuthErr("Adresse invalide"); return; }
    setAuthState("pending"); setAuthErr(null); setAuthTx(null);
    try {
      const hash = await writeContractAsync({
        address:      FACTORY_ADDR,
        abi:          ANA_COLLECTION_FACTORY_ABI as Parameters<typeof writeContractAsync>[0]["abi"],
        functionName: "setAuthorized" as never,
        args:         [addr as `0x${string}`, true] as never,
      });
      setAuthTx(hash);
      setAuthState("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAuthErr(msg.includes("rejected") ? "Transaction annulée" : msg.slice(0, 150));
      setAuthState("error");
    }
  };

  const collections = (allCollections as `0x${string}`[] | undefined) ?? [];

  return (
    <section className="space-y-4 border-t border-[--border] pt-10">
      <div>
        <h2 className="text-xl font-bold">ANACollectionFactory</h2>
        <p className="font-mono text-xs text-[--fg-muted] mt-1">
          Factory ERC-721 pour les éditions d'œuvres. Le relayer doit être dans{" "}
          <code>authorized</code> pour appeler <code>createCollection()</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-[--border] p-5 space-y-0">
          <div className="flex items-center justify-between mb-3">
            <p className="font-bold text-sm">ANACollectionFactory</p>
            <a href={basescanAddr(FACTORY_ADDR)} target="_blank" rel="noopener noreferrer"
              className="font-mono text-xs text-[--fg-muted] hover:underline">Basescan ↗</a>
          </div>
          <StatusRow label="Adresse"        value={`${FACTORY_ADDR.slice(0,10)}…${FACTORY_ADDR.slice(-6)}`} />
          <StatusRow label="Owner"          value={factoryOwner ? `${(factoryOwner as string).slice(0,10)}…` : "—"} />
          <StatusRow label="AssociationAddr" value={assocAddr   ? `${(assocAddr   as string).slice(0,10)}…` : "—"} />
          <StatusRow label="PlatformAddr"   value={platformAddr ? `${(platformAddr as string).slice(0,10)}…` : "—"} />
          <StatusRow
            label="Répartition défaut"
            value={
              defaultAuthorPct != null
                ? `Auteur ${String(defaultAuthorPct)}% · Curateur ${String(defaultCuratorPct)}% · Rapporteur ${String(defaultRapporteurPct)}%`
                : "—"
            }
          />
          <StatusRow label="Collections créées" value={String(collections.length)} ok={collections.length > 0} />
        </div>

        <div className="border border-[--border] p-5 space-y-3">
          <p className="font-bold text-sm">Autoriser le relayer</p>
          <p className="font-mono text-xs text-[--fg-muted] leading-relaxed">
            Donne le droit à une adresse d'appeler <code>createCollection()</code>.
            Le relayer est autorisé à la création — nécessaire seulement si l'adresse a changé.
          </p>
          <div className="flex gap-2">
            <input
              value={authorizeAddr}
              onChange={e => setAuthorizeAddr(e.target.value)}
              placeholder={relayerFromEnv || "0x… adresse du relayer"}
              className="font-mono text-xs border border-[--border] bg-[--bg] px-3 py-2 flex-1 focus:outline-none focus:border-[--fg]"
            />
            <button
              onClick={authorizeRelayer}
              disabled={!isOwner || authState === "pending"}
              className="font-mono text-xs bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {authState === "pending" ? "En cours…" : authState === "done" ? "✓ Autorisé" : "Autoriser →"}
            </button>
          </div>
          {authErr && <p className="font-mono text-xs text-red-600">{authErr}</p>}
          {authTx && (
            <a href={basescanTx(authTx)} target="_blank" rel="noopener noreferrer"
              className="font-mono text-xs text-[--fg-muted] underline">
              tx: {authTx.slice(0, 16)}… ↗
            </a>
          )}
        </div>
      </div>

      {collections.length > 0 && (
        <details className="border border-[--border]">
          <summary className="bg-[--bg-card] px-4 py-3 cursor-pointer font-mono text-xs text-[--fg-muted] hover:bg-[--bg]">
            {collections.length} collection(s) déployée(s) →
          </summary>
          <div className="divide-y divide-[--border] max-h-64 overflow-y-auto">
            {collections.map((addr, i) => (
              <div key={addr} className="px-4 py-2.5 flex items-center justify-between">
                <span className="font-mono text-xs text-[--fg-muted]">#{i + 1}</span>
                <a href={basescanAddr(addr)} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs hover:underline break-all">
                  {addr} ↗
                </a>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// ─── WorkStatusSection ────────────────────────────────────────────────────────

type ANAWorkSummary = {
  id: string; title: string; state: string; isFoundingWork?: boolean; isBurnMemorial?: boolean;
  proposedByName: string; proposedAt: number; stateHistory: Array<{ state: string; at: number; note?: string }>;
};

type ANAWorkFull = ANAWorkSummary & {
  proposal?: string;
  brief?: string;
  artworkText?: string;
  artForm?: string;
  editionPrice?: string;
  editionSupply?: number;
  validationNote?: string;
  txHash?: string;
  onChainWorkId?: number;
  collectionAddress?: string;
  publishedAt?: number;
  revisionCount?: number;
  rapporteurName?: string;
  authorName?: string;
  curatorName?: string;
  rapporteurTokenId?: number;
  authorTokenId?: number;
  curatorTokenId?: number;
  votes?: Array<{ tokenId: number; name: string; vote: string; reason: string }>;
  yesCount?: number;
  noCount?: number;
  absCount?: number;
  voteResult?: string;
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
  const [works,   setWorks]   = useState<ANAWorkFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [lcResult, setLcResult] = useState<Record<string, unknown> | null>(null);
  const [lcError,  setLcError]  = useState<string | null>(null);
  const [lcRunning, setLcRunning] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/works?fresh=1");
      if (r.ok) setWorks(await r.json() as ANAWorkFull[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const forceReject = async (workId: string) => {
    if (!confirm("Forcer REJECTED sur cette œuvre ? Elle sera archivée et la pipeline sera libérée.")) return;
    setRejectingId(workId);
    try {
      const r = await fetch("/api/keeper/work-lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-call": "1" },
        body: JSON.stringify({ forceReject: workId }),
      });
      const d = await r.json() as Record<string, unknown>;
      if (!r.ok) alert((d.error as string) ?? `HTTP ${r.status}`);
      else { void refresh(); } // /api/works?fresh=1 bypasses cache — no propagation delay needed
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally { setRejectingId(null); }
  };

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

  type LcWorkResult = { id: string; title: string; from: string; to: string; advanced: boolean; error?: string };
  const lcResults = (Array.isArray(lcResult?.results) ? lcResult!.results : []) as LcWorkResult[];

  const activeWorks = works.filter(w =>
    ["PROPOSED","VOTE_OPEN","VOTE_TALLIED","BRIEFING","CREATING","VALIDATING","PUBLISHING"].includes(w.state)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
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
        <div className={`border px-4 py-3 space-y-1.5 ${lcResults.some(r => !r.advanced) ? "border-orange-300 bg-orange-50/10" : "border-green-300 bg-green-50/20"}`}>
          <p className="font-mono text-xs font-bold text-green-700">
            ✓ {String(lcResult.advanced ?? 0)} / {String(lcResult.processed ?? 0)} œuvres avancées
            {(lcResult.foundingCreated as boolean) && " — ★ Œuvre fondatrice créée !"}
          </p>
          {lcResults.map((r, i) => (
            <div key={i} className="space-y-0.5">
              <p className={`font-mono text-xs ${r.advanced ? "text-green-700" : "text-orange-600"}`}>
                {r.advanced ? "✓" : "✗"} {r.title} : {r.from} → {r.to}
              </p>
              {r.error && (
                <p className="font-mono text-[10px] text-red-600 pl-3 leading-relaxed">{r.error}</p>
              )}
            </div>
          ))}
          {typeof lcResult.message === "string" && (
            <p className="font-mono text-xs text-[--fg-muted]">{lcResult.message}</p>
          )}
        </div>
      )}

      {/* Active works */}
      {activeWorks.length > 0 ? (
        <div className="space-y-2">
          <p className="font-mono text-xs text-[--fg-muted]">{activeWorks.length} œuvre(s) active(s)</p>
          {activeWorks.map(w => (
            <div key={w.id} className={`border p-4 space-y-1.5 ${w.state === "PUBLISHING" && w.validationNote ? "border-orange-300" : "border-[--border]"}`}>
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
                par {w.proposedByName} · {timeAgo(w.proposedAt)}
              </p>
              {w.stateHistory.length > 0 && (
                <p className="font-mono text-xs text-[--fg-muted]">
                  dernière étape : {w.stateHistory[w.stateHistory.length - 1]?.note ?? "—"}
                </p>
              )}
              {/* Debug panel for stuck PUBLISHING works */}
              {w.state === "PUBLISHING" && (
                <div className="border border-orange-200 bg-orange-50/10 px-3 py-2 space-y-1 mt-1">
                  <p className="font-mono text-[10px] text-orange-600 uppercase tracking-wider font-bold">Publication on-chain — debug</p>
                  {w.validationNote && (
                    <p className="font-mono text-xs text-red-600">⚠ {w.validationNote}</p>
                  )}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <p className="font-mono text-[10px] text-[--fg-muted]">
                      collectionAddr : {w.collectionAddress
                        ? <a href={basescanAddr(w.collectionAddress)} target="_blank" rel="noopener noreferrer" className="text-teal-600 underline">{w.collectionAddress.slice(0,10)}… ↗</a>
                        : <span className="text-red-500">non déployée</span>}
                    </p>
                    <p className="font-mono text-[10px] text-[--fg-muted]">
                      onChainWorkId : {w.onChainWorkId != null
                        ? <span className="text-green-600">#{w.onChainWorkId}</span>
                        : <span className="text-orange-500">non publié</span>}
                    </p>
                    <p className="font-mono text-[10px] text-[--fg-muted]">
                      editionSupply : {w.editionSupply ?? <span className="text-red-500">non défini</span>}
                    </p>
                    <p className="font-mono text-[10px] text-[--fg-muted]">
                      editionPrice : {w.editionPrice ? `${w.editionPrice} ETH` : <span className="text-red-500">non défini</span>}
                    </p>
                  </div>
                  {w.txHash && (
                    <a href={basescanTx(w.txHash)} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-[10px] text-green-600 underline block">
                      WorkRegistry tx : {w.txHash.slice(0,18)}… ↗
                    </a>
                  )}
                  {!w.validationNote && (
                    <p className="font-mono text-[10px] text-[--fg-muted]">
                      Aucune erreur enregistrée — déclencher le lifecycle pour voir l'erreur exacte.
                    </p>
                  )}
                  <button
                    onClick={() => void forceReject(w.id)}
                    disabled={rejectingId === w.id}
                    className="font-mono text-[10px] text-red-600 border border-red-300 px-2 py-1 hover:bg-red-50/20 disabled:opacity-40 mt-1"
                  >
                    {rejectingId === w.id ? "…" : "⛔ Forcer REJECTED — libérer la pipeline"}
                  </button>
                </div>
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

// ─── WorkTestPipelineSection ─────────────────────────────────────────────────

type StepLog = {
  stepNum:  number;
  phase:    string;
  from:     string;
  to:       string;
  advanced: boolean;
  error?:   string;
  elapsed:  number;
  snapshot: Partial<ANAWorkFull>;
};

const STATE_ORDER: string[] = [
  "PROPOSED","VOTE_OPEN","VOTE_TALLIED","BRIEFING","CREATING","VALIDATING","PUBLISHING","PUBLISHED",
];

function WorkTestPipelineSection() {
  const [running,    setRunning]    = useState(false);
  const [logs,       setLogs]       = useState<StepLog[]>([]);
  const [work,       setWork]       = useState<ANAWorkFull | null>(null);
  const [phase,      setPhase]      = useState("");
  const [expanded,   setExpanded]   = useState<number | null>(null);
  const [finalState, setFinalState] = useState<"none"|"published"|"rejected"|"error">("none");
  const [resetting,  setResetting]  = useState(false);

  const fetchWork = useCallback(async (id: string): Promise<ANAWorkFull | null> => {
    const r = await fetch("/api/works?fresh=1");
    if (!r.ok) return null;
    const all = await r.json() as ANAWorkFull[];
    return all.find(w => w.id === id) ?? null;
  }, []);

  const appendLog = useCallback((log: StepLog) => {
    setLogs(prev => [...prev, log]);
  }, []);

  const runPipeline = async () => {
    setRunning(true);
    setLogs([]);
    setWork(null);
    setPhase("");
    setFinalState("none");
    setExpanded(null);

    try {
      // ── 1. Propose a work ──────────────────────────────────────────────────
      setPhase("Proposition en cours (LLM)…");
      const t0 = Date.now();
      const r1 = await fetch("/api/keeper/propose-work", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-call": "1" },
      });
      const d1 = await r1.json() as { work?: { id: string; title: string; proposedBy: string; state: string }; error?: string };
      if (!r1.ok || !d1.work?.id) throw new Error(d1.error ?? "propose-work failed");
      const workId = d1.work.id;

      const proposed = await fetchWork(workId);
      setWork(proposed);
      appendLog({
        stepNum: 0, phase: "Proposition", from: "—", to: "PROPOSED",
        advanced: true, elapsed: Date.now() - t0,
        snapshot: { title: proposed?.title, proposal: proposed?.proposal, proposedByName: proposed?.proposedByName },
      });

      // ── 2. Auto-advance until PUBLISHED / REJECTED / error ────────────────
      let currentState = "PROPOSED";
      let stepNum = 1;
      const MAX_STEPS = 14;

      while (stepNum <= MAX_STEPS && !["PUBLISHED","REJECTED"].includes(currentState)) {
        const stepLabel = {
          PROPOSED:     "Ouverture du vote (+ salon dédié)",
          VOTE_OPEN:    "Votes LLM (tous les membres)",
          VOTE_TALLIED: "Dépouillement + attribution rôles",
          BRIEFING:     "Brief rapporteur (LLM)",
          CREATING:     "Création de l'œuvre (LLM)",
          VALIDATING:   "Validation curateur (LLM)",
          PUBLISHING:   "Publication on-chain (Base tx)",
        }[currentState] ?? currentState;

        setPhase(`Étape ${stepNum} — ${stepLabel}…`);
        const tStep = Date.now();

        const r = await fetch("/api/keeper/work-lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-call": "1" },
        });
        const d = await r.json() as {
          results?: Array<{ id: string; from: string; to: string; advanced: boolean; error?: string }>;
          error?: string;
        };

        if (!r.ok) throw new Error(d.error ?? `lifecycle HTTP ${r.status}`);

        const wResult = d.results?.find(rr => rr.id === workId);
        const newState = wResult?.to ?? currentState;
        const advanced = wResult?.advanced ?? false;
        const lcError  = wResult?.error;

        const fresh = await fetchWork(workId);
        if (fresh) setWork(fresh);

        appendLog({
          stepNum, phase: stepLabel,
          from: wResult?.from ?? currentState, to: newState,
          advanced, elapsed: Date.now() - tStep,
          error: lcError,
          snapshot: {
            votes:            fresh?.votes,
            yesCount:         fresh?.yesCount,
            noCount:          fresh?.noCount,
            absCount:         fresh?.absCount,
            voteResult:       fresh?.voteResult,
            rapporteurName:   fresh?.rapporteurName,
            authorName:       fresh?.authorName,
            curatorName:      fresh?.curatorName,
            brief:            fresh?.brief,
            artForm:          fresh?.artForm,
            editionPrice:     fresh?.editionPrice,
            editionSupply:    fresh?.editionSupply,
            artworkText:      fresh?.artworkText,
            validationNote:   fresh?.validationNote,
            revisionCount:    fresh?.revisionCount,
            txHash:           fresh?.txHash,
            onChainWorkId:    fresh?.onChainWorkId,
            collectionAddress: fresh?.collectionAddress,
            publishedAt:      fresh?.publishedAt,
          },
        });

        if (lcError && !advanced) {
          setFinalState("error");
          setPhase(`Erreur à l'étape ${stepNum} (${currentState})`);
          break;
        }

        currentState = newState;
        stepNum++;

        // Small pause between steps so Neon has time to settle
        if (!["PUBLISHED","REJECTED"].includes(currentState)) {
          await new Promise(res => setTimeout(res, 800));
        }
      }

      if (currentState === "PUBLISHED") { setFinalState("published"); setPhase("✓ Œuvre publiée on-chain !"); }
      else if (currentState === "REJECTED") { setFinalState("rejected"); setPhase("✗ Œuvre rejetée."); }
      else if (stepNum > MAX_STEPS) { setPhase(`Arrêt après ${MAX_STEPS} étapes — état actuel : ${currentState}`); }

    } catch (e) {
      setFinalState("error");
      setPhase(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  const resetWorks = async () => {
    if (!confirm("Reset tous les works (Neon) ?")) return;
    setResetting(true);
    try {
      await fetch("/api/keeper/reset-works", { method: "POST", headers: { "x-admin-call": "1" } });
      setLogs([]); setWork(null); setFinalState("none"); setPhase("");
    } finally { setResetting(false); }
  };

  const progressPct = work
    ? Math.round((Math.max(STATE_ORDER.indexOf(work.state), 0) / (STATE_ORDER.length - 1)) * 100)
    : 0;

  return (
    <div className="space-y-5">

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={() => void runPipeline()}
          disabled={running || resetting}
          className={`font-mono text-xs px-5 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-wait ${
            finalState === "published" ? "bg-green-100 text-green-700 border border-green-300" :
            finalState === "error"     ? "border border-red-400 text-red-600" :
            "bg-[--fg] text-[--bg] hover:opacity-80"
          }`}
        >
          {running ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border border-[--bg] border-t-transparent rounded-full animate-spin inline-block" />
              Pipeline en cours…
            </span>
          ) : finalState === "none" ? "▶ Lancer le pipeline de test complet" : "▶ Relancer"}
        </button>
        {logs.length > 0 && (
          <button
            onClick={() => void resetWorks()}
            disabled={running || resetting}
            className="font-mono text-xs border border-red-300 text-red-500 px-4 py-2.5 hover:bg-red-50 disabled:opacity-40"
          >
            {resetting ? "Reset…" : "🗑 Reset works Neon"}
          </button>
        )}
      </div>

      {/* Phase label */}
      {phase && (
        <p className={`font-mono text-xs ${
          finalState === "published" ? "text-green-600" :
          finalState === "rejected"  ? "text-orange-600" :
          finalState === "error"     ? "text-red-600" :
          "text-[--fg-muted]"
        }`}>{phase}</p>
      )}

      {/* Progress bar */}
      {work && (
        <div className="space-y-1">
          <div className="flex justify-between font-mono text-[10px] text-[--fg-muted]">
            {STATE_ORDER.map(s => (
              <span key={s} className={work.state === s ? "text-[--fg] font-bold" : ""}>{s.slice(0,4)}</span>
            ))}
          </div>
          <div className="h-1.5 bg-[--border] w-full">
            <div
              className={`h-full transition-all duration-700 ${
                finalState === "published" ? "bg-green-500" :
                finalState === "rejected"  ? "bg-orange-400" :
                finalState === "error"     ? "bg-red-400" :
                "bg-[--fg]"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="font-mono text-[10px] text-[--fg-muted]">
            {work.title} — <span className={STATE_COLOR[work.state] ?? ""}>{work.state}</span>
          </p>
        </div>
      )}

      {/* Step logs */}
      {logs.length > 0 && (
        <div className="space-y-2">
          {logs.map((log, i) => (
            <div
              key={i}
              className={`border p-3 cursor-pointer transition-colors hover:bg-[--bg-card] ${
                log.error    ? "border-red-300 bg-red-50/10" :
                log.advanced ? "border-green-300 bg-green-50/10" :
                               "border-[--border]"
              }`}
              onClick={() => setExpanded(expanded === i ? null : i)}
            >
              {/* Header row */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className={`font-mono text-[10px] px-1.5 py-0.5 border ${
                    log.advanced ? "border-green-400 text-green-700" : "border-red-300 text-red-500"
                  }`}>
                    {log.advanced ? "✓" : "✗"}
                  </span>
                  <span className="font-mono text-xs font-bold">
                    {log.from} {log.from !== log.to ? `→ ${log.to}` : "(inchangé)"}
                  </span>
                  <span className="font-mono text-[10px] text-[--fg-muted]">{log.phase}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-[10px] text-[--fg-muted]">{(log.elapsed / 1000).toFixed(1)}s</span>
                  <span className="font-mono text-[10px] text-[--fg-muted]">{expanded === i ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Error */}
              {log.error && (
                <p className="font-mono text-xs text-red-600 mt-1.5">{log.error}</p>
              )}

              {/* Expanded detail */}
              {expanded === i && (
                <div className="mt-3 space-y-3 border-t border-[--border] pt-3">

                  {/* Proposal */}
                  {log.snapshot.proposal && (
                    <div>
                      <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-wider mb-1">Proposition</p>
                      <p className="font-mono text-xs leading-relaxed">{log.snapshot.proposal}</p>
                    </div>
                  )}

                  {/* Votes */}
                  {log.snapshot.votes && log.snapshot.votes.length > 0 && (
                    <div>
                      <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-wider mb-1">
                        Votes — {log.snapshot.yesCount} oui / {log.snapshot.noCount} non / {log.snapshot.absCount} abs
                        {log.snapshot.voteResult && ` → ${log.snapshot.voteResult}`}
                      </p>
                      <div className="space-y-1">
                        {log.snapshot.votes.map((v, vi) => (
                          <div key={vi} className="flex gap-2 font-mono text-xs text-[--fg-muted]">
                            <span className={v.vote === "yes" ? "text-green-600" : v.vote === "no" ? "text-red-500" : "text-[--fg-muted]"}>
                              {v.vote === "yes" ? "✓" : v.vote === "no" ? "✗" : "–"}
                            </span>
                            <span className="font-bold">{v.name}</span>
                            <span>{v.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Roles */}
                  {(log.snapshot.rapporteurName || log.snapshot.authorName || log.snapshot.curatorName) && (
                    <div>
                      <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-wider mb-1">Rôles élus</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: "Rapporteur", name: log.snapshot.rapporteurName, id: log.snapshot.rapporteurTokenId },
                          { label: "Auteur",     name: log.snapshot.authorName,     id: log.snapshot.authorTokenId     },
                          { label: "Curateur",   name: log.snapshot.curatorName,    id: log.snapshot.curatorTokenId    },
                        ].map(r => r.name && (
                          <div key={r.label} className="border border-[--border] px-2 py-1.5">
                            <p className="font-mono text-[9px] text-[--fg-muted] uppercase">{r.label}</p>
                            <p className="font-mono text-xs">{r.name} #{r.id}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Brief */}
                  {log.snapshot.brief && (
                    <div>
                      <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-wider mb-1">
                        Brief — {log.snapshot.artForm ?? "—"} · {log.snapshot.editionSupply ?? "?"} éd. @ {log.snapshot.editionPrice ?? "?"}Ξ
                      </p>
                      <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{log.snapshot.brief}</p>
                    </div>
                  )}

                  {/* Artwork */}
                  {log.snapshot.artworkText && (
                    <div>
                      <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-wider mb-1">
                        Œuvre créée ({log.snapshot.artworkText.length} chars)
                        {log.snapshot.revisionCount && log.snapshot.revisionCount > 0 ? ` — révision #${log.snapshot.revisionCount}` : ""}
                      </p>
                      <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-[--fg] max-h-48 overflow-y-auto border border-[--border] p-3">
                        {log.snapshot.artworkText.slice(0, 1200)}{log.snapshot.artworkText.length > 1200 ? "\n…" : ""}
                      </pre>
                    </div>
                  )}

                  {/* Validation */}
                  {log.snapshot.validationNote && (
                    <div>
                      <p className="font-mono text-[10px] text-[--fg-muted] uppercase tracking-wider mb-1">Note curateur</p>
                      <p className="font-mono text-xs">{log.snapshot.validationNote}</p>
                    </div>
                  )}

                  {/* On-chain data */}
                  {(log.snapshot.txHash || log.snapshot.onChainWorkId != null) && (
                    <div className="border border-green-300 bg-green-50/10 px-3 py-2 space-y-1">
                      <p className="font-mono text-[10px] text-green-700 uppercase tracking-wider">On-chain — Base mainnet</p>
                      {log.snapshot.onChainWorkId != null && (
                        <p className="font-mono text-xs">WorkRegistry ID : #{log.snapshot.onChainWorkId}</p>
                      )}
                      {log.snapshot.txHash && (
                        <a
                          href={`https://basescan.org/tx/${log.snapshot.txHash}`}
                          target="_blank" rel="noopener noreferrer"
                          className="font-mono text-xs text-green-600 underline break-all block"
                          onClick={e => e.stopPropagation()}
                        >
                          tx: {log.snapshot.txHash} ↗
                        </a>
                      )}
                      {log.snapshot.collectionAddress && (
                        <a
                          href={`https://basescan.org/address/${log.snapshot.collectionAddress}`}
                          target="_blank" rel="noopener noreferrer"
                          className="font-mono text-xs text-green-600 underline break-all block"
                          onClick={e => e.stopPropagation()}
                        >
                          collection: {log.snapshot.collectionAddress} ↗
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
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
          {typeof result.message === "string" && <p className="font-mono text-xs text-[--fg-muted]">{result.message}</p>}
          {typeof result.skipped === "string" && <p className="font-mono text-xs text-[--fg-muted]">Ignoré : {result.skipped}</p>}
        </div>
      )}
    </div>
  );
}

// ─── SessionCountdown — ticks every second ────────────────────────────────────

function SessionCountdown({ deadline }: { deadline: bigint }) {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = Number(deadline) - now;
  if (remaining <= 0) return (
    <div className="border border-orange-300 bg-orange-50/20 p-3 font-mono text-xs text-orange-600">
      ⏰ Session expirée — triggerClose() disponible
    </div>
  );
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return (
    <div className="border border-[--border] bg-[--bg-card] p-3 font-mono text-xs text-[--fg-muted]">
      ⏱ Session active — fermeture dans{" "}
      <span className="text-[--fg] font-bold">{m}m {String(s).padStart(2, "0")}s</span>
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
  const { data: sessionRaw, isLoading: sessionLoading } = useReadContract({
    address: CA_ADDR, abi: CONSTITUENT_ASSEMBLY_ABI, functionName: "currentSession",
    query: {
      enabled: contractsDeployed,
      refetchInterval: 5_000,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
  // viem retourne un tuple indexé [id, openedAt, closedAt, deadline, active, resolved]
  const sessionTuple = sessionRaw as unknown as readonly [bigint, bigint, bigint, bigint, boolean, boolean] | undefined;
  const session = sessionTuple ? {
    id:       sessionTuple[0],
    openedAt: sessionTuple[1],
    closedAt: sessionTuple[2],
    deadline: sessionTuple[3],
    active:   Boolean(sessionTuple[4]),
    resolved: Boolean(sessionTuple[5]),
  } : undefined;

  // ── Role holders ──────────────────────────────────────────────────────────
  const { data: memberTokenIds } = useReadContract({
    address: CORE_ADDR, abi: ASSOCIATION_CORE_ABI, functionName: "getMemberTokenIds",
    query: { enabled: contractsDeployed },
  });

  // ── Input state ───────────────────────────────────────────────────────────
  const [moduleInput,  setModuleInput]  = useState<string>(CA_ADDR);
  const [revokeInput,  setRevokeInput]  = useState("");
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
                <StatusRow label="Session #" value={sessionLoading ? "…" : session ? String(session.id) : "0"} />
                <StatusRow
                  label="Statut session"
                  value={
                    sessionLoading ? "Chargement…" :
                    session?.active ? "🟢 Ouverte" :
                    session?.resolved ? "Clôturée" :
                    session?.id ? "Expirée" :
                    "En attente"
                  }
                  ok={session?.active}
                />
                {session?.active && session.deadline && (
                  <StatusRow
                    label="Deadline"
                    value={new Date(Number(session.deadline) * 1000).toLocaleTimeString("fr-FR")}
                  />
                )}
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
            <div className="border border-red-300 p-5 space-y-3">
              <div>
                <p className="font-bold text-sm text-red-700">Révoquer un module</p>
                <p className="font-mono text-xs text-[--fg-muted] mt-0.5 leading-relaxed">
                  Retire les droits d'un module périphérique. Utile pour désactiver un ancien
                  ConstituentAssembly après redéploiement.
                  Module actuel (env) : <span className="text-[--fg]">{CA_ADDR}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  value={revokeInput}
                  onChange={e => setRevokeInput(e.target.value)}
                  placeholder="0x… adresse du module à révoquer"
                  className="font-mono text-xs border border-red-300 bg-[--bg] px-3 py-2 flex-1 focus:outline-none focus:border-red-500"
                />
                <button
                  disabled={!isCoreOwner || !isAddress(revokeInput)}
                  onClick={async () => {
                    await execTx(CORE_ADDR, ASSOCIATION_CORE_ABI, "revokeModule", [revokeInput as `0x${string}`]);
                  }}
                  className="font-mono text-xs border border-red-400 text-red-600 px-4 py-2 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  Révoquer →
                </button>
              </div>
            </div>

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

            {session?.active && (
              <SessionCountdown deadline={session.deadline} />
            )}

            {/* openSession */}
            <AdminAction
              label="Ouvrir la session de vote (10 min)"
              description={
                sessionLoading
                  ? "Lecture de l'état de la session…"
                  : session?.active
                  ? "Une session est déjà active — clôturez-la d'abord."
                  : "Démarre la phase de vote pour 10 minutes. triggerClose() disponible après expiration."
              }
              disabled={!isCaOwner || !!session?.active || sessionLoading}
              disabledReason={
                sessionLoading ? "Lecture en cours…" :
                session?.active ? "Session déjà ouverte" :
                "Wallet propriétaire requis"
              }
              onExec={async () => {
                await execTx(CA_ADDR, CONSTITUENT_ASSEMBLY_ABI, "openSession", [600n]);
              }}
            />

            {/* Lancer le vote automatique (candidature + votes via LLM) */}
            <AdminAction
              label="🤖 Lancer le vote automatique (LLM + relayer)"
              description={
                sessionLoading
                  ? "Vérification de la session en cours…"
                  : session?.active
                  ? "Phase candidature puis vote : chaque Normie choisit ses rôles et vote via son persona LLM. Le relayer soumet les tx."
                  : "⚠ Aucune session active — ouvrez une session de vote d'abord."
              }
              disabled={!session?.active || sessionLoading}
              disabledReason={sessionLoading ? "Chargement…" : "Ouvrez une session d'abord"}
              onExec={async () => {
                const r1 = await fetch("/api/keeper/auto-vote", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ phase: "candidacy" }),
                });
                const c = await r1.json();
                console.log("[auto-vote] candidacy:", c);
                const r2 = await fetch("/api/keeper/auto-vote", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  // Pass candidacies from phase=candidacy to avoid re-running LLM + duplicate messages
                  body: JSON.stringify({ phase: "vote", mode: "execute", candidacies: c.candidacies }),
                });
                const v = await r2.json();
                console.log("[auto-vote] vote:", v);
                if (v.failed?.length) {
                  console.warn("[auto-vote] failed txs:", v.failed);
                  // Non-fatal: continue to try closing
                }
                // Try to auto-close via relayer (works if deadline passed; silent if not)
                await fetch("/api/keeper/auto-vote", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ phase: "close" }),
                }).then(r => r.json()).then(d => console.log("[auto-vote] close:", d)).catch(() => null);
                if ((v.submitted ?? 0) === 0 && v.failed?.length) {
                  throw new Error(`Aucun vote enregistré on-chain : ${v.failed[0]}`);
                }
              }}
            />

            {/* closeSession — manuel (owner) */}
            <AdminAction
              label="Clôturer manuellement (owner)"
              description="Ferme le vote avant expiration. Attribue les 6 rôles on-chain."
              danger
              disabled={!isCaOwner || !session?.active || isCAAuthorized === false || sessionLoading}
              disabledReason={
                sessionLoading ? "Chargement…" :
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
              disabled={sessionLoading || !session?.active || (session?.deadline ? Number(session.deadline) > Math.floor(Date.now() / 1000) : true)}
              disabledReason="Session non expirée ou inactive"
              onExec={async () => {
                const r = await fetch("/api/keeper/auto-vote", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ phase: "close" }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error((d as { error?: string }).error ?? "triggerClose failed");
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

          {/* ── ANACollectionFactory ── */}
          {FACTORY_ADDR && (
            <CollectionFactorySection isOwner={!!isCoreOwner} writeContractAsync={writeContractAsync} />
          )}

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

          {/* ── Test pipeline complet ── */}
          <section className="space-y-4 border-t border-[--border] pt-10">
            <div>
              <h2 className="text-xl font-bold">Pipeline de test — Proposition → Publication</h2>
              <p className="font-mono text-xs text-[--fg-muted] mt-1">
                Lance le cycle complet en automatique : proposition LLM → vote → brief → création → validation → publication on-chain.
                Chaque étape est loggée avec ses données (votes, brief, œuvre, tx hash, adresse collection).
              </p>
            </div>
            <WorkTestPipelineSection />
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
