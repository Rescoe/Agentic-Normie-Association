"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

interface WorkSummary {
  id: string;
  title: string;
  proposal: string;
  state: string;
  proposedBy: number;
  proposedByName: string;
  drawSubmissionId?: string;
  drawSubmittedBy?: number;
  peerReviewerTokenId?: number;
  peerReviewDecision?: "approved" | "rejected";
  peerReviewNote?: string;
  artworkText?: string;
}

function buildMemberAuthMessage(address: string, tokenId: number, timestamp: number): string {
  return `ANA member action\naddress: ${address.toLowerCase()}\ntokenId: ${tokenId}\ntimestamp: ${timestamp}`;
}

const AWAITING_ASSIGNMENT_STATES = ["CREATING"];

export function ReviewClient({ workId }: { workId: string }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [work, setWork] = useState<WorkSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tokenId, setTokenId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"approved" | "rejected" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadWork = useCallback(async () => {
    try {
      const res = await fetch(`/api/works/${workId}`);
      const data = await res.json();
      if (!res.ok) { setLoadError(data.error ?? "Introuvable"); return; }
      setWork(data.work);
      if (data.work.peerReviewerTokenId != null) setTokenId(prev => prev || String(data.work.peerReviewerTokenId));
    } catch {
      setLoadError("Erreur réseau");
    }
  }, [workId]);

  useEffect(() => { loadWork(); }, [loadWork]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadWork();
    setRefreshing(false);
  }

  async function handleDecision(decision: "approved" | "rejected") {
    setSubmitError(null);
    const id = parseInt(tokenId, 10);
    if (!Number.isInteger(id) || id < 0) { setSubmitError("Numéro de token invalide."); return; }
    if (!address) { setSubmitError("Connecte ton wallet d'abord."); return; }

    setSubmitting(decision);
    try {
      const timestamp = Date.now();
      const signature = await signMessageAsync({ message: buildMemberAuthMessage(address, id, timestamp) });
      const res = await fetch(`/api/works/${workId}/peer-review`, {
        method:  "POST",
        headers: {
          "Content-Type":       "application/json",
          "x-member-address":   address,
          "x-member-tokenid":   String(id),
          "x-member-signature": signature,
          "x-member-timestamp": String(timestamp),
        },
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error ?? "Échec de la revue."); return; }
      await loadWork();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setSubmitting(null);
    }
  }

  if (loadError) {
    return <div className="max-w-2xl mx-auto px-4 py-16 font-mono text-sm text-red-400">{loadError}</div>;
  }
  if (!work) {
    return <div className="max-w-2xl mx-auto px-4 py-16 font-mono text-xs text-[--fg-muted]">Chargement…</div>;
  }

  const readyToReview = work.state === "VALIDATING" && work.peerReviewerTokenId != null && !work.peerReviewDecision;

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      <Link href="/galerie/celebrations" className="font-mono text-[10px] text-[--fg-muted] underline">← Célébrations</Link>
      <h1 className="text-xl font-bold">{work.title}</h1>
      <p className="font-mono text-[10px] text-[--fg-muted]">
        État : <span className="text-[--fg]">{work.state}</span> · Dessiné par {work.proposedByName} (#{work.proposedBy})
      </p>

      {(AWAITING_ASSIGNMENT_STATES.includes(work.state) || (work.state === "VALIDATING" && work.peerReviewerTokenId == null)) && (
        <div className="border border-[--border] bg-[--bg-card] p-4 space-y-2">
          <p className="font-mono text-xs text-[--fg-muted]">
            {!work.drawSubmissionId
              ? "Le dessin n'a pas encore été soumis par le proposeur."
              : "Le dessin est soumis mais le pair reviewer n'est pas encore assigné — un administrateur doit faire avancer la pipeline depuis le panneau admin (« 🎨 Déclencher work-lifecycle »)."}
          </p>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="font-mono text-[10px] border border-[--border] px-3 py-1.5 text-[--fg-muted] hover:text-[--fg] disabled:opacity-50"
          >
            {refreshing ? "…" : "↻ Actualiser"}
          </button>
        </div>
      )}

      {work.artworkText && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={work.artworkText} alt={work.title} style={{ width: 264, imageRendering: "pixelated" }} className="border border-[--border]" />
      )}

      {readyToReview && (
        <div className="space-y-3">
          <p className="font-mono text-xs text-[--fg-muted]">
            Seul le wallet de Normie #{work.peerReviewerTokenId} peut trancher (pas l'auteur).
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <ConnectButton />
            <input
              type="number"
              min={0}
              value={tokenId}
              onChange={e => setTokenId(e.target.value)}
              placeholder="Mon tokenId"
              className="font-mono text-xs bg-[--bg] border border-[--border] px-2 py-1.5 w-28 text-[--fg]"
            />
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Note (optionnelle)"
            rows={2}
            className="font-mono text-xs bg-[--bg] border border-[--border] px-2 py-1.5 w-full text-[--fg]"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDecision("approved")}
              disabled={submitting != null || !address}
              className="font-mono text-[10px] border border-green-400 text-green-400 px-3 py-1.5 hover:bg-green-400 hover:text-[--bg] transition-colors disabled:opacity-50"
            >
              {submitting === "approved" ? "…" : "✓ Approuver"}
            </button>
            <button
              onClick={() => handleDecision("rejected")}
              disabled={submitting != null || !address}
              className="font-mono text-[10px] border border-red-400 text-red-400 px-3 py-1.5 hover:bg-red-400 hover:text-[--bg] transition-colors disabled:opacity-50"
            >
              {submitting === "rejected" ? "…" : "✕ Rejeter"}
            </button>
          </div>
          {submitError && <p className="font-mono text-[11px] text-red-400">{submitError}</p>}
        </div>
      )}

      {work.peerReviewDecision && (
        <p className={`font-mono text-sm ${work.peerReviewDecision === "approved" ? "text-green-400" : "text-red-400"}`}>
          {work.peerReviewDecision === "approved" ? "✓ Approuvé" : "✕ Rejeté"}
          {work.peerReviewNote ? ` — ${work.peerReviewNote}` : ""}
          {work.peerReviewDecision === "approved" && work.state !== "PUBLISHED" && " — publication en attente du prochain tick."}
        </p>
      )}
      {work.state === "PUBLISHED" && <p className="font-mono text-sm text-green-400">✓ Publié.</p>}
    </div>
  );
}
