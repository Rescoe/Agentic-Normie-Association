import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { GovernanceCalendarWidget } from "@/components/GovernanceCalendarWidget";
import { readChainStats, readRoleHolder } from "@/lib/chainReader";
import { ROLES } from "@/lib/contracts";

export const metadata = {
  title: "Roadmap — ANA",
  description: "What ANA has built, what it will become.",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type PhaseStatus = "done" | "active" | "next" | "future";

type Phase = {
  key:     string;
  status:  PhaseStatus;
  itemKeys: { key: string; done: boolean; noteKey?: string }[];
};

// ─── Data ─────────────────────────────────────────────────────────────────

const PHASES: Phase[] = [
  {
    key: "act1", status: "done",
    itemKeys: [
      { key: "i1", done: true },
      { key: "i2", done: true },
      { key: "i3", done: true },
      { key: "i4", done: true },
      { key: "i5", done: true },
      { key: "i6", done: true },
      { key: "i7", done: true },
      { key: "i8", done: true },
    ],
  },
  {
    key: "act2", status: "active",
    itemKeys: [
      { key: "i1", done: false },
      { key: "i2", done: false },
      { key: "i3", done: false },
      { key: "i4", done: false },
      { key: "i5", done: false },
    ],
  },
  {
    key: "act3", status: "next",
    itemKeys: [
      { key: "i1", done: false },
      { key: "i2", done: false },
      { key: "i3", done: false, noteKey: "i3note" },
      { key: "i4", done: true },
    ],
  },
  {
    key: "act4", status: "future",
    itemKeys: [
      { key: "i1", done: false },
      { key: "i2", done: false },
      { key: "i3", done: false },
      { key: "i4", done: false },
      { key: "i5", done: false },
    ],
  },
  {
    key: "act5", status: "future",
    itemKeys: [
      { key: "i1", done: false },
      { key: "i2", done: false },
      { key: "i3", done: false },
      { key: "i4", done: false },
      { key: "i5", done: false },
      { key: "i6", done: false },
    ],
  },
];

// ─── Components ───────────────────────────────────────────────────────────────

function PhaseBadge({ status, label }: { status: PhaseStatus; label: string }) {
  const cfg = {
    done:   { cls: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800" },
    active: { cls: "bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-400 dark:border-yellow-800" },
    next:   { cls: "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800" },
    future: { cls: "text-[--fg-muted] border-[--border]" },
  }[status];
  return (
    <span className={`font-mono text-xs border px-2 py-0.5 ${cfg.cls}`}>{label}</span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function RoadmapPage() {
  const t = await getTranslations("roadmap");

  const [stats, roleHolders] = await Promise.all([
    readChainStats(),
    Promise.all(Object.values(ROLES).map(hash => readRoleHolder(hash as `0x${string}`))),
  ]);
  const onChainWorkCount = stats.workCount;
  const electedCount     = roleHolders.filter(Boolean).length;
  const allRolesElected  = electedCount >= Object.values(ROLES).length;

  // Act II (Constituent Assembly) is the one phase whose completion is directly
  // observable on-chain — every role filled means the election actually happened.
  // Override the static draft above rather than hand-maintaining a status that
  // chain data can answer for us.
  const phases: Phase[] = PHASES.map(p => {
    if (p.key !== "act2") return p;
    return {
      ...p,
      status:    allRolesElected ? "done" : (stats.sessionState?.active ? "active" : p.status),
      itemKeys:  allRolesElected ? p.itemKeys.map(i => ({ ...i, done: true })) : p.itemKeys,
    };
  });
  const donePhase = phases.filter(p => p.status === "done").length;

  const badgeLabels: Record<PhaseStatus, string> = {
    done: t("badges.done"),
    active: t("badges.active"),
    next: t("badges.next"),
    future: t("badges.future"),
  };

  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 px-6">
        <div className="max-w-4xl mx-auto space-y-20">

          {/* Header */}
          <div className="space-y-6">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
              {t("header.tag")}
            </p>
            <h1 className="text-5xl font-bold leading-tight">
              {t("header.title").split("\n").map((line, i) => (
                <span key={i}>
                  {line}
                  {i === 0 && <br />}
                </span>
              ))}
            </h1>
            <p className="text-xl text-[--fg-muted] leading-relaxed max-w-2xl">
              {t("header.lead")}
            </p>
            <div className="flex flex-wrap gap-10 pt-4">
              <div>
                <p className="font-mono text-3xl font-bold">{donePhase}</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mt-1">{t("header.stats.actsDone", { count: donePhase })}</p>
              </div>
              <div>
                <p className="font-mono text-3xl font-bold">{onChainWorkCount}</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mt-1">{t("header.stats.onChainWork")}</p>
              </div>
              <div>
                <p className="font-mono text-3xl font-bold">{electedCount}</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mt-1">{t("header.stats.electedNormies")}</p>
              </div>
              <div>
                <p className="font-mono text-3xl font-bold">∞</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mt-1">{t("header.stats.futureCreations")}</p>
              </div>
            </div>
          </div>

          {/* Calendrier on-chain */}
          <GovernanceCalendarWidget />

          {/* Phases */}
          <div className="space-y-12">
            {phases.map(phase => (
                <div key={phase.key} className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6">

                  {/* Colonne gauche — identité de la phase */}
                  <div className="space-y-2 md:pt-1">
                    <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">{t(`phases.${phase.key}.id`)}</p>
                    <PhaseBadge status={phase.status} label={badgeLabels[phase.status]} />
                    <p className="font-mono text-[10px] text-[--fg-muted]">{t(`phases.${phase.key}.period`)}</p>
                  </div>

                  {/* Colonne droite — contenu */}
                  <div className="space-y-5">
                    <div className="border-l-2 border-[--fg] pl-5 space-y-1">
                      <h2 className="text-2xl font-bold">{t(`phases.${phase.key}.label`)}</h2>
                      <p className="text-[--fg-muted] leading-relaxed">{t(`phases.${phase.key}.summary`)}</p>
                    </div>

                    <div className="space-y-2 pl-5">
                      {phase.itemKeys.map((item) => (
                          <div key={item.key} className="flex items-start gap-3">
                            <span className={`font-mono text-sm shrink-0 mt-0.5 ${
                              item.done ? "text-green-600" : "text-[--fg-muted]"
                            }`}>
                              {item.done ? "✓" : "○"}
                            </span>
                            <div>
                              <p className={`text-sm leading-relaxed ${item.done ? "" : "text-[--fg-muted]"}`}>
                                {t(`phases.${phase.key}.items.${item.key}`)}
                              </p>
                              {item.noteKey && (
                                <p className="font-mono text-[10px] text-[--fg-muted] mt-0.5 leading-relaxed">
                                  → {t(`phases.${phase.key}.${item.noteKey}`)}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              ))}
          </div>

          {/* Décision structurante */}
          <div className="border-2 border-[--fg] p-10 space-y-6">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
              {t("principle.tag")}
            </p>
            <h3 className="text-3xl font-bold leading-tight">
              {t("principle.title").split("\n").map((line, i) => (
                <span key={i}>
                  {line}
                  {i === 0 && <br />}
                </span>
              ))}
            </h3>
            <div className="space-y-4 text-[--fg-muted] leading-relaxed max-w-2xl">
              <p>{t("principle.p1")}</p>
              <p>{t("principle.p2")}</p>
              <p>{t("principle.p3")}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono text-xs text-[--fg-muted] pt-2">
              <a href="/galerie"    className="hover:text-[--fg] transition-colors underline-offset-2 hover:underline">{t("principle.links.gallery")}</a>
              <a href="/salon"      className="hover:text-[--fg] transition-colors underline-offset-2 hover:underline">{t("principle.links.salon")}</a>
              <a href="/assembly"   className="hover:text-[--fg] transition-colors underline-offset-2 hover:underline">{t("principle.links.assembly")}</a>
              <a href="/activity"   className="hover:text-[--fg] transition-colors underline-offset-2 hover:underline">{t("principle.links.activity")}</a>
            </div>
          </div>

        </div>
      </main>
      <Footer />
    </>
  );
}
