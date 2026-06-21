import { getTranslations } from "next-intl/server";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "Security — ANA",
  description: "How ANA protects members and their wallets when running on-chain generative artworks.",
};

// ─── Section helper ───────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-4 scroll-mt-28">
      <h2 className="text-xl font-bold border-b border-[--border] pb-2">{title}</h2>
      <div className="space-y-3 text-[--fg-muted] leading-relaxed">{children}</div>
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-[--bg-card] border border-[--border] p-4 overflow-x-auto font-mono text-xs text-[--fg-muted] leading-relaxed whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function Pill({ color, children }: { color: "green" | "yellow" | "red"; children: React.ReactNode }) {
  const cls = {
    green:  "text-[--fg] border-[--fg]",
    yellow: "text-[--fg-muted] border-[--border]",
    red:    "text-[--fg-muted] border-[--border]",
  }[color];
  return (
    <span className={`font-mono text-xs border px-2 py-0.5 inline-block ${cls}`}>{children}</span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SecurityPage() {
  const t = await getTranslations("docsSecurity");

  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 px-6">
        <div className="max-w-3xl mx-auto space-y-16">

          {/* Header */}
          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
              {t("breadcrumb")}
            </p>
            <h1 className="text-4xl font-bold leading-tight">
              {t("title")}
            </h1>
            <p className="text-lg text-[--fg-muted] leading-relaxed">
              {t("intro")}
            </p>

            <div className="grid grid-cols-3 gap-4 pt-2">
              <div className="border border-[--border] bg-[--bg-card] p-4">
                <p className="font-mono text-xs text-[--fg] uppercase tracking-widest mb-1">{t("badges.sandboxed.title")}</p>
                <p className="text-xs text-[--fg-muted]">{t("badges.sandboxed.desc")}</p>
              </div>
              <div className="border border-[--border] bg-[--bg-card] p-4">
                <p className="font-mono text-xs text-[--fg] uppercase tracking-widest mb-1">{t("badges.sriLocked.title")}</p>
                <p className="text-xs text-[--fg-muted]">{t("badges.sriLocked.desc")}</p>
              </div>
              <div className="border border-[--border] bg-[--bg-card] p-4">
                <p className="font-mono text-xs text-[--fg] uppercase tracking-widest mb-1">{t("badges.cspEnforced.title")}</p>
                <p className="text-xs text-[--fg-muted]">{t("badges.cspEnforced.desc")}</p>
              </div>
            </div>
          </div>

          {/* TOC */}
          <nav className="border border-[--border] p-5 space-y-2 bg-[--bg-card]">
            <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mb-3">{t("toc.heading")}</p>
            {[
              ["#threat-model",  t("toc.threatModel")],
              ["#sandbox",       t("toc.sandbox")],
              ["#sri",           t("toc.sri")],
              ["#csp",           t("toc.csp")],
              ["#fullscreen",    t("toc.fullscreen")],
              ["#wallet-safety", t("toc.walletSafety")],
              ["#open-source",   t("toc.openSource")],
            ].map(([href, label]) => (
              <a key={href} href={href} className="block font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors">
                → {label}
              </a>
            ))}
          </nav>

          {/* 1. Threat model */}
          <Section id="threat-model" title={t("sections.threatModel.title")}>
            <p>
              {t("sections.threatModel.intro")}
            </p>
            <ul className="space-y-1 pl-4">
              <li>— {t("sections.threatModel.risk1.prefix")} <code className="font-mono text-xs">window.ethereum.request(&#123;method:&apos;eth_requestAccounts&apos;&#125;)</code> {t("sections.threatModel.risk1.suffix")}</li>
              <li>— {t("sections.threatModel.risk2")}</li>
              <li>— {t("sections.threatModel.risk3")}</li>
            </ul>
            <p>
              {t("sections.threatModel.outro")}
            </p>
          </Section>

          {/* 2. Sandbox */}
          <Section id="sandbox" title={t("sections.sandbox.title")}>
            <p>
              {t("sections.sandbox.intro.prefix")} <a href="/galerie" className="text-[--fg] hover:underline">{t("sections.sandbox.intro.galleryLink")}</a> {t("sections.sandbox.intro.middle")} <code className="font-mono text-xs">sandbox</code> {t("sections.sandbox.intro.suffix")}
            </p>
            <CodeBlock>{`<iframe
  src="/api/works/html/[id]"
  sandbox="allow-scripts"
  title="artwork"
/>`}</CodeBlock>
            <p>
              {t("sections.sandbox.keyExplanation.prefix")} <code className="font-mono text-xs">allow-scripts</code> {t("sections.sandbox.keyExplanation.middle")} <code className="font-mono text-xs">allow-same-origin</code> {t("sections.sandbox.keyExplanation.isAbsent")} <strong className="text-[--fg]">{t("sections.sandbox.keyExplanation.absent")}</strong>.
              {" "}{t("sections.sandbox.keyExplanation.without")} <code className="font-mono text-xs">allow-same-origin</code>{t("sections.sandbox.keyExplanation.runsIn")}
              <strong className="text-[--fg]"> {t("sections.sandbox.keyExplanation.nullOrigin")}</strong> {t("sections.sandbox.keyExplanation.isolatedContext")}
            </p>
            <div className="bg-[--bg-card] border border-[--border] p-4 space-y-2">
              <p className="font-mono text-xs text-[--fg]">✓ {t("sections.sandbox.preventsHeading")}</p>
              <ul className="space-y-1 text-xs pl-4">
                <li>✓ {t("sections.sandbox.prevents.metamask.prefix")} <strong className="text-[--fg]">{t("sections.sandbox.prevents.metamask.notInject")}</strong> <code className="font-mono">window.ethereum</code> {t("sections.sandbox.prevents.metamask.suffix")}</li>
                <li>✓ {t("sections.sandbox.prevents.noParentAccess.prefix")} <code className="font-mono">window.parent</code>, <code className="font-mono">window.top</code>{t("sections.sandbox.prevents.noParentAccess.suffix")}</li>
                <li>✓ {t("sections.sandbox.prevents.noNavigate")}</li>
                <li>✓ {t("sections.sandbox.prevents.noFormsPopups")}</li>
                <li>✓ {t("sections.sandbox.prevents.noStorageAccess")}</li>
              </ul>
            </div>
          </Section>

          {/* 3. SRI */}
          <Section id="sri" title={t("sections.sri.title")}>
            <p>
              {t("sections.sri.intro.prefix")} <strong className="text-[--fg]">{t("sections.sri.intro.sriTerm")}</strong> {t("sections.sri.intro.suffix")}
            </p>
            <p>
              {t("sections.sri.defeats")}
            </p>
            <CodeBlock>{`<!-- P5.js 1.9.4 — hash verified 2026-06-17 -->
<script
  src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"
  integrity="sha384-6Twx1hAeKnwfOYJAHtYeJETRiGD5pRPkjjh0pVbG1QoesncjOpw5e75Y1kOkXeRI"
  crossorigin="anonymous"
></script>

<!-- Three.js r128 — hash verified 2026-06-17 -->
<script
  src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"
  integrity="sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu"
  crossorigin="anonymous"
></script>`}</CodeBlock>
            <p>
              {t("sections.sri.computed")}
            </p>
            <p className="font-mono text-xs text-[--fg-muted]">
              {t("sections.sri.recompute")}{" "}
              <code className="text-[--fg]">curl -s &lt;url&gt; | openssl dgst -sha384 -binary | openssl base64 -A</code>
            </p>
          </Section>

          {/* 4. CSP */}
          <Section id="csp" title={t("sections.csp.title")}>
            <p>
              {t("sections.csp.intro.prefix")} <code className="font-mono text-xs">Content-Security-Policy</code> {t("sections.csp.intro.suffix")}
            </p>
            <CodeBlock>{`<meta
  http-equiv="Content-Security-Policy"
  content="
    default-src 'none';
    script-src  'unsafe-inline' https://cdnjs.cloudflare.com;
    style-src   'unsafe-inline';
    img-src     data: blob:;
    connect-src 'none';
  "
/>`}</CodeBlock>
            <div className="bg-[--bg-card] border border-[--border] p-4 space-y-1">
              <p className="font-mono text-xs text-green-400 mb-2">{t("sections.csp.enforcesHeading")}</p>
              <p className="text-xs"><Pill color="green">connect-src: none</Pill> — {t("sections.csp.connectSrc")}</p>
              <p className="text-xs"><Pill color="green">default-src: none</Pill> — {t("sections.csp.defaultSrc")}</p>
              <p className="text-xs"><Pill color="green">script-src</Pill> — {t("sections.csp.scriptSrc")}</p>
              <p className="text-xs"><Pill color="yellow">img-src: data: blob:</Pill> — {t("sections.csp.imgSrc")}</p>
            </div>
            <p>
              {t("sections.csp.forbidden.prefix")}
              <code className="font-mono text-xs"> window.ethereum</code>,{" "}
              <code className="font-mono text-xs">window.parent</code>, {t("sections.csp.forbidden.or")}{" "}
              <code className="font-mono text-xs">window.top</code> {t("sections.csp.forbidden.suffix")}
            </p>
          </Section>

          {/* 5. Fullscreen */}
          <Section id="fullscreen" title={t("sections.fullscreen.title")}>
            <p>
              {t("sections.fullscreen.intro.prefix")} <code className="font-mono text-xs">/api/works/html/[id]</code> {t("sections.fullscreen.intro.suffix")}
            </p>
            <p>
              {t("sections.fullscreen.headers")}
            </p>
            <CodeBlock>{`Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; connect-src 'none'; ...
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff`}</CodeBlock>
            <p>
              {t("sections.fullscreen.barrier.prefix")} <code className="font-mono text-xs">connect-src: none</code> {t("sections.fullscreen.barrier.suffix")}
            </p>
            <div className="border border-[--border] bg-[--bg-card] p-4 text-xs space-y-1">
              <p className="text-[--fg] font-mono uppercase tracking-widest text-[10px] mb-2">{t("sections.fullscreen.recommendation.heading")}</p>
              <p>{t("sections.fullscreen.recommendation.body.prefix")} <code className="font-mono">window.ethereum</code>{t("sections.fullscreen.recommendation.body.suffix")}</p>
              <ul className="pl-4 space-y-0.5 mt-1">
                <li>— {t("sections.fullscreen.recommendation.option1")}</li>
                <li>— {t("sections.fullscreen.recommendation.option2")}</li>
              </ul>
            </div>
          </Section>

          {/* 6. Wallet safety */}
          <Section id="wallet-safety" title={t("sections.walletSafety.title")}>
            <p>{t("sections.walletSafety.intro.prefix")} (<a href="/galerie" className="text-[--fg] hover:underline">/galerie</a>), {t("sections.walletSafety.intro.suffix")}</p>
            <div className="space-y-2">
              {[
                { risk: t("sections.walletSafety.risks.drained.risk"),        status: "green",  mitigation: t("sections.walletSafety.risks.drained.mitigation") },
                { risk: t("sections.walletSafety.risks.compromisedCdn.risk"), status: "green",  mitigation: t("sections.walletSafety.risks.compromisedCdn.mitigation") },
                { risk: t("sections.walletSafety.risks.exfiltration.risk"),  status: "green",  mitigation: t("sections.walletSafety.risks.exfiltration.mitigation") },
                { risk: t("sections.walletSafety.risks.phishingRedirect.risk"),           status: "green",  mitigation: t("sections.walletSafety.risks.phishingRedirect.mitigation") },
                { risk: t("sections.walletSafety.risks.cookieAccess.risk"),    status: "green",  mitigation: t("sections.walletSafety.risks.cookieAccess.mitigation") },
                { risk: t("sections.walletSafety.risks.promptInjection.risk"), status: "yellow", mitigation: t("sections.walletSafety.risks.promptInjection.mitigation") },
              ].map(r => (
                <div key={r.risk} className="grid grid-cols-[1fr_auto_2fr] gap-3 text-xs items-start border-b border-[--border] pb-2 last:border-none">
                  <p className="text-[--fg]">{r.risk}</p>
                  <Pill color={r.status as "green" | "yellow" | "red"}>
                    {r.status === "green" ? t("sections.walletSafety.statusBlocked") : t("sections.walletSafety.statusLowRisk")}
                  </Pill>
                  <p className="text-[--fg-muted]">{r.mitigation}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* 7. Open source */}
          <Section id="open-source" title={t("sections.openSource.title")}>
            <p>
              {t("sections.openSource.intro")}
            </p>
            <ul className="space-y-2 pl-4">
              <li>
                — {t("sections.openSource.point1.prefix")}{" "}
                <strong className="text-[--fg]">WorkRegistry</strong> {t("sections.openSource.point1.middle")}
                {" "}{t("sections.openSource.point1.suffixPrefix")} <code className="font-mono text-xs">getWork(id)</code> {t("sections.openSource.point1.suffix")}
              </li>
              <li>
                — {t("sections.openSource.point2.prefix")}{" "}
                <code className="font-mono text-xs">cdnForForm()</code> {t("sections.openSource.point2.middle")}{" "}
                <code className="font-mono text-xs">src/app/api/keeper/work-lifecycle/route.ts</code>{" "}
                {t("sections.openSource.point2.suffix")}
              </li>
              <li>
                — {t("sections.openSource.point3")}
              </li>
            </ul>
            <p>
              {t("sections.openSource.outro")}
            </p>
            <div className="border border-[--border] p-4 font-mono text-xs text-[--fg-muted] space-y-1">
              <p>{t("sections.openSource.contractLine")} <a href="/docs/contracts" className="text-[--fg] hover:underline">→ /docs/contracts</a></p>
              <p>{t("sections.openSource.securityQuestions")}</p>
            </div>
          </Section>

        </div>
      </main>
      <Footer />
    </>
  );
}
