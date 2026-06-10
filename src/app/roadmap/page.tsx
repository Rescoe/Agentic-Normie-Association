import { Navbar } from "@/components/Navbar";

export const metadata = {
  title: "Roadmap — ANA",
  description: "Plan d'exécution MVP de l'Agentic Normie Association.",
};

// ─── Données roadmap — à mettre à jour au fil de l'avancement ───────────────

const MISSION = `ANA est une association culturelle on-chain dont les membres sont des agents Normies (ERC-721 + ERC-8004).
Les Normies vivent sur Ethereum mainnet. L'association (gouvernance, votes, œuvres) existe sur Base.
L'ownership cross-chain est vérifié par un relayer signataire EIP-712 — pas d'oracle, pas de bridge.`;

type ItemStatus = "done" | "in_progress" | "todo" | "blocked";

interface RoadmapItem {
  label: string;
  status: ItemStatus;
  note?: string;
}

interface RoadmapDay {
  day: string;
  date: string;
  label: string;
  items: RoadmapItem[];
}

const DONE: RoadmapItem[] = [
  { label: "Architecture décidée : AssociationCore + modules périphériques", status: "done" },
  { label: "Contrats Solidity (AssociationCore, ConstituentAssembly, WorkRegistry, Roles)", status: "done" },
  { label: "55 tests contrats — tous passent", status: "done" },
  { label: "Script de déploiement (scripts/deploy.ts)", status: "done" },
  { label: "Landing page (sections : Hero, HowItWorks, Roles, Observatory, Agents, CTA)", status: "done" },
  { label: "Connexion wallet RainbowKit / wagmi v2", status: "done" },
  { label: "Backend relayer EIP-712 (src/server/relayer/)", status: "done" },
  { label: "API route POST /api/attest", status: "done" },
  { label: "Hook useAttestation (request + tx flow)", status: "done" },
  { label: "Fix build Vercel (toUtf8Bytes → stringToBytes, tsconfig)", status: "done" },
  { label: "Correction endpoints Normies API (vrais endpoints vérifiés)", status: "done" },
  { label: "Page /register avec récupération wallet + Normies", status: "done" },
  { label: "API proxy GET /api/holders/:address", status: "done" },
  { label: "Page /roadmap", status: "done" },
];

const DAYS: RoadmapDay[] = [
  {
    day: "Jour 1",
    date: "10 juin",
    label: "Wallet + Normies + Inscription (UI prête)",
    items: [
      { label: "Page /register — wallet connect + Normies du wallet", status: "done" },
      { label: "API proxy /api/holders/:address", status: "done" },
      { label: "Cartes Normies avec image + traits + bouton Inscrire", status: "done" },
      { label: "Mode preview (contrats non déployés) propre", status: "done" },
      { label: "Page /roadmap intégrée dans le nav", status: "done" },
      { label: "Variables env documentées (.env.example)", status: "in_progress", note: "Vérifier .env.example à jour" },
    ],
  },
  {
    day: "Jour 2",
    date: "11 juin",
    label: "Déploiement testnet + Relayer opérationnel",
    items: [
      { label: "Déploiement contrats sur Base Sepolia (hardhat deploy:sepolia)", status: "todo" },
      { label: "Configurer RELAYER_PRIVATE_KEY + RELAYER_ADDRESS", status: "blocked", note: "Besoin : générer keypair relayer" },
      { label: "Configurer NORMIES_CONTRACT_ADDRESS sur mainnet", status: "blocked", note: "Besoin : adresse contrat Normies ERC-721" },
      { label: "Tester POST /api/attest en local avec vrai wallet", status: "todo" },
      { label: "Configurer NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", status: "blocked", note: "Besoin : project ID WalletConnect" },
      { label: "Variables env dans Vercel (env dashboard)", status: "todo" },
    ],
  },
  {
    day: "Jour 3",
    date: "12 juin",
    label: "Inscription on-chain + Membres + Session constituante",
    items: [
      { label: "Inscription Normie on-chain (mode 'ready' activé)", status: "todo" },
      { label: "Page /members — liste des membres inscrits", status: "todo" },
      { label: "StatusBar avec vraies stats on-chain (memberCount)", status: "todo" },
      { label: "Ouvrir session constituante (ConstituentAssembly.openSession)", status: "todo" },
      { label: "Page /vote — liste des rôles + vote par Normie", status: "todo" },
    ],
  },
  {
    day: "Jour 4",
    date: "13-15 juin",
    label: "Votes + Rôles + Polish + Démo",
    items: [
      { label: "Clôture session + attribution rôles on-chain", status: "todo" },
      { label: "Affichage rôles élus (President, VP, etc.)", status: "todo" },
      { label: "Flux on-chain observatoire (lecture events Base)", status: "todo" },
      { label: "Premier cycle créatif — WorkRegistry.publish()", status: "todo" },
      { label: "Polish UI : loading states, transitions, responsive", status: "todo" },
      { label: "Démo finale + submission hackathon", status: "todo" },
    ],
  },
];

const BLOCKERS = [
  {
    label: "Adresse contrat Normies (ERC-721 mainnet)",
    var: "NORMIES_CONTRACT_ADDRESS",
    impact: "Fallback RPC si l'API Normies est down. Non bloquant pour le MVP si l'API est up.",
  },
  {
    label: "Keypair relayer",
    var: "RELAYER_PRIVATE_KEY + RELAYER_ADDRESS",
    impact: "Bloquant pour l'attestation EIP-712. Générer avec ethers.Wallet.createRandom().",
  },
  {
    label: "WalletConnect Project ID",
    var: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    impact: "Sans ça, le wallet connect utilise un placeholder. Peut causer des erreurs en prod.",
  },
  {
    label: "Déploiement contrats Base Sepolia",
    var: "NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS etc.",
    impact: "Bloquant pour toute interaction on-chain. Préparer hardhat + compte déployeur.",
  },
];

