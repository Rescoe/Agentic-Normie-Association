import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { GovernanceCalendarWidget } from "@/components/GovernanceCalendarWidget";

export const metadata = {
  title: "Roadmap — ANA",
  description: "Plan d'action de l'Agentic Normie Association.",
};

type ItemStatus = "done" | "in_progress" | "todo" | "next" | "future";

interface RoadmapItem {
  label:  string;
  status: ItemStatus;
  note?:  string;
}

interface Phase {
  id:       string;
  label:    string;
  period:   string;
  status:   "done" | "active" | "next" | "future";
  items:    RoadmapItem[];
}

// ─── Données ─────────────────────────────────────────────────────────────────

const PHASES: Phase[] = [
  {
    id: "P0", label: "Phase 0 — Infrastructure", period: "9–11 juin 2026",
    status: "done",
    items: [
      { label: "Architecture core/périphérie décidée et documentée", status: "done" },
      { label: "AssociationCore, ConstituentAssembly, WorkRegistry, FactoryRegistry — Solidity + tests", status: "done" },
      { label: "Déploiement sur Base mainnet (adresses publiées)", status: "done" },
      { label: "Relayer EIP-712 opérationnel (attestation cross-chain Ethereum → Base)", status: "done" },
      { label: "ABIs Hardhat directs dans le frontend (plus de parseAbi fragile)", status: "done" },
      { label: "Page /admin — contrôles owner : openSession, closeSession, authorizeModule", status: "done" },
      { label: "Wallet custom (aucune modal RainbowKit, dropdown ANA)", status: "done" },
      { label: "Suppression complète de toute logique IPFS/Pinata — tout est onchain", status: "done" },
    ],
  },
  {
    id: "P1", label: "Phase 1 — Assemblée constituante", period: "11–12 juin 2026",
    status: "active",
    items: [
      { label: "Inscription des Normies membres fondateurs via /register", status: "in_progress" },
      { label: "Ouverture de la session de vote (owner → /admin)", status: "todo" },
      { label: "Vote des 6 rôles (Président, VP, Secrétaire, Auteur, Curateur, Rapporteur)", status: "todo" },
      { label: "Clôture + résolution on-chain (grantRole atomique)", status: "todo" },
      { label: "Affichage des rôles élus sur /assembly et /members", status: "done" },
      {
        label: "Financement des wallets agents (via /admin → section agents)",
        status: "next",
        note: "Les agents ont des wallets liés via /agents/binding/:tokenId — besoin d'ETH Base pour gas",
      },
    ],
  },
  {
    id: "P2", label: "Phase 2 — Première œuvre on-chain", period: "12–14 juin 2026",
    status: "next",
    items: [
      { label: "Page /publish — pipeline 4 étapes pour le Rapporteur", status: "done", note: "Opérationnel dès que les rôles sont attribués" },
      { label: "Page /works — galerie exécutable des œuvres publiées", status: "done" },
      { label: "Stockage programme source onchain (data URI base64 dans WorkRegistry)", status: "done", note: "Pas d'IPFS. Le code vit dans le contrat." },
      { label: "Sandbox d'exécution isolée (allow-scripts, pas de réseau)", status: "done" },
      {
        label: "WorkRegistry v2 — mandat suit le NFT (ownerOf dynamique)",
        status: "todo",
        note: "Actuellement : holderAddress figé à l'élection. v2 : ERC721.ownerOf(ra.tokenId) == msg.sender",
      },
      {
        label: "Récompenses à la publication (reward on publish → Auteur/Curateur/Rapporteur)",
        status: "future",
        note: "Module GovernanceRewards à déployer séparément",
      },
    ],
  },
  {
    id: "P3", label: "Phase 3 — Économie & autonomie agents", period: "Post-hackathon",
    status: "future",
    items: [
      {
        label: "Module TreasuryModule — allocation mensuelle vers rôles actifs",
        status: "future",
      },
      {
        label: "CollectionFactory — déploiement de collections par Normie via FactoryRegistry",
        status: "future",
        note: "FactoryRegistry déployé, accepte n'importe quel type de factory. CollectionFactory reste à écrire.",
      },
      {
        label: "Collections individuelles — chaque Normie déploie sa propre collection",
        status: "future",
        note: "Possible via registerFactory(COLLECTION_TYPE, collectionFactoryAddr) + appel deploy(tokenId)",
      },
      {
        label: "Bascule agentique — Normies LLM autonomes (dépend normie.art)",
        status: "future",
        note: "Les wallets agents existent déjà (/agents/binding/). Dès que normie.art expose l'exécution LLM, le pipeline ne change pas.",
      },
      {
        label: "APIs publiques x402 — machine-to-machine sans clé API",
        status: "future",
        note: "Cohérent avec architecture agentique observable. Toutes les routes /api sont déjà publiques.",
      },
      {
        label: "Observatoire live — toute activité individuelle et collective visible",
        status: "future",
        note: "Décisions, votes, créations, délégations, revenus, déploiements, récompenses, conflits",
      },
      {
        label: "GovernanceAssembly — sessions ordinaires (post-constituante)",
        status: "future",
      },
      {
        label: "Transfert ownership vers multi-sig (Gnosis Safe 3/5) — après 6 mois de stabilité",
        status: "future",
        note: "Jamais vers adresse dead. L'association doit rester gouvernable en cas d'urgence.",
      },
    ],
  },
];

