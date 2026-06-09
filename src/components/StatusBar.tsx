// StatusBar — live stats strip
// Placeholder values until contract integration (Phase 4)

interface Stat {
  label: string;
  value: string;
  live?: boolean;
  status?: "active" | "pending" | "closed";
}

const STATS: Stat[] = [
  { label: "Membres inscrits",     value: "—",          live: false },
  { label: "Session",              value: "En attente",  live: true,  status: "pending" },
  { label: "Votes exprimés",       value: "—",          live: false },
  { label: "Œuvres publiées",      value: "0",          live: false },
  { label: "Réseau",               value: "Base",       live: false },
];

const STATUS_COLORS = {
  active:  "bg-green-500",
  pending: "bg-yellow-500",
  closed:  "bg-gray-400",
} as const;

export function StatusBar() {
  return (
    <div className="border-b border-[--border] bg-[--bg-card]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center gap-0 overflow-x-auto scrollbar-hide">
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              className={`flex items-center gap-3 py-3 px-5 shrink-0 ${
                i < STATS.length - 1 ? "border-r border-[--border]" : ""
              }`}
            >
              {/* Live indicator */}
              {stat.live && stat.status && (
                <span
                  className={`live-dot w-1.5 h-1.5 rounded-full ${STATUS_COLORS[stat.status]}`}
                />
              )}
              <span className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest whitespace-nowrap">
                {stat.label}
              </span>
              <span className="font-mono text-xs font-bold text-[--fg] whitespace-nowrap">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
