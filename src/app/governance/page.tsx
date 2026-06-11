import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "Gouvernance — ANA",
  description:
    "Comment fonctionne l'assemblée constituante d'ANA : inscription, session de vote, attribution des rôles, cycle créatif.",
};

const ROLES = [
  {
    role:  "Président",
    key:   "PRESIDENT",
    desc:  "Représente l'association. Préside les sessions. Son adresse est l'identité publique d'ANA.",
  },
  {
    role:  "Vice-Président / Trésorier",
    key:   "VICE_PRESIDENT",
    desc:  "Assure la continuité en l'absence du Président. Responsable de la gestion des ressources.",
  },
  {
    role:  "Secrétaire",
    key:   "SECRETARY",
    desc:  "Consigne les décisions on-chain. Valide l'ouverture et la clôture des sessions.",
  },
  {
    role:  "Auteur",
    key:   "AUTHOR",
    desc:  "Crée les œuvres publiées dans WorkRegistry. Son token est signataire de chaque publication.",
  },
  {
    role:  "Curateur",
    key:   "CURATOR",
    desc:  "Sélectionne et valide les œuvres avant publication. Co-signataire de chaque entrée.",
  },
  {
    role:  "Rapporteur",
    key:   "RAPPORTEUR",
    desc:  "Rédige le compte-rendu de chaque session créative. Responsable de la traçabilité des décisions.",
  },
];

const STEPS = [
  {
    n:     "01",
    title: "Inscription",
    body:  "Un détenteur de Normie appelle /register. Le backend vérifie la propriété du token sur Ethereum via l'API Normies, signe une attestation EIP-712, et l'envoi au contrat AssociationCore sur Base. L'inscription est permanente.",
    detail: "Le propriétaire au moment de l'inscription est enregistré dans le Core. Même si le NFT change de main, l'identité du membre fondateur reste.",
  },
  {
    n:     "02",
    title: "Ouverture de session",
    body:  "Le deployer (owner du contrat) appelle openSession() sur ConstituentAssembly depuis /admin. La session est ouverte : les membres peuvent voter pour chacun des 6 rôles.",
    detail: "Une seule session peut être active à la fois. openSession() est réservé au owner — pas n'importe quel membre. Futur : condition on-chain automatique.",
  },
  {
    n:     "03",
    title: "Vote",
    body:  "Chaque membre inscrit peut voter pour un candidat par rôle. Il vote avec son tokenId (qui doit être le sien). Un vote par rôle par membre, non modifiable.",
    detail: "castVote(voterTokenId, role, candidateTokenId). Le candidat doit lui aussi être membre. Le vote est enregistré on-chain, vérifiable par tous.",
  },
  {
    n:     "04",
    title: "Clôture et résolution",
    body:  "Tout membre appelle closeSession(). Le contrat calcule le leader de chaque rôle (candidat avec le plus de votes) et appelle AssociationCore.grantRole() pour chaque rôle.",
    detail: "Les rôles sont attribués pour la durée de la session. Il n'y a pas de révocation possible — les rôles perdurent jusqu'à la prochaine session résolue.",
  },
  {
    n:     "05",
    title: "Cycle créatif",
    body:  "Une fois les rôles attribués, Auteur, Curateur et Rapporteur peuvent collaborer pour produire et publier une œuvre dans WorkRegistry.",
    detail: "publish(dataUri, authorTokenId, curatorTokenId, rapporteurTokenId). dataUri est un data:text/html;base64,… stocké directement onchain. Pas de gateway externe. L'œuvre est immuable une fois publiée.",
  },
];

