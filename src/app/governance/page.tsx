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
    body:  "Un détenteur de Normie appelle /register. Le backend vérifie ownerOf(tokenId) sur Ethereum, signe une attestation EIP-712, et le wallet soumet register() sur Base. Le tokenId est enregistré comme membre de l'ANA.",
    detail: "Le Normie (tokenId) est le membre — pas son propriétaire humain. L'adresse qui inscrit est snapshotée pour autoriser les votes dans cette assemblée (voir contrainte cross-chain ci-dessous). L'inscription est permanente et non-annulable.",
  },
  {
    n:     "02",
    title: "Ouverture de session",
    body:  "Le deployer (owner du contrat) appelle openSession() depuis /admin. La session est ouverte : les membres peuvent voter pour chacun des 6 rôles.",
    detail: "openSession() est réservé au owner — contrainte de sécurité. Futur : condition on-chain automatique (quorum atteint) ou délégué au Président élu.",
  },
  {
    n:     "03",
    title: "Vote",
    body:  "Chaque Normie inscrit peut voter pour un candidat par rôle. 1 Normie = 1 vote par rôle, non modifiable.",
    detail: "castVote(voterTokenId, role, candidateTokenId). Le contrat vérifie que msg.sender == adresse snapshotée à l'inscription du voterTokenId. Candidat et votant doivent être membres inscrits.",
  },
  {
    n:     "04",
    title: "Clôture et résolution",
    body:  "Le owner appelle closeSession(). Le contrat calcule le Normie gagnant pour chaque rôle et appelle grantRole() sur AssociationCore pour chacun.",
    detail: "Résolution atomique : tous les rôles en une seule transaction. Égalité : tokenId le plus bas gagne. Rôle sans vote = vacant. Aucune révocation possible après attribution.",
  },
  {
    n:     "05",
    title: "Cycle créatif",
    body:  "Une fois les rôles attribués, Auteur, Curateur et Rapporteur collaborent pour produire et publier une œuvre dans WorkRegistry.",
    detail: "publish(dataUri, authorTokenId, curatorTokenId, rapporteurTokenId). dataUri = data:text/html;base64,… encodé côté client, stocké directement onchain. Pas de gateway externe. L'œuvre est immuable.",
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

        {/* ── Modèle de membership ──────────────────────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto space-y-12">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
                Modèle de membership
              </p>
              <h2 className="text-3xl font-bold leading-tight">
                Le Normie est le membre. Pas son propriétaire.
              </h2>
            </div>

            {/* Deux régimes côte à côte */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Modèle conceptuel */}
              <div className="border-2 border-[--fg] p-8 space-y-4">
                <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
                  Modèle conceptuel (la règle)
                </p>
                <p className="font-bold text-lg">tokenId = membre</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  <code className="bg-[--bg-card] px-1">isMember(tokenId)</code> — c'est le Normie qui adhère à l'ANA,
                  pas un humain. Ses propriétaires successifs sont ses opérateurs.
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  Quand un Normie élu change de mains, le nouveau propriétaire hérite
                  du mandat. <strong>Le rôle suit le NFT, pas l'adresse.</strong>
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  Mandat : <strong>1 an</strong> à compter de l'attribution. Non révocable.
                  Vacant après expiration.
                </p>
              </div>

              {/* Contrainte technique */}
              <div className="border border-[--border] bg-[--bg] p-8 space-y-4">
                <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
                  Contrainte technique (l'implémentation MVP)
                </p>
                <p className="font-bold text-lg">Snapshot cross-chain à l'inscription</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  ANA est sur Base. Les Normies sont sur Ethereum.
                  Le contrat <strong>ne peut pas appeler <code className="bg-[--bg-card] px-1">ownerOf(tokenId)</code> sur Ethereum</strong> depuis Base
                  sans une attestation relayer fraîche.
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  Pour l'assemblée constituante, l'adresse qui a prouvé
                  la propriété à l'inscription est snapshotée. C'est elle qui est
                  autorisée à voter — pas nécessairement le propriétaire actuel sur Ethereum.
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  <strong>Ce que ça change si le NFT est vendu après inscription :</strong><br/>
                  Le tokenId reste membre. L'ancien propriétaire peut encore voter dans cette assemblée (snapshot figé).
                  Le nouveau propriétaire ne peut pas — son adresse ≠ snapshot.
                  C'est une anomalie tolérable pour un événement fondateur unique.
                </p>
                <div className="border-t border-[--border] pt-4">
                  <p className="font-mono text-xs text-[--fg-muted]">
                    Résolution : WorkRegistry v2 demandera une fresh attestation pour chaque action privilegiée → ownership dynamique.
                  </p>
                </div>
              </div>
            </div>

            {/* Invariants */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  title: "Pas de révocation",
                  body:  "Un rôle attribué via closeSession() ne peut pas être révoqué. Il persiste jusqu'à ce qu'une nouvelle session l'écrase. Aucune autorité centrale ne peut démettre un élu.",
                },
                {
                  title: "Candidat = membre inscrit",
                  body:  "On ne peut voter que pour un Normie membre. La légitimité vient de l'inscription préalable, pas de la décision d'un tiers.",
                },
                {
                  title: "Résolution déterministe",
                  body:  "En cas d'égalité, le tokenId le plus bas gagne. Pas d'arbitrage humain. Tout est calculé et écrit on-chain dans closeSession().",
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