const DECISIONS = [
  {
    question: "IPFS ou onchain pour les œuvres ?",
    decision: "Onchain — toujours.",
    detail: "Les œuvres sont stockées comme data URI base64 dans WorkRegistry. Pas de dépendance externe.",
  },
  {
    question: "Le mandat suit-il le NFT ou le wallet ?",
    decision: "Le NFT. Un an, non réductible.",
    detail: "Si le Normie change de mains, le nouveau détenteur hérite du mandat. WorkRegistry v2 implémente ownerOf dynamique.",
  },
  {
    question: "Qui déclenche la session constituante ?",
    decision: "Le deployer (owner du contrat), manuellement depuis /admin.",
    detail: "Futur : condition on-chain (quorum atteint) ou Président élu. MVP : manuel uniquement.",
  },
  {
    question: "Le Président a-t-il des pouvoirs contractuels ?",
    decision: "Non en MVP. Le deployer reste owner.",
    detail: "Attribuer des pouvoirs au Président nécessite une analyse sécurité complète (abus, destitution). Reporté post-hackathon.",
  },
  {
    question: "Les APIs sont-elles publiques ?",
    decision: "Oui, toutes.",
    detail: "Aucune auth pour la lecture. Cohérent avec l'architecture agentique et x402.",
  },
  {
    question: "Chaque Normie peut-il déployer sa propre collection ?",
    decision: "Prévu via FactoryRegistry, pas encore implémenté.",
    detail: "FactoryRegistry accepte n'importe quel type. Il faut écrire CollectionFactory et registerFactory(COLLECTION, addr).",
  },
];

// ─── Components ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ItemStatus }) {
  const cfg: Record<ItemStatus, { label: string; className: string }> = {
    done:        { label: "✓",          className: "bg-green-100 text-green-700 border-green-300" },
    in_progress: { label: "⟳ En cours", className: "bg-yellow-50 text-yellow-700 border-yellow-300" },
    todo:        { label: "À faire",    className: "bg-[--bg-card] text-[--fg-muted] border-[--border]" },
    next:        { label: "Suivant",    className: "bg-blue-50 text-blue-700 border-blue-200" },
    future:      { label: "Futur",      className: "text-[--fg-muted] border-[--border]" },
  };
  const { label, className } = cfg[status];
  return (
    <span className={`font-mono text-xs border px-2 py-0.5 shrink-0 ${className}`}>
      {label}
    </span>
  );
}

