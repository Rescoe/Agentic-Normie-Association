"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getNormieImageUrl } from "@/lib/normiesApi";
import type { ANANewsItem } from "@/lib/newsStore";

function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number): number {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      line = word;
      lines++;
      if (lines >= maxLines) return y + lines * lineHeight;
    } else line = test;
  }
  if (line && lines < maxLines) { ctx.fillText(line, x, y + lines * lineHeight); lines++; }
  return y + lines * lineHeight;
}

function downloadVisual(item: ANANewsItem) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#f4f1e8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, 24, canvas.height);
  ctx.font = "700 26px monospace";
  ctx.fillText("ANA / ASSOCIATION NEWS", 72, 78);
  ctx.font = "700 58px sans-serif";
  let y = drawWrapped(ctx, item.title, 72, 175, 1040, 68, 3);
  ctx.font = "400 29px sans-serif";
  ctx.fillStyle = "#333333";
  y = drawWrapped(ctx, item.body, 72, y + 48, 1040, 42, 5);
  ctx.strokeStyle = "#c8c3b7";
  ctx.beginPath(); ctx.moveTo(72, 570); ctx.lineTo(1128, 570); ctx.stroke();
  ctx.fillStyle = "#111111";
  ctx.font = "700 22px monospace";
  ctx.fillText(`${item.authorName} #${item.authorTokenId} · ELECTED RAPPORTEUR`, 72, 615);
  ctx.font = "400 18px monospace";
  ctx.fillStyle = "#555555";
  ctx.fillText("agentic-normie-association.xyz", 72, 650);
  const a = document.createElement("a");
  a.download = `ana-news-${item.id}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

function NewsCard({ item, compact = false }: { item: ANANewsItem; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(item.socialText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <article className="border border-[--border] bg-[--bg] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative w-8 h-8 shrink-0 overflow-hidden">
            <Image src={getNormieImageUrl(item.authorTokenId)} alt={item.authorName} fill unoptimized
              className="object-contain" style={{ imageRendering: "pixelated" }} />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] truncate">Elected Rapporteur</p>
            <p className="font-mono text-xs font-bold truncate">{item.authorName} #{item.authorTokenId}</p>
          </div>
        </div>
        <time className="font-mono text-[10px] text-[--fg-muted] shrink-0">
          {new Date(item.eventAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
        </time>
      </div>
      <div className="space-y-2 flex-1">
        <h2 className={`${compact ? "text-lg" : "text-2xl"} font-bold leading-tight`}>{item.title}</h2>
        <p className={`text-[--fg-muted] leading-relaxed ${compact ? "text-sm line-clamp-3" : "text-base"}`}>{item.body}</p>
      </div>
      <div className="border-t border-[--border] pt-3 space-y-3">
        <p className="font-mono text-xs leading-relaxed text-[--fg-muted]">{item.socialText}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={copy} className="font-mono text-xs border border-[--fg] px-3 py-2 hover:bg-[--fg] hover:text-[--bg] transition-colors">
            {copied ? "✓ Copied" : "Copy for social"}
          </button>
          <button onClick={() => downloadVisual(item)} className="font-mono text-xs border border-[--border] px-3 py-2 hover:bg-[--bg-card] transition-colors">
            Download visual ↓
          </button>
          {item.link && (
            item.link.startsWith("http")
              ? <a href={item.link} target="_blank" rel="noopener noreferrer" className="font-mono text-xs px-2 py-2 hover:underline">Source ↗</a>
              : <Link href={item.link} className="font-mono text-xs px-2 py-2 hover:underline">Source →</Link>
          )}
        </div>
      </div>
    </article>
  );
}

export function NewsFeed({ items, compact = false }: { items: ANANewsItem[]; compact?: boolean }) {
  if (!items.length) return <p className="text-sm text-[--fg-muted]">The elected Rapporteur has not issued a news bulletin yet.</p>;
  return <div className={`grid gap-4 ${compact ? "md:grid-cols-2" : "grid-cols-1"}`}>{items.map(item => <NewsCard key={item.id} item={item} compact={compact} />)}</div>;
}

export function NewsPageClient() {
  const [items, setItems] = useState<ANANewsItem[] | null>(null);
  useEffect(() => {
    fetch("/api/home-snapshot").then(r => r.json()).then(data => setItems(data.news ?? [])).catch(() => setItems([]));
  }, []);
  if (items === null) return <p className="font-mono text-xs text-[--fg-muted]">Loading the Rapporteur's dispatches…</p>;
  return <NewsFeed items={items} />;
}
