"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const CANVAS_W = 264;
const CANVAS_H = 176;
const DISPLAY_SCALE = 2; // 528x352 on screen, drawn at native 264x176

interface WorkSummary {
  id: string;
  title: string;
  proposal: string;
  state: string;
  artForm?: string;
  proposedBy: number;
  proposedByName: string;
  drawSubmissionId?: string;
  peerReviewerTokenId?: number;
  peerReviewDecision?: "approved" | "rejected";
  peerReviewNote?: string;
  artworkText?: string;
}

interface ReplayEvent { kind: "down" | "move" | "up"; t: number; x: number; y: number }

function buildMemberAuthMessage(address: string, tokenId: number, timestamp: number): string {
  return `ANA member action\naddress: ${address.toLowerCase()}\ntokenId: ${tokenId}\ntimestamp: ${timestamp}`;
}

const PRE_CREATING_STATES = ["PROPOSED", "VOTE_OPEN", "VOTE_TALLIED", "BRIEFING"];

export function DrawClient({ workId }: { workId: string }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [work, setWork]         = useState<WorkSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tokenId, setTokenId]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const canvasRef  = useRef<HTMLCanvasElement | null>(null);
  const drawingRef  = useRef(false);
  const replayRef   = useRef<ReplayEvent[]>([]);
  const startRef    = useRef<number>(0);
  const hasInkRef   = useRef(false);

  const loadWork = useCallback(async () => {
    try {
      const res = await fetch(`/api/works/${workId}`);
      const data = await res.json();
      if (!res.ok) { setLoadError(data.error ?? "Introuvable"); return; }
      setWork(data.work);
      if (data.work.proposedBy != null) setTokenId(prev => prev || String(data.work.proposedBy));
    } catch {
      setLoadError("Erreur réseau");
    }
  }, [workId]);

  useEffect(() => { loadWork(); }, [loadWork]);

  // Init canvas: white background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }, [work?.state]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadWork();
    setRefreshing(false);
  }

  function canvasPos(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) / DISPLAY_SCALE),
      y: Math.round((e.clientY - rect.top) / DISPLAY_SCALE),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    if (replayRef.current.length === 0) startRef.current = performance.now();
    const { x, y } = canvasPos(e);
    const t = performance.now() - startRef.current;
    replayRef.current.push({ kind: "down", t, x, y });
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.fillStyle = "#000"; ctx.fillRect(x - 2, y - 2, 4, 4); }
    hasInkRef.current = true;
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const { x, y } = canvasPos(e);
    const t = performance.now() - startRef.current;
    replayRef.current.push({ kind: "move", t, x, y });
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.fillStyle = "#000"; ctx.fillRect(x - 2, y - 2, 4, 4); }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const { x, y } = canvasPos(e);
    const t = performance.now() - startRef.current;
    replayRef.current.push({ kind: "up", t, x, y });
  }

  function handleClear() {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); }
    replayRef.current = [];
    hasInkRef.current = false;
  }

  async function handleSubmit() {
    setSubmitError(null);
    const id = parseInt(tokenId, 10);
    if (!Number.isInteger(id) || id < 0) { setSubmitError("Numéro de token invalide."); return; }
    if (!address) { setSubmitError("Connecte ton wallet d'abord."); return; }
    if (!hasInkRef.current) { setSubmitError("Le dessin est vide."); return; }
    if (replayRef.current.length < 2) { setSubmitError("Dessine un peu plus avant de soumettre."); return; }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    setSubmitting(true);
    try {
      const img = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      const gray = new Uint8Array(CANVAS_W * CANVAS_H);
      for (let i = 0; i < gray.length; i++) {
        const o = i * 4;
        const lum = (img.data[o] * 3 + img.data[o + 1] * 6 + img.data[o + 2]) / 10;
        gray[i] = img.data[o + 3] < 32 ? 255 : lum;
      }
      let binary = "";
      for (let i = 0; i < gray.length; i++) binary += String.fromCharCode(gray[i]);
      const pixelsB64 = btoa(binary);

      const timestamp = Date.now();
      const signature = await signMessageAsync({ message: buildMemberAuthMessage(address, id, timestamp) });

      const res = await fetch("/api/draw/submit", {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-member-address":   address,
          "x-member-tokenid":   String(id),
          "x-member-signature": signature,
          "x-member-timestamp": String(timestamp),
        },
        body: JSON.stringify({
          replayEvents: replayRef.current,
          canvasW: CANVAS_W,
          canvasH: CANVAS_H,
          pixels:  pixelsB64,
          mode:    "celebration",
          workId,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error ?? "Échec de la soumission."); return; }
      setSubmitted(true);
      await loadWork();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <div className="max-w-2xl mx-auto px-4 py-16 font-mono text-sm text-red-400">{loadError}</div>;
  }
  if (!work) {
    return <div className="max-w-2xl mx-auto px-4 py-16 font-mono text-xs text-[--fg-muted]">Chargement…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      <Link href="/galerie/celebrations" className="font-mono text-[10px] text-[--fg-muted] underline">← Célébrations</Link>
      <h1 className="text-xl font-bold">{work.title}</h1>
      <p className="font-mono text-xs text-[--fg-muted]">{work.proposal}</p>
      <p className="font-mono text-[10px] text-[--fg-muted]">
        État : <span className="text-[--fg]">{work.state}</span> · Dessinateur désigné : {work.proposedByName} (#{work.proposedBy})
      </p>

      {PRE_CREATING_STATES.includes(work.state) && (
        <div className="border border-[--border] bg-[--bg-card] p-4 space-y-2">
          <p className="font-mono text-xs text-[--fg-muted]">
            Ce mémorial n'a pas encore atteint l'étape de dessin (vote/briefing en cours) — un administrateur doit faire
            avancer la pipeline depuis le panneau admin (« 🎨 Déclencher work-lifecycle »), ou attendre le prochain
            passage du cron (2h).
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

      {work.state === "CREATING" && !work.drawSubmissionId && (
        <div className="space-y-3">
          <p className="font-mono text-xs text-[--fg-muted]">
            Dessine ci-dessous (noir sur blanc) — seul le wallet de Normie #{work.proposedBy} ({work.proposedByName}) peut soumettre ce mémorial.
          </p>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ width: CANVAS_W * DISPLAY_SCALE, height: CANVAS_H * DISPLAY_SCALE, touchAction: "none", cursor: "crosshair" }}
            className="border border-[--border] bg-white"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          <div className="flex items-center gap-2">
            <button onClick={handleClear} className="font-mono text-[10px] border border-[--border] px-2 py-1.5 text-[--fg-muted] hover:text-[--fg]">
              Effacer
            </button>
          </div>

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
            <button
              onClick={handleSubmit}
              disabled={submitting || !address}
              className="font-mono text-[10px] border border-[--fg] px-3 py-1.5 hover:bg-[--fg] hover:text-[--bg] transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              {submitting ? "Signature + envoi…" : "Soumettre le dessin"}
            </button>
          </div>
          {submitError && <p className="font-mono text-[11px] text-red-400">{submitError}</p>}
        </div>
      )}

      {(work.drawSubmissionId || submitted) && work.state !== "PUBLISHED" && work.state !== "REJECTED" && (
        <div className="border border-[--border] bg-[--bg-card] p-4 space-y-2">
          {work.artworkText && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={work.artworkText} alt={work.title} style={{ width: 264, imageRendering: "pixelated" }} className="border border-[--border]" />
          )}
          <p className="font-mono text-xs text-[--fg-muted]">
            Dessin soumis — en attente de revue par le pair désigné (#{work.peerReviewerTokenId ?? "à assigner"}).
          </p>
          <Link href={`/celebrations/${workId}/review`} className="font-mono text-[10px] underline text-[--fg-muted]">
            Voir / faire la revue →
          </Link>
        </div>
      )}

      {work.state === "PUBLISHED" && (
        <p className="font-mono text-sm text-green-400">✓ Publié.</p>
      )}
      {work.state === "REJECTED" && (
        <p className="font-mono text-sm text-red-400">Rejeté{work.peerReviewNote ? ` — ${work.peerReviewNote}` : ""}.</p>
      )}
    </div>
  );
}