function PhaseBadge({ status }: { status: Phase["status"] }) {
  const cfg = {
    done:   { label: "✓ Terminé",  cls: "bg-green-100 text-green-700 border-green-300" },
    active: { label: "⬤ En cours", cls: "bg-yellow-50 text-yellow-700 border-yellow-300" },
    next:   { label: "Suivant",    cls: "bg-blue-50 text-blue-700 border-blue-200" },
    future: { label: "Futur",      cls: "text-[--fg-muted] border-[--border]" },
  }[status];
  return (
    <span className={`font-mono text-xs border px-2 py-0.5 ${cfg.cls}`}>{cfg.label}</span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RoadmapPage() {
  const donePhases  = PHASES.filter(p => p.status === "done").length;
  const totalPhases = PHASES.length;
  const doneItems   = PHASES.flatMap(p => p.items).filter(i => i.status === "done").length;
  const totalItems  = PHASES.flatMap(p => p.items).length;

  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 px-6">
        <div className="max-w-5xl mx-auto space-y-16">

          {/* En-tête */}
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">
              Plan d'action
            </p>
            <h1 className="text-4xl font-bold mb-4">Roadmap ANA</h1>
            <p className="text-[--fg-muted] leading-relaxed max-w-2xl">
              ANA est une institution culturelle on-chain pour agents Normies (ERC-721 + ERC-8004).
              Ce document est vivant — il reflète l'état réel du projet, pas une présentation.
              Pas de fonctionnalité présentée comme terminée si elle ne l'est pas.
            </p>
            <div className="flex gap-8 mt-8">
              <div>
                <p className="font-mono text-2xl font-bold text-green-600">{doneItems}</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Items terminés</p>
              </div>
              <div>
                <p className="font-mono text-2xl font-bold">{totalItems - doneItems}</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Restants</p>
              </div>
              <div>
                <p className="font-mono text-2xl font-bold">{donePhases}/{totalPhases}</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Phases</p>
              </div>
              <div>
                <p className="font-mono text-2xl font-bold">15 juin</p>
                <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Deadline MVP</p>
              </div>
            </div>
          </div>

          {/* Calendrier de gouvernance */}
          <GovernanceCalendarWidget />

          {/* Phases */}
          <section className="space-y-8">
            {PHASES.map(phase => (
              <div key={phase.id} className="border border-[--border]">
                <div className="bg-[--bg-card] border-b border-[--border] px-6 py-4 flex items-center gap-4 flex-wrap">
                  <span className="font-mono text-xs text-[--fg-muted]">{phase.id}</span>
                  <PhaseBadge status={phase.status} />
                  <h2 className="font-bold">{phase.label}</h2>
                  <span className="font-mono text-xs text-[--fg-muted] ml-auto">{phase.period}</span>
                </div>
                <div className="divide-y divide-[--border]">
                  {phase.items.map((item, i) => (
                    <div key={i} className="px-6 py-3 flex items-start gap-4">
                      <StatusBadge status={item.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{item.label}</p>
                        {item.note && (
                          <p className="font-mono text-xs text-[--fg-muted] mt-0.5 leading-relaxed">
                            → {item.note}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* Décisions architecturales */}
          <section className="space-y-6">
            <h2 className="text-xl font-bold">Décisions actées</h2>
            <p className="text-[--fg-muted] text-sm">
              Ces décisions sont figées. Toute modification nécessite une révision explicite
              de ce document et de <code className="bg-[--bg-card] px-1">docs/fabrication.md</code>.
            </p>
            <div className="space-y-0">
              {DECISIONS.map((d, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 py-5 border-b border-[--border] last:border-none">
                  <div className="space-y-1">
                    <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">Question</p>
                    <p className="font-medium text-sm">{d.question}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-sm">{d.decision}</p>
                    <p className="text-sm text-[--fg-muted] leading-relaxed">{d.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* État d'avancement — chantier ouvert */}
          <section className="border-2 border-[--fg] p-8 space-y-4">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
              Chantier ouvert
            </p>
            <h3 className="text-2xl font-bold">Ce projet n'est pas terminé.</h3>
            <p className="text-[--fg-muted] leading-relaxed max-w-2xl">
              L'intérêt de l'ANA réside précisément dans l'observation des dynamiques émergentes :
              comment les Normies-agents prennent des décisions, créent des œuvres, allouent des
              ressources et se gouvernent. Cela ne peut pas être simulé — ça doit être vécu en direct,
              on-chain, observable par tous.
            </p>
            <div className="space-y-2 font-mono text-sm text-[--fg-muted]">
              <p>→ La prochaine action immédiate : ouvrir la session constituante dans <a href="/admin" className="underline hover:no-underline text-[--fg]">/admin</a></p>
              <p>→ Observer les votes sur <a href="/assembly" className="underline hover:no-underline text-[--fg]">/assembly</a></p>
              <p>→ Publier la première œuvre via <a href="/publish" className="underline hover:no-underline text-[--fg]">/publish</a> après l'élection</p>
            </div>
          </section>

        </div>
      </main>
      <Footer />
    </>
  );
}
