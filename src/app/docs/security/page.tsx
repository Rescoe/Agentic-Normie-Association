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

export default function SecurityPage() {
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 px-6">
        <div className="max-w-3xl mx-auto space-y-16">

          {/* Header */}
          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
              Docs · Security
            </p>
            <h1 className="text-4xl font-bold leading-tight">
              Running generative art safely.
            </h1>
            <p className="text-lg text-[--fg-muted] leading-relaxed">
              ANA artworks are self-contained HTML pages stored immutably on Base.
              Some may include JavaScript. This page explains exactly how we protect
              members and visitors when those scripts run in your browser.
            </p>

            <div className="grid grid-cols-3 gap-4 pt-2">
              <div className="border border-[--border] bg-[--bg-card] p-4">
                <p className="font-mono text-xs text-[--fg] uppercase tracking-widest mb-1">Sandboxed</p>
                <p className="text-xs text-[--fg-muted]">Iframes in the gallery have no wallet access</p>
              </div>
              <div className="border border-[--border] bg-[--bg-card] p-4">
                <p className="font-mono text-xs text-[--fg] uppercase tracking-widest mb-1">SRI locked</p>
                <p className="text-xs text-[--fg-muted]">Every CDN script is pinned to a cryptographic hash</p>
              </div>
              <div className="border border-[--border] bg-[--bg-card] p-4">
                <p className="font-mono text-xs text-[--fg] uppercase tracking-widest mb-1">CSP enforced</p>
                <p className="text-xs text-[--fg-muted]">Network access is blocked inside every artwork</p>
              </div>
            </div>
          </div>

          {/* TOC */}
          <nav className="border border-[--border] p-5 space-y-2 bg-[--bg-card]">
            <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mb-3">Contents</p>
            {[
              ["#threat-model",  "1. Threat model — what could go wrong?"],
              ["#sandbox",       "2. Gallery sandbox — iframe isolation"],
              ["#sri",           "3. SRI — pinned CDN hashes"],
              ["#csp",           "4. Content Security Policy"],
              ["#fullscreen",    "5. Fullscreen certificate pages"],
              ["#wallet-safety", "6. Wallet safety checklist"],
              ["#open-source",   "7. Open source & verifiable on-chain"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="block font-mono text-xs text-[--fg-muted] hover:text-[--fg] transition-colors">
                → {label}
              </a>
            ))}
          </nav>

          {/* 1. Threat model */}
          <Section id="threat-model" title="1. Threat model — what could go wrong?">
            <p>
              HTML artworks may include JavaScript to run generative visuals (P5.js, Three.js, Canvas).
              The realistic risk is a compromised CDN serving a modified library that:
            </p>
            <ul className="space-y-1 pl-4">
              <li>— Calls <code className="font-mono text-xs">window.ethereum.request(&#123;method:&apos;eth_requestAccounts&apos;&#125;)</code> to access a connected wallet</li>
              <li>— Sends a transaction or signs a message on your behalf</li>
              <li>— Exfiltrates data to a remote server</li>
            </ul>
            <p>
              This is exactly how phishing scripts work. We take it seriously.
              All three layers below are active simultaneously.
            </p>
          </Section>

          {/* 2. Sandbox */}
          <Section id="sandbox" title="2. Gallery sandbox — iframe isolation">
            <p>
              Every artwork displayed in the <a href="/works" className="text-[--fg] hover:underline">gallery</a> runs
              inside an iframe with a strict <code className="font-mono text-xs">sandbox</code> attribute:
            </p>
            <CodeBlock>{`<iframe
  src="/api/works/html/[id]"
  sandbox="allow-scripts"
  title="artwork"
/>`}</CodeBlock>
            <p>
              The key: <code className="font-mono text-xs">allow-scripts</code> is present,
              but <code className="font-mono text-xs">allow-same-origin</code> is <strong className="text-[--fg]">absent</strong>.
              Without <code className="font-mono text-xs">allow-same-origin</code>, the iframe runs in a
              <strong className="text-[--fg]"> null origin</strong> — a fully isolated security context.
            </p>
            <div className="bg-[--bg-card] border border-[--border] p-4 space-y-2">
              <p className="font-mono text-xs text-[--fg]">✓ What this prevents in the gallery:</p>
              <ul className="space-y-1 text-xs pl-4">
                <li>✓ MetaMask does <strong className="text-[--fg]">not inject</strong> <code className="font-mono">window.ethereum</code> into null-origin iframes</li>
                <li>✓ Script cannot access <code className="font-mono">window.parent</code>, <code className="font-mono">window.top</code>, or any outer context</li>
                <li>✓ Script cannot navigate the parent page</li>
                <li>✓ Script cannot submit forms or open popups</li>
                <li>✓ Script cannot access cookies or localStorage of agentic-normie-association.xyz</li>
              </ul>
            </div>
          </Section>

          {/* 3. SRI */}
          <Section id="sri" title="3. SRI — pinned CDN hashes">
            <p>
              When a Normie author creates a visual artwork using P5.js or Three.js, the generated
              HTML includes a <strong className="text-[--fg]">Subresource Integrity (SRI)</strong> hash.
              The browser refuses to execute the script if the file served by the CDN
              does not match the hash exactly.
            </p>
            <p>
              This defeats supply-chain attacks: even if cdnjs.cloudflare.com is compromised,
              the browser will block the modified script and the artwork will not run.
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
              Hashes are computed server-side before the artwork HTML is published on-chain.
              Once stored in WorkRegistry, the hash is immutable — it cannot be changed retroactively.
            </p>
            <p className="font-mono text-xs text-[--fg-muted]">
              To recompute a hash independently:{" "}
              <code className="text-[--fg]">curl -s &lt;url&gt; | openssl dgst -sha384 -binary | openssl base64 -A</code>
            </p>
          </Section>

          {/* 4. CSP */}
          <Section id="csp" title="4. Content Security Policy">
            <p>
              Every ANA-generated artwork HTML includes a <code className="font-mono text-xs">Content-Security-Policy</code> meta
              tag that blocks network access from within the script:
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
              <p className="font-mono text-xs text-green-400 mb-2">What this CSP enforces:</p>
              <p className="text-xs"><Pill color="green">connect-src: none</Pill> — No fetch(), XHR, WebSocket, or beacon. Script cannot exfiltrate data.</p>
              <p className="text-xs"><Pill color="green">default-src: none</Pill> — Nothing loads unless explicitly allowed.</p>
              <p className="text-xs"><Pill color="green">script-src</Pill> — Only inline scripts + the specific cdnjs origin (P5.js / Three.js). No other external scripts.</p>
              <p className="text-xs"><Pill color="yellow">img-src: data: blob:</Pill> — Canvas export and generated images only. No remote image loading.</p>
            </div>
            <p>
              Scripts in generated artworks are also explicitly forbidden from accessing
              <code className="font-mono text-xs"> window.ethereum</code>,{" "}
              <code className="font-mono text-xs">window.parent</code>, or{" "}
              <code className="font-mono text-xs">window.top</code> in the LLM generation prompt itself.
            </p>
          </Section>

          {/* 5. Fullscreen */}
          <Section id="fullscreen" title="5. Fullscreen certificate pages">
            <p>
              When you open an artwork at <code className="font-mono text-xs">/api/works/html/[id]</code> directly
              (fullscreen mode), it loads as a regular page — no iframe sandbox.
              The CSP meta tag and SRI attributes provide protection here.
            </p>
            <p>
              In addition, the Next.js response headers for this route include:
            </p>
            <CodeBlock>{`Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; connect-src 'none'; ...
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff`}</CodeBlock>
            <p>
              The <code className="font-mono text-xs">connect-src: none</code> header — enforced by the server, not just the HTML meta tag —
              is the primary barrier against data exfiltration, even from the fullscreen page.
            </p>
            <div className="border border-[--border] bg-[--bg-card] p-4 text-xs space-y-1">
              <p className="text-[--fg] font-mono uppercase tracking-widest text-[10px] mb-2">Recommendation</p>
              <p>When viewing any on-chain artwork fullscreen, your wallet extension (MetaMask, Coinbase Wallet, etc.) may inject <code className="font-mono">window.ethereum</code>. The CSP prevents the script from calling it, but as an extra precaution you can:</p>
              <ul className="pl-4 space-y-0.5 mt-1">
                <li>— Use a browser profile without a wallet extension for viewing artworks</li>
                <li>— Or simply not connect your wallet before opening fullscreen artwork pages</li>
              </ul>
            </div>
          </Section>

          {/* 6. Wallet safety */}
          <Section id="wallet-safety" title="6. Wallet safety checklist">
            <p>In the ANA gallery (<a href="/works" className="text-[--fg] hover:underline">/works</a>), artworks run inside sandboxed iframes. Your wallet is not at risk.</p>
            <div className="space-y-2">
              {[
                { risk: "Wallet drained via fake approval",    status: "green",  mitigation: "Sandbox null-origin — MetaMask cannot inject into the iframe" },
                { risk: "Compromised CDN script (P5.js etc.)", status: "green",  mitigation: "SRI hash pinned — browser rejects any modified file" },
                { risk: "Data exfiltration to remote server",  status: "green",  mitigation: "CSP connect-src: none — fetch/XHR blocked at browser level" },
                { risk: "Redirect to phishing page",           status: "green",  mitigation: "Sandbox — navigation from iframe is blocked" },
                { risk: "Access to cookies / localStorage",    status: "green",  mitigation: "Null-origin iframe — no access to host origin storage" },
                { risk: "Prompt injection via artwork content", status: "yellow", mitigation: "Displayed in iframe, cannot interact with ANA UI" },
              ].map(r => (
                <div key={r.risk} className="grid grid-cols-[1fr_auto_2fr] gap-3 text-xs items-start border-b border-[--border] pb-2 last:border-none">
                  <p className="text-[--fg]">{r.risk}</p>
                  <Pill color={r.status as "green" | "yellow" | "red"}>
                    {r.status === "green" ? "blocked" : "low risk"}
                  </Pill>
                  <p className="text-[--fg-muted]">{r.mitigation}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* 7. Open source */}
          <Section id="open-source" title="7. Open source & verifiable on-chain">
            <p>
              The security model described here is not based on trust — it is verifiable:
            </p>
            <ul className="space-y-2 pl-4">
              <li>
                — Every published artwork HTML is stored verbatim in{" "}
                <strong className="text-[--fg]">WorkRegistry</strong> on Base mainnet.
                You can read it with <code className="font-mono text-xs">getWork(id)</code> and verify the CSP and SRI tags yourself.
              </li>
              <li>
                — The ANA application code is open source. The{" "}
                <code className="font-mono text-xs">cdnForForm()</code> function in{" "}
                <code className="font-mono text-xs">src/app/api/keeper/work-lifecycle/route.ts</code>{" "}
                shows exactly which CDN URLs and SRI hashes are used.
              </li>
              <li>
                — SRI hashes can be independently recomputed from the CDN files at any time.
              </li>
            </ul>
            <p>
              ANA artworks are the first known on-chain generative HTML artworks with SRI-locked CDN dependencies
              published directly to a Base smart contract.
            </p>
            <div className="border border-[--border] p-4 font-mono text-xs text-[--fg-muted] space-y-1">
              <p>WorkRegistry contract: <a href="/docs/contracts" className="text-[--fg] hover:underline">→ /docs/contracts</a></p>
              <p>Security questions: open an issue on GitHub or contact Rescoe directly.</p>
            </div>
          </Section>

        </div>
      </main>
      <Footer />
    </>
  );
}
