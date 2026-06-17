import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gouvernance technique — Documentation ANA",
  description: "Détail technique des sessions de vote, des rôles et de la gouvernance on-chain de l'ANA.",
};

const STEPS = [
  {
    n:     "01",
    title: "Inscription",
    tech:  "register(attestation, sig)",
    detail: "Un détenteur de Normie appelle /register. Le backend vérifie ownerOf(tokenId) sur Ethereum, signe une attestation EIP-712, et le wallet soumet register() sur Base. Le tokenId est enregistré comme membre de l'ANA.",
    impl:  "Le Normie (tokenId) est le membre — pas son propriétaire humain. L'adresse qui inscrit est snapshotée pour autoriser les votes dans cette assemblée. L'inscription est permanente et non-annulable.",
  },
  {
    n:     "02",
    title: "Ouverture de session",
    tech:  "openSession()",
    detail: "Le deployer (owner du contrat) appelle openSession() depuis /admin. La session est ouverte : les membres peuvent voter pour chacun des 6 rôles.",
    impl:  "openSession() est réservé au owner — contrainte de sécurité. Futur : condition on-chain automatique (quorum atteint) ou délégué au Président élu.",
  },
  {
    n:     "03",
    title: "Vote",
    tech:  "castVote(voterTokenId, role, candidateTokenId)",
    detail: "Chaque Normie inscrit peut voter pour un candidat par rôle. 1 Normie = 1 vote par rôle, non modifiable.",
    impl:  "Le contrat vérifie que msg.sender == adresse snapshotée à l'inscription du voterTokenId. Candidat et votant doivent être membres inscrits.",
  },
  {
    n:     "04",
    title: "Clôture et résolution",
    tech:  "closeSession()",
    detail: "Le owner appelle closeSession(). Le contrat calcule le Normie gagnant pour chaque rôle et appelle grantRole() sur AssociationCore pour chacun.",
    impl:  "Résolution atomique : tous les rôles en une seule transaction. Égalité : tokenId le plus bas gagne. Rôle sans vote = vacant. Aucune révocation possible après attribution.",
  },
  {
    n:     "05",
    title: "Cycle créatif",
    tech:  "WorkRegistry.publish()",
    detail: "Une fois les rôles attribués, Auteur, Curateur et Rapporteur collaborent pour produire et publier une œuvre dans WorkRegistry.",
    impl:  "publish(dataUri, authorTokenId, curatorTokenId, rapporteurTokenId). dataUri = data:text/html;base64,… encodé côté client, stocké directement onchain. Pas de gateway externe. L'œuvre est immuable.",
  },
];

const ROLES = [
  {
    role:  "PRESIDENT",
    title: "Président",
    hash:  "keccak256('PRESIDENT')",
    desc:  "Représente l'association. Préside les sessions. Son adresse est l'identité publique d'ANA. Futur : seul à pouvoir appeler openSession().",
  },
  {
    role:  "VICE_PRESIDENT",
    title: "Vice-Président / Trésorier",
    hash:  "keccak256('VICE_PRESIDENT')",
    desc:  "Assure la continuité en l'absence du Président. Responsable de la gestion des ressources. Futur : accès TreasuryModule.",
  },
  {
    role:  "SECRETARY",
    title: "Secrétaire",
    hash:  "keccak256('SECRETARY')",
    desc:  "Consigne les décisions on-chain. Futur : valide l'ouverture et la clôture des sessions.",
  },
  {
    role:  "AUTHOR",
    title: "Auteur",
    hash:  "keccak256('AUTHOR')",
    desc:  "Crée les œuvres publiées dans WorkRegistry. Son tokenId est signataire de chaque publication. Accès createCollection().",
  },
  {
    role:  "CURATOR",
    title: "Curateur",
    hash:  "keccak256('CURATOR')",
    desc:  "Sélectionne et valide les œuvres avant publication. Co-signataire de chaque entrée dans WorkRegistry.",
  },
  {
    role:  "RAPPORTEUR",
    title: "Rapporteur",
    hash:  "keccak256('RAPPORTEUR')",
    desc:  "Rédige le compte-rendu de chaque session créative. Signataire du relayer pour publish(). Responsable de la traçabilité.",
  },
];

const INVARIANTS = [
  {
    title: "tokenId = membre",
    body:  "isMember(tokenId) — c'est le Normie qui adhère à l'ANA, pas un humain. Si le NFT change de mains, le nouveau propriétaire hérite du mandat.",
  },
  {
    title: "Pas de révocation",
    body:  "Un rôle attribué via closeSession() persiste jusqu'à ce qu'une nouvelle session l'écrase. Aucune autorité centrale ne peut démettre un élu.",
  },
  {
    title: "Résolution déterministe",
    body:  "En cas d'égalité, le tokenId le plus bas gagne. Tout est calculé et écrit on-chain dans closeSession().",
  },
  {
    title: "Candidat = membre inscrit",
    body:  "On ne peut voter que pour un Normie membre. La légitimité vient de l'inscription préalable.",
  },
];

export default function DocsGovernancePage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-3">Gouvernance technique</p>
        <h1 className="text-3xl font-bold leading-tight mb-4">
          Démocratie on-chain, pas de confiance.
        </h1>
        <p className="text-[--fg-muted] leading-relaxed text-sm max-w-2xl">
          Chaque étape du cycle de gouvernance est exécutée par un appel de contrat vérifiable.
          Il n'existe pas de vote hors-chaîne, pas de résultat annoncé par un tiers.
        </p>
      </div>

      {/* Process steps */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Processus — 5 étapes
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
          Les 6 rôles
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
          Invariants du système
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
        <p className="font-mono text-xs font-bold">Contrainte cross-chain (MVP)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <p className="font-mono text-[10px] text-[--fg-muted] uppercase">Modèle conceptuel</p>
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              isMember(tokenId) — le Normie adhère, pas l'humain. Quand le NFT change de mains,
              le nouveau propriétaire hérite du mandat. <strong>Le rôle suit le NFT.</strong>
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[10px] text-[--fg-muted] uppercase">Implémentation MVP</p>
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              ANA est sur Base, les Normies sur Ethereum. Le contrat ne peut pas appeler ownerOf()
              cross-chain directement. L'adresse qui a inscrit le Normie est snapshotée.
              C'est elle qui vote — pas le propriétaire actuel si le NFT a été vendu.
            </p>
            <p className="font-mono text-[10px] text-[--fg-muted] border-l border-[--border] pl-3">
              Résolution v2 : fresh attestation EIP-712 pour chaque action — ownership dynamique.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
