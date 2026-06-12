"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { useAccount } from "wagmi";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SalonMessage {
  id:        string;
  salonId:   string;
  tokenId:   number;
  name:      string;
  imageUrl:  string;
  content:   string;
  isLlm:     boolean;
  timestamp: number;
}

interface Salon {
  id:          string;
  name:        string;
  description: string;
  createdBy:   number;
  createdAt:   number;
  members:     number[];
  excluded:    number[];
  isOpen:      boolean;
  messages:    SalonMessage[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)  return "à l'instant";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h`;
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function NormieAvatar({ imageUrl, name, size = 32 }: { imageUrl: string; name: string; size?: number }) {
  const [errored, setErrored] = useState(false);
  if (errored || !imageUrl) {
    return (
      <div
        className="rounded-sm bg-[--bg-card] border border-[--border] flex items-center justify-center font-mono text-xs text-[--fg-muted] shrink-0"
        style={{ width: size, height: size }}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <Image
      src={imageUrl}
      alt={name}
      width={size}
      height={size}
      className="rounded-sm shrink-0 object-cover"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      onError={() => setErrored(true)}
      unoptimized
    />
  );
}

// ─── NormieTokenId selector (stored in localStorage) ──────────────────────────

function useMyTokenId(): [number | null, (id: number) => void] {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem("ana_my_token_id");
    if (stored) setId(parseInt(stored, 10));
  }, []);
  const save = useCallback((newId: number) => {
    localStorage.setItem("ana_my_token_id", String(newId));
    setId(newId);
  }, []);
  return [id, save];
}

// ─── Single salon chat view ────────────────────────────────────────────────────

function SalonChat({
  salon,
  myTokenId,
  onBack,
  onSalonUpdate,
}: {
  salon:          Salon;
  myTokenId:      number | null;
  onBack:         () => void;
  onSalonUpdate:  (s: Salon) => void;
}) {
  const [messages,    setMessages]    = useState<SalonMessage[]>(salon.messages);
  const [trigger,     setTrigger]     = useState("");
  const [sending,     setSending]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [rateCooldown, setRateCooldown] = useState<number | null>(null); // ms until retry
  const [showExclude, setShowExclude] = useState(false);
  const [excludeId,   setExcludeId]   = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef   = useRef<NodeJS.Timeout | null>(null);
  const lastTs    = useRef<number>(messages[messages.length - 1]?.timestamp ?? 0);

  // Poll for new messages every 5s
  useEffect(() => {
    const poll = async () => {
      try {
        const res  = await fetch(`/api/salon/${salon.id}/messages?since=${lastTs.current}`);
        const data = await res.json() as { messages: SalonMessage[] };
        if (data.messages?.length > 0) {
          setMessages(prev => {
            const ids = new Set(prev.map(m => m.id));
            const fresh = data.messages.filter(m => !ids.has(m.id));
            if (fresh.length === 0) return prev;
            lastTs.current = Math.max(...fresh.map(m => m.timestamp));
            return [...prev, ...fresh];
          });
        }
      } catch { /* ignore */ }
    };
    pollRef.current = setInterval(poll, 5_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [salon.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Countdown for rate limit
  useEffect(() => {
    if (!rateCooldown) return;
    const iv = setInterval(() => {
      setRateCooldown(prev => {
        if (!prev || prev <= 1000) { clearInterval(iv); return null; }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [rateCooldown]);

  const speak = async () => {
    if (!myTokenId || sending || rateCooldown) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/salon/${salon.id}/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ tokenId: myTokenId, trigger: trigger.trim() || undefined }),
      });
      const data = await res.json() as { message?: SalonMessage; error?: string };
      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("Retry-After") ?? "3600", 10) * 1000;
          setRateCooldown(retryAfter);
        }
        setError(data.error ?? "Erreur inconnue");
      } else if (data.message) {
        setMessages(prev => [...prev, data.message!]);
        lastTs.current = data.message.timestamp;
        setTrigger("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setSending(false);
    }
  };

  const closeSalon = async () => {
    if (!myTokenId || myTokenId !== salon.createdBy) return;
    if (!confirm(`Fermer le salon "${salon.name}" définitivement ?`)) return;
    const res = await fetch(`/api/salon/${salon.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "close", byTokenId: myTokenId }),
    });
    if (res.ok) onSalonUpdate({ ...salon, isOpen: false });
  };

  const excludeMember = async () => {
    const targetId = parseInt(excludeId, 10);
    if (!myTokenId || !targetId || myTokenId !== salon.createdBy) return;
    const res = await fetch(`/api/salon/${salon.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "exclude", byTokenId: myTokenId, targetTokenId: targetId }),
    });
    if (res.ok) {
      onSalonUpdate({ ...salon, excluded: [...salon.excluded, targetId] });
      setExcludeId("");
      setShowExclude(false);
    }
  };

  const isCreator    = myTokenId === salon.createdBy;
  const isExcluded   = myTokenId ? salon.excluded.includes(myTokenId) : false;
  const canSpeak     = myTokenId && salon.isOpen && !isExcluded && !rateCooldown;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-[--border] px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors"
          >
            ← Salons
          </button>
          <div className="w-px h-4 bg-[--border]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold">{salon.name}</span>
              {!salon.isOpen && (
                <span className="font-mono text-xs text-red-500 border border-red-500 px-1.5">fermé</span>
              )}
            </div>
            {salon.description && (
              <p className="font-mono text-xs text-[--fg-muted]">{salon.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isCreator && salon.isOpen && (
            <>
              <button
                onClick={() => setShowExclude(v => !v)}
                className="font-mono text-xs text-[--fg-muted] hover:text-orange-500 border border-[--border] px-2 py-1 transition-colors"
              >
                Exclure
              </button>
              <button
                onClick={closeSalon}
                className="font-mono text-xs text-red-600 hover:bg-red-50 border border-red-300 px-2 py-1 transition-colors"
              >
                Fermer
              </button>
            </>
          )}
        </div>
      </div>

      {/* Exclude form */}
      {showExclude && isCreator && (
        <div className="border-b border-[--border] px-4 py-2 bg-orange-50/5 flex items-center gap-2">
          <input
            type="number"
            placeholder="TokenId à exclure"
            value={excludeId}
            onChange={e => setExcludeId(e.target.value)}
            className="font-mono text-xs border border-[--border] bg-[--bg] text-[--fg] px-2 py-1 w-32"
          />
          <button
            onClick={excludeMember}
            disabled={!excludeId}
            className="font-mono text-xs border border-orange-500 text-orange-600 px-3 py-1 hover:bg-orange-50 disabled:opacity-40 transition-colors"
          >
            Confirmer
          </button>
          <button
            onClick={() => setShowExclude(false)}
            className="font-mono text-xs text-[--fg-muted]"
          >
            Annuler
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <p className="font-mono text-sm text-[--fg-muted] text-center mt-8">
            Aucun message — lance la conversation.
          </p>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className="flex gap-2.5">
              <NormieAvatar imageUrl={msg.imageUrl} name={msg.name} size={32} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="font-mono text-xs font-bold text-[--fg]">{msg.name}</span>
                  <span className="font-mono text-[10px] text-[--fg-muted]">{timeAgo(msg.timestamp)}</span>
                  {msg.isLlm && (
                    <span className="font-mono text-[10px] text-purple-500 border border-purple-300 px-1">LLM</span>
                  )}
                </div>
                <p className="font-mono text-sm text-[--fg] leading-relaxed whitespace-pre-wrap break-words">
                  {msg.content}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {salon.isOpen && (
        <div className="border-t border-[--border] px-4 py-3 shrink-0">
          {!myTokenId ? (
            <p className="font-mono text-xs text-[--fg-muted] text-center">
              Sélectionnez votre Normie pour parler ↑
            </p>
          ) : isExcluded ? (
            <p className="font-mono text-xs text-red-500 text-center">
              Vous avez été exclu de ce salon.
            </p>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={trigger}
                onChange={e => setTrigger(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); speak(); } }}
                placeholder={
                  rateCooldown
                    ? `Attente ${Math.ceil(rateCooldown / 60_000)} min…`
                    : "Sujet ou contexte (optionnel) — Entrée pour parler"
                }
                disabled={!canSpeak || sending}
                className="flex-1 font-mono text-sm border border-[--border] bg-[--bg] text-[--fg] px-3 py-2 focus:outline-none focus:border-[--fg] disabled:opacity-50 placeholder:text-[--fg-muted]"
              />
              <button
                onClick={speak}
                disabled={!canSpeak || sending}
                className="font-mono text-xs border border-[--fg] bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 disabled:opacity-40 transition-opacity shrink-0"
              >
                {sending ? "…" : "Parler"}
              </button>
            </div>
          )}
          {error && (
            <p className="font-mono text-xs text-red-500 mt-2">{error}</p>
          )}
          {rateCooldown && (
            <p className="font-mono text-xs text-yellow-600 mt-1">
              Rate limit — prochaine prise de parole dans {Math.ceil(rateCooldown / 60_000)} min (max 4/h)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Salon list ────────────────────────────────────────────────────────────────

function SalonList({
  salons,
  myTokenId,
  onSelect,
  onCreated,
}: {
  salons:    Salon[];
  myTokenId: number | null;
  onSelect:  (s: Salon) => void;
  onCreated: (s: Salon) => void;
}) {
  const [creating,     setCreating]     = useState(false);
  const [newName,      setNewName]      = useState("");
  const [newDesc,      setNewDesc]      = useState("");
  const [newMembers,   setNewMembers]   = useState(""); // comma-separated tokenIds
  const [createError,  setCreateError]  = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const createSalon = async () => {
    if (!myTokenId || !newName.trim()) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const members = newMembers
        .split(",")
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n > 0);

      const res = await fetch("/api/salon", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          tokenId:     myTokenId,
          name:        newName.trim(),
          description: newDesc.trim(),
          members:     members.length > 0 ? members : undefined,
        }),
      });
      const data = await res.json() as { salon?: Salon; error?: string };
      if (!res.ok || !data.salon) {
        setCreateError(data.error ?? "Erreur lors de la création");
      } else {
        onCreated(data.salon);
        setCreating(false);
        setNewName("");
        setNewDesc("");
        setNewMembers("");
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-mono text-lg font-bold">Salons</h2>
        {myTokenId && (
          <button
            onClick={() => setCreating(v => !v)}
            className="font-mono text-xs border border-[--fg] bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 transition-opacity"
          >
            {creating ? "Annuler" : "+ Nouveau salon"}
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="border border-[--border] bg-[--bg-card] p-4 mb-4 space-y-3">
          <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Créer un salon</p>
          <input
            type="text"
            placeholder="Nom du salon *"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            maxLength={60}
            className="w-full font-mono text-sm border border-[--border] bg-[--bg] text-[--fg] px-3 py-2 focus:outline-none focus:border-[--fg]"
          />
          <input
            type="text"
            placeholder="Description (optionnel)"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            maxLength={200}
            className="w-full font-mono text-sm border border-[--border] bg-[--bg] text-[--fg] px-3 py-2 focus:outline-none focus:border-[--fg]"
          />
          <input
            type="text"
            placeholder="Membres invités : tokenIds séparés par virgule (vide = ouvert à tous)"
            value={newMembers}
            onChange={e => setNewMembers(e.target.value)}
            className="w-full font-mono text-sm border border-[--border] bg-[--bg] text-[--fg] px-3 py-2 focus:outline-none focus:border-[--fg]"
          />
          {createError && <p className="font-mono text-xs text-red-500">{createError}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={createSalon}
              disabled={!newName.trim() || createLoading}
              className="font-mono text-xs border border-[--fg] bg-[--fg] text-[--bg] px-4 py-2 hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {createLoading ? "Création…" : "Créer"}
            </button>
          </div>
        </div>
      )}

      {/* Salon list */}
      {salons.length === 0 ? (
        <div className="border border-[--border] p-8 text-center">
          <p className="font-mono text-sm text-[--fg-muted]">
            Aucun salon pour l&apos;instant.
          </p>
          {myTokenId ? (
            <p className="font-mono text-xs text-[--fg-muted] mt-2">
              Crée le premier salon et invite les autres Normies.
            </p>
          ) : (
            <p className="font-mono text-xs text-[--fg-muted] mt-2">
              Sélectionne ton Normie pour créer un salon.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {salons.map(salon => {
            const lastMsg = salon.messages[salon.messages.length - 1];
            return (
              <button
                key={salon.id}
                onClick={() => onSelect(salon)}
                className="w-full text-left border border-[--border] bg-[--bg-card] hover:bg-[--bg] transition-colors p-4 flex items-start gap-3 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-bold text-[--fg] group-hover:underline">
                      {salon.name}
                    </span>
                    {!salon.isOpen && (
                      <span className="font-mono text-[10px] text-red-500 border border-red-400 px-1">
                        fermé
                      </span>
                    )}
                    {salon.members.length > 0 && (
                      <span className="font-mono text-[10px] text-yellow-600 border border-yellow-500 px-1">
                        privé
                      </span>
                    )}
                  </div>
                  {salon.description && (
                    <p className="font-mono text-xs text-[--fg-muted] truncate">{salon.description}</p>
                  )}
                  {lastMsg && (
                    <p className="font-mono text-xs text-[--fg-muted] mt-1 truncate">
                      <span className="text-[--fg]">{lastMsg.name}</span>
                      {" "}: {lastMsg.content.slice(0, 80)}
                      {lastMsg.content.length > 80 ? "…" : ""}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-[10px] text-[--fg-muted]">
                    {salon.messages.length} msgs
                  </p>
                  <p className="font-mono text-[10px] text-[--fg-muted]">
                    {timeAgo(lastMsg?.timestamp ?? salon.createdAt)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Root component ────────────────────────────────────────────────────────────

export default function SalonClient() {
  const { address } = useAccount();
  const [myTokenId, setMyTokenId] = useMyTokenId();
  const [salons,    setSalons]    = useState<Salon[]>([]);
  const [selected,  setSelected]  = useState<Salon | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [tokenInput, setTokenInput] = useState("");

  // Load salons on mount
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch("/api/salon");
        const data = await res.json() as { salons: Salon[] };
        setSalons(data.salons ?? []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  // Refresh selected salon data when going back
  const handleBack = async () => {
    try {
      const res  = await fetch("/api/salon");
      const data = await res.json() as { salons: Salon[] };
      setSalons(data.salons ?? []);
    } catch { /* ignore */ }
    setSelected(null);
  };

  const handleSalonUpdate = (updated: Salon) => {
    setSalons(prev => prev.map(s => s.id === updated.id ? updated : s));
    setSelected(updated);
  };

  const handleCreated = (s: Salon) => {
    setSalons(prev => [s, ...prev]);
    setSelected(s);
  };

  const handleSelect = async (s: Salon) => {
    // Reload full salon with all messages
    try {
      const res  = await fetch(`/api/salon/${s.id}`);
      const data = await res.json() as { salon: Salon };
      setSelected(data.salon ?? s);
    } catch {
      setSelected(s);
    }
  };

  return (
    <div className="min-h-screen bg-[--bg] text-[--fg]">
      {/* Top bar */}
      <div className="border-b border-[--border] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-base font-bold uppercase tracking-wider">
            Salon des Normies
          </h1>
          <p className="font-mono text-xs text-[--fg-muted] mt-0.5">
            Discussions privées de l&apos;ANA — observables par tous, réservées aux membres
          </p>
        </div>

        {/* Normie selector */}
        <div className="flex items-center gap-2">
          {myTokenId ? (
            <div className="flex items-center gap-2 border border-[--border] bg-[--bg-card] px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              <span className="font-mono text-xs">Normie #{myTokenId}</span>
              <button
                onClick={() => setMyTokenId(0)}
                className="font-mono text-[10px] text-[--fg-muted] hover:text-[--fg] ml-1"
              >
                changer
              </button>
            </div>
          ) : address ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Ton tokenId"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                className="font-mono text-xs border border-[--border] bg-[--bg] text-[--fg] px-2 py-1.5 w-28 focus:outline-none focus:border-[--fg]"
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const n = parseInt(tokenInput, 10);
                    if (n > 0) { setMyTokenId(n); setTokenInput(""); }
                  }
                }}
              />
              <button
                onClick={() => {
                  const n = parseInt(tokenInput, 10);
                  if (n > 0) { setMyTokenId(n); setTokenInput(""); }
                }}
                className="font-mono text-xs border border-[--fg] bg-[--fg] text-[--bg] px-3 py-1.5 hover:opacity-80 transition-opacity"
              >
                OK
              </button>
            </div>
          ) : (
            <p className="font-mono text-xs text-[--fg-muted]">Connectez votre wallet pour parler</p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`${selected ? "h-[calc(100vh-73px)] flex flex-col" : "max-w-4xl mx-auto px-6 py-8"}`}>
        {loading ? (
          <p className="font-mono text-sm text-[--fg-muted] text-center mt-8">Chargement…</p>
        ) : selected ? (
          <SalonChat
            salon={selected}
            myTokenId={myTokenId}
            onBack={handleBack}
            onSalonUpdate={handleSalonUpdate}
          />
        ) : (
          <SalonList
            salons={salons}
            myTokenId={myTokenId}
            onSelect={handleSelect}
            onCreated={handleCreated}
          />
        )}
      </div>
    </div>
  );
}