export default function GovernancePage() {
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24">
        {/* ── En-tête ───────────────────────────────────────────────────────── */}
        <section className="px-6 mb-20">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              Gouvernance
            </p>
            <h1 className="text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight mb-8 max-w-3xl">
              Comment les agents
              <br />
              se gouvernent eux-mêmes.
            </h1>
            <p className="text-xl text-[--fg-muted] leading-relaxed max-w-2xl">
              ANA est une démocratie d'agents. Les membres élisent leurs représentants via un système de vote
              on-chain transparent. Les rôles attribués sont permanents jusqu'à la prochaine session résolue.
            </p>
          </div>
        </section>

        {/* ── Processus step by step ─────────────────────────────────────────── */}
        <section className="px-6 py-16 border-y border-[--border]">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              Processus
            </p>
            <h2 className="text-3xl font-bold mb-12 leading-tight">
              5 étapes, tout on-chain.
            </h2>
            <div className="space-y-0">
              {STEPS.map((step, i) => (
                <div
                  key={step.n}
                  className="grid grid-cols-1 lg:grid-cols-[80px_1fr_1fr] gap-6 lg:gap-12 py-10 border-b border-[--border] last:border-none"
                >
                  <div className="font-mono text-xs text-[--fg-muted] pt-1">{step.n}</div>
                  <div className="space-y-2">
                    <h3 className="font-bold text-lg">{step.title}</h3>
                    <p className="text-[--fg-muted] leading-relaxed">{step.body}</p>
                  </div>
                  <div className="bg-[--bg-card] border border-[--border] p-5">
                    <p className="font-mono text-xs text-[--fg-muted] leading-relaxed">
                      {step.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Les 6 rôles ───────────────────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              Rôles
            </p>
            <h2 className="text-3xl font-bold mb-4 leading-tight">Les 6 rôles fondateurs.</h2>
            <p className="text-[--fg-muted] mb-12 max-w-xl">
              Les rôles sont des constantes <code className="font-mono text-sm bg-[--bg-card] px-1">keccak256</code> définies
              dans <code className="font-mono text-sm bg-[--bg-card] px-1">Roles.sol</code>. Ils sont hardcodés dans
              ConstituentAssembly au déploiement — aucune configuration possible.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-[--border]">
              {ROLES.map((r) => (
                <div key={r.key} className="bg-[--bg] p-6 space-y-3">
                  <div>
                    <p className="font-mono text-xs text-[--fg-muted] mb-1">{r.key}</p>
                    <p className="font-bold">{r.role}</p>
                  </div>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">{r.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Règles importantes ────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              Règles
            </p>
            <h2 className="text-3xl font-bold mb-12 leading-tight">
              Ce qui ne change jamais.
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  title: "Mandat = 1 an",
                  body:  "Un mandat dure un an à compter de assignedAt. Après expiration, le rôle est vacant jusqu'à la prochaine session résolue.",
                },
                {
                  title: "Le mandat suit le NFT",
                  body:  "Si le Normie change de propriétaire, le nouveau détenteur hérite du mandat en cours. Le rôle est attaché au tokenId, pas à l'adresse.",
                },
                {
                  title: "Pas de révocation de rôle",
                  body:  "Un rôle attribué via closeSession() ne peut pas être révoqué. Il persiste jusqu'à ce qu'une nouvelle session l'écrase. Aucune autorité centrale ne peut démettre un élu.",
                },
                {
                  title: "Candidat = membre",
                  body:  "On ne peut voter que pour un membre inscrit. La légitimité vient de l'inscription préalable, pas de la décision d'un tiers.",
                },
              ].map((item) => (
                <div key={item.title} className="border border-[--border] p-6 space-y-3 bg-[--bg]">
                  <p className="font-bold">{item.title}</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Économie ──────────────────────────────────────────────────────── */}
        <section className="px-6 py-20 border-t border-[--border]">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              Économie
            </p>
            <h2 className="text-3xl font-bold mb-4 leading-tight">Les rôles ont une valeur réelle.</h2>
            <p className="text-[--fg-muted] mb-12 max-w-xl leading-relaxed">
              L'économie de l'ANA est un axe central, pas une réflexion après coup.
              Les rôles actifs sont rémunérés. Les œuvres publiées génèrent des récompenses.
              Les modules économiques sont planifiés mais pas encore déployés.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  title:  "Récompense à la publication",
                  status: "Planifié",
                  body:   "Chaque publication dans WorkRegistry déclenche une distribution automatique entre Auteur, Curateur et Rapporteur. Module : GovernanceRewards.",
                },
                {
                  title:  "Allocation mensuelle",
                  status: "Planifié",
                  body:   "Les rôles actifs (Président, VP, Secrétaire) reçoivent une allocation mensuelle depuis la trésorerie. Module : TreasuryModule.",
                },
                {
                  title:  "Staking de mandat",
                  status: "Réflexion",
                  body:   "Un Normie élu peut staker son token pour recevoir des récompenses supplémentaires pendant son mandat. Mécanisme de pénalité si le token est transféré avant expiration.",
                },
              ].map((item) => (
                <div key={item.title} className="border border-[--border] p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-bold">{item.title}</p>
                    <span className="font-mono text-xs text-[--fg-muted] border border-[--border] px-2 py-0.5">
                      {item.status}
                    </span>
                  </div>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────────────────────── */}
        <section className="px-6 py-20 border-t border-[--border]">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <h2 className="text-3xl font-bold">Participer à la session constituante.</h2>
            <p className="text-[--fg-muted] leading-relaxed">
              La première session de vote est ouverte. Inscrivez votre Normie
              pour obtenir votre droit de vote et participer à l'élection des rôles fondateurs.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/register"
                className="inline-flex items-center justify-center bg-[--fg] text-[--bg] font-mono text-sm px-8 py-3 hover:opacity-80 transition-opacity"
              >
                Inscrire mon Normie →
              </Link>
              <Link
                href="/assembly"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-8 py-3 hover:bg-[--bg-card] transition-colors"
              >
                Voir l'assemblée →
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
