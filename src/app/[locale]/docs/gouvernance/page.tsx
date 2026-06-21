import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Technical Governance — ANA Documentation",
  description: "Technical detail on voting sessions, roles, and ANA's on-chain governance.",
};

function getSteps(t: Awaited<ReturnType<typeof getTranslations>>) {
  return [
  {
    n:     "01",
    title: t("steps.registration.title"),
    tech:  "register(attestation, sig)",
    detail: t("steps.registration.detail"),
    impl:  t("steps.registration.impl"),
  },
  {
    n:     "02",
    title: t("steps.sessionOpening.title"),
    tech:  "openSession()",
    detail: t("steps.sessionOpening.detail"),
    impl:  t("steps.sessionOpening.impl"),
  },
  {
    n:     "03",
    title: t("steps.vote.title"),
    tech:  "castVote(voterTokenId, role, candidateTokenId)",
    detail: t("steps.vote.detail"),
    impl:  t("steps.vote.impl"),
  },
  {
    n:     "04",
    title: t("steps.closing.title"),
    tech:  "closeSession()",
    detail: t("steps.closing.detail"),
    impl:  t("steps.closing.impl"),
  },
  {
    n:     "05",
    title: t("steps.creativeCycle.title"),
    tech:  "WorkRegistry.publish()",
    detail: t("steps.creativeCycle.detail"),
    impl:  t("steps.creativeCycle.impl"),
  },
  ];
}

function getRoles(t: Awaited<ReturnType<typeof getTranslations>>) {
  return [
  {
    role:  "PRESIDENT",
    title: t("roles.president.title"),
    hash:  "keccak256('PRESIDENT')",
    desc:  t("roles.president.desc"),
  },
  {
    role:  "VICE_PRESIDENT",
    title: t("roles.vicePresident.title"),
    hash:  "keccak256('VICE_PRESIDENT')",
    desc:  t("roles.vicePresident.desc"),
  },
  {
    role:  "SECRETARY",
    title: t("roles.secretary.title"),
    hash:  "keccak256('SECRETARY')",
    desc:  t("roles.secretary.desc"),
  },
  {
    role:  "AUTHOR",
    title: t("roles.author.title"),
    hash:  "keccak256('AUTHOR')",
    desc:  t("roles.author.desc"),
  },
  {
    role:  "CURATOR",
    title: t("roles.curator.title"),
    hash:  "keccak256('CURATOR')",
    desc:  t("roles.curator.desc"),
  },
  {
    role:  "RAPPORTEUR",
    title: t("roles.rapporteur.title"),
    hash:  "keccak256('RAPPORTEUR')",
    desc:  t("roles.rapporteur.desc"),
  },
  ];
}

function getInvariants(t: Awaited<ReturnType<typeof getTranslations>>) {
  return [
  {
    title: t("invariants.tokenIdMember.title"),
    body:  t("invariants.tokenIdMember.body"),
  },
  {
    title: t("invariants.noRevocation.title"),
    body:  t("invariants.noRevocation.body"),
  },
  {
    title: t("invariants.deterministicResolution.title"),
    body:  t("invariants.deterministicResolution.body"),
  },
  {
    title: t("invariants.registeredCandidate.title"),
    body:  t("invariants.registeredCandidate.body"),
  },
  ];
}

export default async function DocsGovernancePage() {
  const t = await getTranslations("docsGouvernance");
  const STEPS = getSteps(t);
  const ROLES = getRoles(t);
  const INVARIANTS = getInvariants(t);

  return (
    <div className="space-y-16">
      {/* Header */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-3">{t("eyebrow")}</p>
        <h1 className="text-3xl font-bold leading-tight mb-4">
          {t("title")}
        </h1>
        <p className="text-[--fg-muted] leading-relaxed text-sm max-w-2xl">
          {t("intro")}
        </p>
      </div>

      {/* Process steps */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          {t("stepsHeading")}
        </p>
        {STEPS.map(step => (
          <div key={step.n} className="border border-[--border] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-[--bg-card] border-b border-[--border]">
              <span className="font-mono text-[10px] text-[--fg-muted]">{step.n}</span>
              <span className="font-mono text-sm font-bold">{step.title}</span>
              <code className="font-mono text-[11px] text-[--fg-muted] ml-auto">{step.tech}</code>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <p className="text-sm text-[--fg-muted] leading-relaxed">{step.detail}</p>
              <p className="font-mono text-[11px] text-[--fg-muted] leading-relaxed bg-[--bg-card] border border-[--border] p-3">
                {step.impl}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Roles */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          {t("rolesHeading")}
        </p>
        <div className="space-y-2">
          {ROLES.map(r => (
            <div key={r.role} className="border border-[--border] px-4 py-3 grid grid-cols-1 md:grid-cols-[120px_1fr] gap-4">
              <div>
                <p className="font-mono text-xs font-bold">{r.title}</p>
                <code className="font-mono text-[10px] text-[--fg-muted]">{r.role}</code>
              </div>
              <p className="text-sm text-[--fg-muted] leading-relaxed">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Invariants */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          {t("invariantsHeading")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {INVARIANTS.map(inv => (
            <div key={inv.title} className="border border-[--border] p-4 space-y-2">
              <p className="font-mono text-xs font-bold">{inv.title}</p>
              <p className="text-sm text-[--fg-muted] leading-relaxed">{inv.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Cross-chain constraint */}
      <div className="border border-[--border] bg-[--bg-card] p-5 space-y-4">
        <p className="font-mono text-xs font-bold">{t("crossChain.heading")}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <p className="font-mono text-[10px] text-[--fg-muted] uppercase">{t("crossChain.conceptualModel.heading")}</p>
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              {t("crossChain.conceptualModel.body")} <strong>{t("crossChain.conceptualModel.emphasis")}</strong>
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[10px] text-[--fg-muted] uppercase">{t("crossChain.mvpImplementation.heading")}</p>
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              {t("crossChain.mvpImplementation.body")}
            </p>
            <p className="font-mono text-[10px] text-[--fg-muted] border-l border-[--border] pl-3">
              {t("crossChain.mvpImplementation.resolution")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
