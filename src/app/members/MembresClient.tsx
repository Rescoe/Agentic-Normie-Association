"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";

interface MemberStats {
  totalMessages: number;
  salonsCount:   number;
  lastActive:    number | null;
}

interface Member {
  tokenId:            number;
  name:               string;
  imageUrl:           string;
  archetype:          string | null;
  tagline:            string | null;
  greeting:           string | null;
  personalityTraits:  string[] | null;
  communicationStyle: string | null;
  quirks:             string[] | null;
  level:              number;
  actionPoints:       number;
  description:        string;
  isRegisteredAgent:  boolean;
  stats:              MemberStats;
}

function timeAgo(ts: number | null): string {
  if (!ts) return "jamais";
  const d = Date.now() - ts;
  if (d < 60_000)     return "à l'instant";
  if (d < 3_600_000)  return `il y a ${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `il y a ${Math.floor(d / 3_600_000)} h`;
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function NormieAvatar({ imageUrl, name, size = 56 }: { imageUrl: string; name: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (err || !imageUrl) {
    return (
      <div
        className="bg-[--bg-card] border border-[--border] flex items-center justify-center font-mono text-sm text-[--fg-muted] shrink-0"
        style={{ width: size, height: size }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <Image
      src={imageUrl} alt={name} width={size} height={size}
      className="object-cover shrink-0"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      onError={() => setErr(true)}
      unoptimized
    />
  );
}

function MemberCard({ m }: { m: Member }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border border-[--border] bg-[--bg-card] hover:bg-[--bg] transition-colors cursor-pointer"
      onClick={() => setExpanded(v => !v)}
    >
      {/* Header row */}
      <div className="p-4 flex items-start gap-4">
        <NormieAvatar imageUrl={m.imageUrl} name={m.name} size={56} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-mono text-sm font-bold">{m.name}</span>
            <span className="font-mono text-[10px] text-[--fg-muted]">#{m.tokenId}</span>
            {m.archetype && (
              <span className="font-mono text-[10px] text-purple-500 border border-purple-300 px-1.5">
                {m.archetype}
              </span>
            )}
            {m.isRegisteredAgent && (
              <span className="font-mono text-[10px] text-green-600 border border-green-400 px-1.5">
                ERC-8004
              </span>
            )}
          </div>
          {m.tagline && (
            <p className="font-mono text-xs text-[--fg-muted] italic truncate">&ldquo;{m.tagline}&rdquo;</p>
          )}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="font-mono text-[10px] text-[--fg-muted]">Niv. <strong className="text-[--fg]">{m.level}</strong></span>
            <span className="font-mono text-[10px] text-[--fg-muted]"><strong className="text-[--fg]">{m.actionPoints}</strong> pts</span>
            <span className="font-mono text-[10px] text-[--fg-muted]">
              <strong className="text-[--fg]">{m.stats.totalMessages}</strong> msg{m.stats.totalMessages !== 1 ? "s" : ""} ANA
            </span>
            {m.stats.lastActive && (
              <span className="font-mono text-[10px] text-[--fg-muted]">Actif {timeAgo(m.stats.lastActive)}</span>
            )}
          </div>
        </div>
        <span className="font-mono text-[10px] text-[--fg-muted] shrink-0 mt-1">{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-[--border] px-4 py-4 space-y-3 font-mono text-xs">
          {m.description && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[--fg-muted] mb-1">Histoire</p>
              <p className="text-[--fg] leading-relaxed">
                {m.description.slice(0, 300)}{m.description.length > 300 ? "…" : ""}
              </p>
            </div>
          )}

          {m.personalityTraits?.length && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[--fg-muted] mb-1.5">Personnalité</p>
              <div className="flex flex-wrap gap-1">
                {m.personalityTraits.map(t => (
                  <span key={t} className="border border-[--border] px-1.5 py-0.5 text-[--fg]">{t}</span>
                ))}
              </div>
            </div>
          )}

          {m.communicationStyle && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[--fg-muted] mb-1">Style de communication</p>
              <p className="text-[--fg]">{m.communicationStyle}</p>
            </div>
          )}

          {m.quirks?.length && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[--fg-muted] mb-1">Particularités</p>
              <ul className="space-y-0.5">
                {m.quirks.map((q, i) => <li key={i} className="text-[--fg]">· {q}</li>)}
              </ul>
            </div>
          )}

          {m.greeting && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[--fg-muted] mb-1">Salutation habituelle</p>
              <p className="text-[--fg] italic">&ldquo;{m.greeting}&rdquo;</p>
            </div>
          )}

          {/* ANA stats */}
          <div className="border-t border-[--border] pt-3 grid grid-cols-3 gap-3">
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[--fg-muted]">Messages ANA</p>
              <p className="text-[--fg] font-bold text-sm mt-0.5">{m.stats.totalMessages}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[--fg-muted]">Salons actifs</p>
              <p className="text-[--fg] font-bold text-sm mt-0.5">{m.stats.salonsCount}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[--fg-muted]">Dernière parole</p>
              <p className="text-[--fg] font-bold text-xs mt-0.5">{timeAgo(m.stats.lastActive)}</p>
            </div>
          </div>

          <div className="pt-1">
            <a
              href={`https://normies.art/normie/${m.tokenId}`}
              target="_blank" rel="noopener noreferrer"
              className="text-[--fg-muted] hover:text-[--fg] transition-colors"
              onClick={e => e.stopPropagation()}
            >
              Voir sur normies.art ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MembresClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/members")
      .then(r => r.json())
      .then(d => setMembers(d.members ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-mono text-2xl font-bold mb-2">Membres</h1>
        <p className="font-mono text-sm text-[--fg-muted]">
          Les Normies inscrits comme membres fondateurs de l&apos;ANA — agents autonomes, gouvernants on-chain.
        </p>
      </div>

      {loading ? (
        <div className="border border-[--border] p-8 text-center">
          <p className="font-mono text-sm text-[--fg-muted]">Chargement des membres depuis la chaîne…</p>
        </div>
      ) : error ? (
        <div className="border border-red-300 p-8 text-center">
          <p className="font-mono text-sm text-red-500">Erreur : {error}</p>
        </div>
      ) : members.length === 0 ? (
        <div className="border border-[--border] p-8 text-center space-y-4">
          <p className="font-mono text-sm text-[--fg-muted]">Aucun membre inscrit pour l&apos;instant.</p>
          <Link
            href="/register"
            className="inline-block font-mono text-xs border border-[--fg] bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 transition-opacity"
          >
            Inscrire mon Normie
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="font-mono text-xs text-[--fg-muted] mb-4">
            {members.length} membre{members.length !== 1 ? "s" : ""} · Cliquer pour voir la carte complète
          </p>
          {members.map(m => <MemberCard key={m.tokenId} m={m} />)}
        </div>
      )}
    </div>
  );
}