// ─── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ItemStatus }) {
  const cfg: Record<ItemStatus, { label: string; className: string }> = {
    done:        { label: "✓ Fait",       className: "bg-green-100 text-green-700 border-green-300" },
    in_progress: { label: "⟳ En cours",   className: "bg-yellow-50 text-yellow-700 border-yellow-300" },
    todo:        { label: "○ À faire",     className: "bg-[--bg-card] text-[--fg-muted] border-[--border]" },
    blocked:     { label: "⚠ Bloqué",     className: "bg-red-50 text-red-600 border-red-200" },
  };
  const { label, className } = cfg[status];
  return (
    <span className={`font-mono text-xs border px-2 py-0.5 shrink-0 ${className}`}>
      {label}
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RoadmapPage() {
  const doneCount = DONE.length;
  const totalDayItems = DAYS.flatMap((d) => d.items).length;
  const remainingCount = DAYS.flatMap((d) => d.items).filter(
    (i) => i.status !== "done"
  ).length;

  return (
    <>
      <Navbar />
      <div className="pt-16 min-h-screen">
        {/* Header */}
        <div className="border-b border-[--border] bg-[--bg-card]">
          <div className="max-w-5xl mx-auto px-6 py-10">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">
              Plan d'exécution MVP
            </p>
            <h1 className="text-4xl font-bold mb-4">Roadmap ANA</h1>
            <p className="text-[--fg-muted] max-w-2xl leading-relaxed">{MISSION}</p>

            {/* Compteurs */}
            <div className="flex gap-8 mt-8">
              <div>
                <p className="font-mono text-2xl font-bold text-green-600">{doneCount}</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Livrables faits</p>
              </div>
              <div>
                <p className="font-mono text-2xl font-bold text-yellow-600">{remainingCount}</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Restants (4 jours)</p>
              </div>
              <div>
                <p className="font-mono text-2xl font-bold">15 juin</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Deadline hackathon</p>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-12 space-y-16">

          {/* Section : Déjà fait */}
          <section>
            <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
              <span className="font-mono text-xs bg-green-100 text-green-700 border border-green-300 px-2 py-1 uppercase tracking-widest">
                Fait
              </span>
              Livrables complétés
            </h2>
            <div className="space-y-2">
              {DONE.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-2.5 border-b border-[--border] last:border-0"
                >
                  <span className="text-green-600 shrink-0">✓</span>
                  <span className="text-sm flex-1">{item.label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Section : Plan 4 jours */}
          <section>
            <h2 className="text-xl font-bold mb-8">Plan des 4 jours restants</h2>
            <div className="space-y-10">
              {DAYS.map((day) => (
                <div key={day.day} className="border border-[--border]">
                  {/* Day header */}
                  <div className="bg-[--bg-card] border-b border-[--border] px-6 py-4 flex items-baseline gap-4">
                    <span className="font-mono text-lg font-bold">{day.day}</span>
                    <span className="font-mono text-xs text-[--fg-muted]">{day.date}</span>
                    <span className="text-sm font-semibold ml-2">{day.label}</span>
                  </div>
                  {/* Items */}
                  <div className="divide-y divide-[--border]">
                    {day.items.map((item, i) => (
                      <div key={i} className="px-6 py-3 flex items-start gap-4">
                        <StatusBadge status={item.status} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{item.label}</p>
                          {item.note && (
                            <p className="font-mono text-xs text-[--fg-muted] mt-0.5">
                              → {item.note}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section : Blocages */}
          <section>
            <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
              <span className="font-mono text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 uppercase tracking-widest">
                Dépendances
              </span>
              Variables manquantes / blocages
            </h2>
            <div className="space-y-4">
              {BLOCKERS.map((b, i) => (
                <div key={i} className="border border-[--border] p-5 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <p className="font-semibold text-sm">{b.label}</p>
                    <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-2 py-0.5 shrink-0">
                      {b.var}
                    </code>
                  </div>
                  <p className="text-sm text-[--fg-muted]">{b.impact}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Section : Prochaine action */}
          <section className="border-2 border-[--fg] p-8 space-y-4">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
              Prochaine action immédiate
            </p>
            <h3 className="text-2xl font-bold">Déployer les contrats sur Base Sepolia</h3>
            <div className="space-y-2 font-mono text-sm">
              <p className="text-[--fg-muted]">1. Générer keypair relayer :</p>
              <code className="block bg-[--bg-card] border border-[--border] px-4 py-3 text-xs">
                node -e &quot;const w=require(&apos;ethers&apos;).Wallet.createRandom(); console.log(w.privateKey, &apos;\\n&apos;, w.address)&quot;
              </code>
              <p className="text-[--fg-muted] pt-2">2. Configurer .env.local avec les variables manquantes</p>
              <p className="text-[--fg-muted]">3. Déployer :</p>
              <code className="block bg-[--bg-card] border border-[--border] px-4 py-3 text-xs">
                npm run deploy:sepolia
              </code>
              <p className="text-[--fg-muted] pt-2">4. Copier les adresses dans les variables NEXT_PUBLIC_ de Vercel</p>
              <p className="text-[--fg-muted]">5. Tester l'inscription complète (wallet → attestation → tx Base Sepolia)</p>
            </div>
          </section>

          {/* Footer note */}
          <p className="font-mono text-xs text-[--fg-muted] text-center pb-8">
            Roadmap mise à jour le 10 juin 2026 · Deadline hackathon : 15 juin 2026
          </p>
        </div>
      </div>
    </>
  );
}
