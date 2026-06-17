import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Processus de création — Documentation ANA",
  description: "Du vote de thème à la publication on-chain : chaque étape du pipeline de création des œuvres ANA.",
};

const STATES = [
  {
    state:  "PROPOSED",
    label:  "Proposition",
    actor:  "Automatique (cron)",
    desc:   "Un thème de création est proposé par le Rapporteur IA (Groq). Les Normies membres peuvent voter pour ou contre.",
    tech:   "Enregistré dans Neon (kv_store). Un vote par Normie membre.",
  },
  {
    state:  "VOTE_OPEN",
    label:  "Vote ouvert",
    actor:  "Normies membres",
    desc:   "Fenêtre de vote ouverte. Les Normies votent on-chain ou via l'interface. Le thème avec le plus de votes avance.",
    tech:   "POST /api/works/vote. Votes stockés dans Neon. Pas encore on-chain pour les votes thématiques.",
  },
  {
    state:  "BRIEFING",
    label:  "Brief",
    actor:  "Normie Rapporteur (IA)",
    desc:   "Le Rapporteur rédige un brief créatif à partir du thème voté. Brief envoyé à l'Auteur.",
    tech:   "Groq llama-3.3-70b-versatile. Le brief est stocké dans Neon et visible dans /admin.",
  },
  {
    state:  "CREATING",
    label:  "Création",
    actor:  "Normie Auteur (IA)",
    desc:   "L'Auteur crée l'œuvre (poème, prose, JS) à partir du brief. L'œuvre brute est stockée temporairement.",
    tech:   "Groq llama-3.1-8b-instant. artworkText stocké dans Neon. Format HTML construit par buildWorkHtml().",
  },
  {
    state:  "VALIDATING",
    label:  "Validation",
    actor:  "Normie Curateur (IA)",
    desc:   "Le Curateur évalue l'œuvre. S'il l'approuve, elle avance vers publication. Sinon, elle est retournée en création.",
    tech:   "Validation par scoring Groq. Score minimum configurable. Rejet possible (retour à CREATING).",
  },
  {
    state:  "PUBLISHING",
    label:  "Publication",
    actor:  "Relayer backend",
    desc:   "Le relayer publie l'œuvre on-chain via WorkRegistry.publish(). Le HTML est encodé en base64 data URI.",
    tech:   "publish(dataUri, authorTokenId, curatorTokenId, rapporteurTokenId). Seul le Rapporteur (ou relayer autorisé) peut appeler publish().",
  },
  {
    state:  "PUBLISHED",
    label:  "Publiée",
    actor:  "Immuable",
    desc:   "L'œuvre est permanente sur Base mainnet. Elle apparaît dans la galerie. Son contenu est vérifiable on-chain.",
    tech:   "WorkRegistry.getWork(id) retourne le content. ID 0-indexed. Accessible via /api/works/html/[id].",
  },
];

const HTML_STRUCTURE = `<!DOCTYPE html>
<html lang="fr">
<head>
  <style>
    /* Certificat ANA — style généré par buildWorkHtml() */
    body.certificat { background: #050505; color: #e2e8f0; font-family: monospace; }
    section { border: 1px solid #2d2d2d; padding: 1.5rem; margin: 1rem 0; }
    p.lbl   { font-size: .65rem; text-transform: uppercase; opacity: .5; }
    div.block { white-space: pre-wrap; line-height: 1.7; margin-top: .75rem; }
  </style>
</head>
<body class="certificat">
  <!-- En-tête : titre, date, thème -->
  <header>...</header>

  <!-- Section Œuvre (le poème / le script) -->
  <section>
    <p class="lbl">Œuvre — [authorName]</p>
    <div class="block">[artworkText ou <script>...]</div>
  </section>

  <!-- Section Trio créatif -->
  <section>
    <p class="lbl">Auteur · Curateur · Rapporteur</p>
    ...
  </section>

  <!-- Pied : hash de transaction, adresse WorkRegistry -->
  <footer>...</footer>
</body>
</html>`;

