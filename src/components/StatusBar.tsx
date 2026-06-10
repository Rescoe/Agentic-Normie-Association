/**
 * StatusBar — bande de stats live en haut du site.
 * Server Component : lit les données on-chain directement.
 * Fallback gracieux si les contrats ne sont pas déployés.
 */

import { readChainStats } from "@/lib/chainReader";

export async function StatusBar() {
  const stats = await readChainStats();

  const sessionLabel = !stats.deployed
    ? "Pré-lancement"
    : stats.sessionState?.active
    ? "Session ouverte"
    : stats.sessionState?.resolved
    ? "Session clôturée"
    : "En attente";

  const sessionStatus = !stats.deployed
    ? "pending"
    : stats.sessionState?.active
    ? "active"
    : "pending";

  const STATUS_COLORS = {
    active:  "bg-green-500",
    pending: "bg-yellow-500",
    closed:  "bg-gray-400",
  } as const;

  const items = [
    {
      label: "Membres inscrits",
      value: stats.deployed ? String(stats.memberCount) : "—",
      dot: false,
    },
    {
      label: "Session",
      value: sessionLabel,
      dot: true,
      dotColor: STATUS_COLORS[sessionStatus],
    },
    {
      label: "Œuvres publiées",
      value: stats.deployed ? String(stats.workCount) : "—",
      dot: false,
    },
    {
      label: "Réseau",
      value: process.env.NEXT_PUBLIC_CHAIN === "base" ? "Base" : "Base Sepolia",
      dot: false,
    },
    {
      label: "Phase",
      value: stats.sessionState?.resolved
        ? "Rôles attribués"
        : stats.sessionState?.active
        ? "Assemblée constituante"
        : "Inscription",
      dot: false,
    },
  ];

  return (
    <div className="border-b border-[--border] bg-[--bg-card]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center gap-0 overflow-x-auto">
          {items.map((item, i) => (
            <div
              key={item.label}
              className={`flex items-center gap-3 py-3 px-5 shrink-0 ${
                i < items.length - 1 ? "border-r border-[--border]" : ""
              }`}
            >
              {item.dot && (
                <span className={`live-dot w-1.5 h-1.5 rounded-full ${item.dotColor}`} />
              )}
              <span className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest whitespace-nowrap">
                {item.label}
              </span>
              <span className="font-mono text-xs font-bold text-[--fg] whitespace-nowrap">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
