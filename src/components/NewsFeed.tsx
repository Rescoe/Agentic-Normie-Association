"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getNormieImageUrl } from "@/lib/normiesApi";
import { visualUrl } from "@/lib/newsMedia";
import type { ANANewsItem, NewsLink } from "@/lib/newsStore";

// Old rows (schemaVersion absent) have neither `media` nor `links` nor
// `visualPath` — every usage below already treats those as optional, so a
// pre-extension news item still renders exactly as it did before.

function NewsMediaThumb({ item }: { item: ANANewsItem }) {
  const src = item.media?.sourceUrl;
  if (!src) return null;
  return (
    <div className="relative w-full overflow-hidden border border-[--border] bg-[--bg-card]" style={{ aspectRatio: "16/9" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- external/data-URI source, next/image would need per-host config for api.normies.art */}
      <img
        src={src}
        alt={item.media?.alt ?? item.title}
        className="w-full h-full object-cover"
        style={{ imageRendering: item.media?.kind === "normie" ? "pixelated" : "auto" }}
        loading="lazy"
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    </div>
  );
}

function LinkButton({ link }: { link: NewsLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-[10px] border border-[--border] px-2 py-1.5 hover:bg-[--bg-card] hover:border-[--fg] transition-colors"
    >
      {link.label} ↗
    </a>
  );
}

function NewsCard({ item, compact = false }: { item: ANANewsItem; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(item.socialText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <article id={`news-${item.id}`} className="border border-[--border] bg-[--bg] p-5 flex flex-col gap-4 scroll-mt-24">
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

      <NewsMediaThumb item={item} />

      <div className="space-y-2 flex-1">
        <h2 className={`${compact ? "text-lg" : "text-2xl"} font-bold leading-tight`}>
          <a href={`#news-${item.id}`} className="hover:underline">{item.title}</a>
        </h2>
        <p className={`text-[--fg-muted] leading-relaxed ${compact ? "text-sm line-clamp-3" : "text-base"}`}>{item.body}</p>
      </div>

      <div className="border-t border-[--border] pt-3 space-y-3">
        <p className="font-mono text-xs leading-relaxed text-[--fg-muted]">{item.socialText}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={copy} className="font-mono text-xs border border-[--fg] px-3 py-2 hover:bg-[--fg] hover:text-[--bg] transition-colors">
            {copied ? "✓ Copied" : "Copy for social"}
          </button>
          <a href={visualUrl(item)} download={`ana-news-${item.id}.png`}
            className="font-mono text-xs border border-[--border] px-3 py-2 hover:bg-[--bg-card] transition-colors">
            Download visual ↓
          </a>
          {!item.links?.length && item.link && (
            item.link.startsWith("http")
              ? <a href={item.link} target="_blank" rel="noopener noreferrer" className="font-mono text-xs px-2 py-2 hover:underline">Source ↗</a>
              : <Link href={item.link} className="font-mono text-xs px-2 py-2 hover:underline">Source →</Link>
          )}
        </div>
        {!!item.links?.length && (
          <div className="flex flex-wrap gap-2">
            {item.links.map((link, i) => <LinkButton key={`${link.kind}-${i}`} link={link} />)}
          </div>
        )}
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
    fetch("/api/news?limit=50").then(r => r.json()).then(data => setItems(data.items ?? [])).catch(() => setItems([]));
  }, []);
  if (items === null) return <p className="font-mono text-xs text-[--fg-muted]">Loading the Rapporteur's dispatches…</p>;
  return <NewsFeed items={items} />;
}