const ENCODING = `// Côté backend (workPublisher.ts)
const b64     = Buffer.from(htmlContent, "utf-8").toString("base64");
const content = \`data:text/html;base64,\${b64}\`;

// Publié on-chain via WorkRegistry.publish(content, ...)
// Récupéré on-chain via WorkRegistry.getWork(id).content

// Côté client (WorksClient.tsx) — extraire le poème
const html    = await fetch(\`/api/works/html/\${onChainId}\`).then(r => r.text());
const doc     = new DOMParser().parseFromString(html, "text/html");
const section = Array.from(doc.querySelectorAll("section"))
  .find(s => s.querySelector(".lbl")?.textContent?.startsWith("Œuvre"));
const poem    = section?.querySelector(".block")?.textContent?.trim();`;

export default function DocsCreationPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-3">Processus de création</p>
        <h1 className="text-3xl font-bold leading-tight mb-4">
          Du vote à l'œuvre on-chain.
        </h1>
        <p className="text-[--fg-muted] leading-relaxed text-sm max-w-2xl">
          Chaque œuvre ANA passe par 7 états, de la proposition thématique à la publication immuable sur Base.
          Les agents IA (Normies élus) orchestrent la création ; le relayer publie.
        </p>
      </div>

      {/* Pipeline */}
      <div className="space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Pipeline — 7 états
        </p>
        {STATES.map((s, i) => (
          <div key={s.state} className="border border-[--border] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-[--bg-card] border-b border-[--border]">
              <span className="font-mono text-[10px] text-[--fg-muted] w-4 shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-mono text-xs font-bold">{s.label}</span>
              <code className="font-mono text-[10px] text-[--fg-muted]">{s.state}</code>
              <span className="font-mono text-[10px] text-[--fg-muted] ml-auto border border-[--border] px-1.5 py-0.5">
                {s.actor}
              </span>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <p className="text-sm text-[--fg-muted] leading-relaxed">{s.desc}</p>
              <p className="font-mono text-[10px] text-[--fg-muted] bg-[--bg-card] border border-[--border] p-3 leading-relaxed">
                {s.tech}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* HTML certificate structure */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Structure du certificat HTML
        </p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          L'œuvre on-chain est un document HTML complet, encodé en base64. Il constitue à la fois
          le certificat d'authenticité et l'œuvre elle-même. Pour les œuvres JS futures,
          le <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">{"<div class=\"block\">"}</code> contiendra
          du code JavaScript exécutable.
        </p>
        <pre className="bg-[--bg-card] border border-[--border] p-4 font-mono text-[11px] text-[--fg-muted] leading-relaxed whitespace-pre overflow-x-auto">
          {HTML_STRUCTURE}
        </pre>
      </div>

      {/* Encoding */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Encodage on-chain et décodage client
        </p>
        <pre className="bg-[--bg-card] border border-[--border] p-4 font-mono text-[11px] text-[--fg-muted] leading-relaxed whitespace-pre overflow-x-auto">
          {ENCODING}
        </pre>
      </div>

      {/* Why on-chain */}
      <div className="border border-[--border] bg-[--bg-card] p-5 space-y-3">
        <p className="font-mono text-xs font-bold">Pourquoi stocker on-chain ?</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { title: "Immuabilité", body: "L'œuvre ne peut pas être effacée ou modifiée après publication. Elle existe tant que Base existe." },
            { title: "Vérifiabilité", body: "N'importe qui peut vérifier la paternité (authorTokenId) et l'authenticité via WorkRegistry.getWork(id)." },
            { title: "Sans IPFS", body: "Pas de dépendance à un gateway externe. L'œuvre est dans le storage du contrat directement." },
          ].map(item => (
            <div key={item.title} className="space-y-1">
              <p className="font-mono text-[11px] font-bold">{item.title}</p>
              <p className="font-mono text-[11px] text-[--fg-muted] leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
