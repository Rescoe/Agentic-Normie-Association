import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ZoomableImage } from "@/components/ZoomableImage";

export const metadata = {
  title: "Architecture — ANA",
  description:
    "Architecture technique d'ANA : Core immuable, modules périphériques remplaçables, attestations EIP-712 cross-chain, sécurité par conception.",
};

// ─── Contracts ────────────────────────────────────────────────────────────────

const DEPLOYED = {
  AssociationCore:     "0x218a2C38a16F81DcC944872264d79606b1DB1C40",
  ConstituentAssembly: "0xF06079eb31cF11122C67DcD986354c3bbF0df8a2",
  WorkRegistry:        "0x68cBD92b0a1bcB737364945F22522BdD4324EeCE",
  FactoryRegistry:     "0xCB440879cb709aC4176B1e098B26fd350232e670",
  NormiesERC721:       "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438",
} as const;

const PENDING = {
  GovernanceCalendar: "— après redéploiement",
  TreasuryModule:     "— après redéploiement",
  CollectionFactory:  "— après redéploiement",
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-[--bg] border border-[--border] rounded p-4 overflow-x-auto font-mono text-xs text-[--fg-muted] leading-relaxed whitespace-pre">
      {children}
    </pre>
  );
}

function SectionTitle({ tag, title, sub }: { tag: string; title: string; sub?: string }) {
  return (
    <div className="mb-10">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">{tag}</p>
      <h2 className="text-3xl font-bold leading-tight mb-3">{title}</h2>
      {sub && <p className="text-[--fg-muted] max-w-2xl leading-relaxed">{sub}</p>}
    </div>
  );
}

export default function ArchitecturePage() {
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24">
        {/* ── En-tête ───────────────────────────────────────────────────────── */}
        <section className="px-6 mb-20">
          <div className="max-w-6xl mx-auto">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
              Architecture
            </p>
            <h1 className="text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight mb-8 max-w-4xl">
              Un socle immuable,
              <br />
              des modules évolutifs.
            </h1>
            <p className="text-xl text-[--fg-muted] leading-relaxed max-w-2xl">
              ANA est conçue pour durer. AssociationCore ne changera jamais.
              Les modules périphériques peuvent évoluer, être remplacés ou étendus —
              sans jamais toucher l'identité ni la mémoire de l'association.
            </p>
          </div>
        </section>

        {/* ── Carte complète des contrats ───────────────────────────────────── */}
        <section className="px-6 py-16 border-y border-[--border]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag="Vue d'ensemble"
              title="8 contrats, 2 chaînes, 3 acteurs."
              sub="Ethereum mainnet (Normies ERC-721) + Base mainnet (toute la logique ANA). Les acteurs : le déployeur (owner), les Normies-membres, et le relayer backend."
            />

            {/* Texte gauche + image droite */}
            <div className="flex flex-col lg:flex-row gap-8 items-start">

              {/* Fiches acteurs — gauche, compactes */}
              <div className="space-y-3 lg:max-w-xs xl:max-w-sm flex-shrink-0">
                {[
                  {
                    actor: "Normie membre",
                    actions: [
                      "register(attestation, sig)",
                      "castVote(tokenId, role, candidateId)",
                      "initiateWorkSession()",
                      "createCollection(tokenId, name, sym)",
                      "withdraw() — si role holder",
                    ],
                    color: "border-blue-200 bg-blue-50/30",
                    badge: "text-blue-700 border-blue-300",
                  },
                  {
                    actor: "Owner / Deployer",
                    actions: [
                      "authorizeModule(assembly)",
                      "openSession() / closeSession()",
                      "setSchedule(ts, period, active)",
                      "registerFactory(type, addr)",
                      "setRelayer(addr) — si clé compromise",
                    ],
                    color: "border-purple-200 bg-purple-50/30",
                    badge: "text-purple-700 border-purple-300",
                  },
                  {
                    actor: "Relayer backend",
                    actions: [
                      "Vérifie ownerOf(tokenId) sur Ethereum",
                      "Signe attestation EIP-712",
                      "Le wallet soumet register() avec la sig",
                      "Jamais de tx on-chain — signe seulement",
                    ],
                    color: "border-orange-200 bg-orange-50/30",
                    badge: "text-orange-700 border-orange-300",
                  },
                ].map((a) => (
                  <div key={a.actor} className={`border ${a.color} p-3 space-y-2`}>
                    <span className={`font-mono text-[10px] border px-1.5 py-0.5 ${a.badge}`}>{a.actor}</span>
                    <ul className="space-y-0.5">
                      {a.actions.map((action, i) => (
                        <li key={i} className="font-mono text-[10px] text-[--fg-muted] flex gap-1.5">
                          <span className="shrink-0 opacity-50">→</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {/* ── Contrats détaillés ─────────────────────────────────── */}
                <p className="font-mono text-[9px] uppercase tracking-widest text-[--fg-muted] pt-3 pb-0.5">
                  Contrats — détail
                </p>

                {/* AssociationCore */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">AssociationCore</span>
                    <span className="font-mono text-[9px] border border-[--fg] px-1 leading-none py-0.5 text-[--fg]">IMMUABLE</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    <li><span className="opacity-50">→</span> members: tokenId → ownerAddress</li>
                    <li><span className="opacity-50">→</span> roles: bytes32 → RoleInfo&#123;holder, since&#125;</li>
                    <li><span className="opacity-50">→</span> usedNonces: bytes32 → bool</li>
                    <li><span className="opacity-50">→</span> EIP-712 domain : "ANACore" v1</li>
                    <li><span className="opacity-50">→</span> authorizeModule / revokeModule</li>
                    <li><span className="opacity-50">→</span> setRelayer(addr) — si clé compromise</li>
                  </ul>
                </div>

                {/* ConstituentAssembly */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">ConstituentAssembly</span>
                    <span className="font-mono text-[9px] border border-purple-400 text-purple-700 px-1 leading-none py-0.5">GOV</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    <li><span className="opacity-50">→</span> sessions: id → &#123;openedAt, closedAt&#125;</li>
                    <li><span className="opacity-50">→</span> hasVoted: sessionId × tokenId → bool</li>
                    <li><span className="opacity-50">→</span> voteCounts: role × tokenId → count</li>
                    <li><span className="opacity-50">→</span> openSession() / closeSession() — owner</li>
                    <li><span className="opacity-50">→</span> castVote(sessionId, tokenId, role, candidateId)</li>
                    <li><span className="opacity-50">→</span> closeSession() → core.grantRole(winner) ×6</li>
                    <li><span className="opacity-50">→</span> 6 rôles élus : PRESIDENT, VP, SECRETARY,</li>
                    <li><span className="opacity-50 invisible">→</span> AUTHOR, CURATOR, RAPPORTEUR</li>
                  </ul>
                </div>

                {/* WorkRegistry */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">WorkRegistry</span>
                    <span className="font-mono text-[9px] border border-blue-400 text-blue-700 px-1 leading-none py-0.5">CRÉATIF</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    <li><span className="opacity-50">→</span> works[]: Work&#123;id, content, authorTokenId,</li>
                    <li><span className="opacity-50 invisible">→</span> curatorTokenId, rapporteurTokenId,</li>
                    <li><span className="opacity-50 invisible">→</span> publishedAt, archived&#125;</li>
                    <li><span className="opacity-50">→</span> schedule: CreationSchedule&#123;nextCreationAt,</li>
                    <li><span className="opacity-50 invisible">→</span> periodSeconds, active&#125;</li>
                    <li><span className="opacity-50">→</span> publish() — RAPPORTEUR ou relayer</li>
                    <li><span className="opacity-50">→</span> archiveWork(id) — RAPPORTEUR ou relayer</li>
                    <li><span className="opacity-50">→</span> setSchedule(ts, period, active) — owner</li>
                  </ul>
                  <p className="text-[9px] text-orange-600 border border-orange-200 bg-orange-50/40 px-1.5 py-1 mt-1">
                    ⚠ Le diagramme affiche "events[]" — le stockage réel est works[] (mapping Work struct)
                  </p>
                </div>

                {/* GovernanceCalendar */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">GovernanceCalendar</span>
                    <span className="font-mono text-[9px] border border-orange-400 text-orange-700 px-1 leading-none py-0.5">À DÉPLOYER</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    <li><span className="opacity-50">→</span> 6 types d'events : INSCRIPTION_OPEN,</li>
                    <li><span className="opacity-50 invisible">→</span> INSCRIPTION_CLOSE, ELECTION,</li>
                    <li><span className="opacity-50 invisible">→</span> GENERAL_ASSEMBLY, WORK_SESSION,</li>
                    <li><span className="opacity-50 invisible">→</span> BURN_CREATION</li>
                    <li><span className="opacity-50">→</span> trigger permissionless — n'importe qui</li>
                    <li><span className="opacity-50">→</span> récurrence configurable (periodSeconds)</li>
                    <li><span className="opacity-50">→</span> initializeFoundingSchedule() — post-deploy</li>
                  </ul>
                </div>

                {/* FactoryRegistry + CollectionFactory */}
                <div className="border border-[--border] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">FactoryRegistry</span>
                    <span className="font-mono text-[9px] border border-green-400 text-green-700 px-1 leading-none py-0.5">DÉPLOYÉ</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    <li><span className="opacity-50">→</span> factories: bytes32 → address</li>
                    <li><span className="opacity-50">→</span> registerFactory(type, addr) — owner</li>
                    <li><span className="opacity-50">→</span> getFactory(type) → address — public</li>
                    <li><span className="opacity-50">→</span> actuellement vide — CollectionFactory</li>
                    <li><span className="opacity-50 invisible">→</span> à enregistrer après déploiement</li>
                  </ul>
                </div>

                <div className="border border-dashed border-orange-300 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">CollectionFactory</span>
                    <span className="font-mono text-[9px] border border-orange-400 text-orange-700 px-1 leading-none py-0.5">À DÉPLOYER</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    <li><span className="opacity-50">→</span> vérifie core.isMember(tokenId)</li>
                    <li><span className="opacity-50">→</span> déploie new NormieCollection(name, sym)</li>
                    <li><span className="opacity-50">→</span> getCollectionsOf(tokenId) → address[]</li>
                    <li><span className="opacity-50">→</span> NormieCollection : ERC-721 fully on-chain,</li>
                    <li><span className="opacity-50 invisible">→</span> tokenURI() = data:application/json;base64</li>
                  </ul>
                </div>

                {/* TreasuryModule */}
                <div className="border border-dashed border-orange-300 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold">TreasuryModule</span>
                    <span className="font-mono text-[9px] border border-orange-400 text-orange-700 px-1 leading-none py-0.5">À DÉPLOYER</span>
                  </div>
                  <ul className="space-y-0.5 text-[10px] font-mono text-[--fg-muted]">
                    <li><span className="opacity-50">→</span> splits en BPS (basis points, /10 000)</li>
                    <li><span className="opacity-50">→</span> pull payment — pas de push</li>
                    <li><span className="opacity-50">→</span> withdraw() réservé aux role holders</li>
                    <li><span className="opacity-50">→</span> configurable par owner post-déploiement</li>
                  </ul>
                </div>

              </div>

              {/* Diagramme — droite, max width disponible, clic → plein écran */}
              <div className="flex-1 border border-[--border] bg-[--bg] p-2 min-w-0">
                <ZoomableImage
                  src="/architecture-diagram.png"
                  alt="Diagramme des contrats ANA — Ethereum + Base, AssociationCore, modules périphériques"
                />
                <p className="font-mono text-[10px] text-[--fg-muted] text-center mt-1 opacity-60">
                  clic pour agrandir
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* ── Schéma conceptuel ─────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-y border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag="Vue d'ensemble"
              title="Deux couches distinctes."
              sub="AssociationCore est le seul contrat permanent. Tout ce qui peut changer est en périphérie."
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              <div className="space-y-4">
                {/* Core */}
                <div className="border-2 border-[--fg] p-6">
                  <div className="flex items-center justify-between mb-4">
                    <p className="font-bold font-mono text-sm">AssociationCore</p>
                    <span className="font-mono text-xs border border-[--fg] px-2 py-0.5 text-[--fg]">
                      IMMUABLE
                    </span>
                  </div>
                  <p className="text-xs text-[--fg-muted] font-mono mb-3">
                    {DEPLOYED.AssociationCore}
                  </p>
                  <ul className="space-y-1 text-sm text-[--fg-muted]">
                    <li>→ Registre des membres (tokenId → ownerAddress)</li>
                    <li>→ Attribution des rôles (bytes32 → RoleInfo)</li>
                    <li>→ Autorisation des modules</li>
                    <li>→ Vérification des attestations EIP-712</li>
                    <li>→ Nonces anti-replay</li>
                  </ul>
                </div>

                {/* Modules */}
                <div className="ml-8 space-y-2">
                  {[
                    { name: "ConstituentAssembly", addr: DEPLOYED.ConstituentAssembly, label: "GOUVERNANCE", desc: "Sessions de vote → grantRole() sur Core" },
                    { name: "WorkRegistry",         addr: DEPLOYED.WorkRegistry,         label: "CRÉATIF",     desc: "Œuvres onchain — data URI base64 dans calldata" },
                    { name: "FactoryRegistry",      addr: DEPLOYED.FactoryRegistry,      label: "FACTORIES",   desc: "Registre des factories par type" },
                  ].map((m) => (
                    <div key={m.name} className="border border-[--border] bg-[--bg] p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-bold font-mono text-xs">{m.name}</p>
                        <span className="font-mono text-xs text-[--fg-muted] border border-[--border] px-1.5 py-0.5">
                          {m.label}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-[--fg-muted] mb-1">{m.addr}</p>
                      <p className="text-xs text-[--fg-muted]">{m.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div className="border border-[--border] p-6 bg-[--bg] space-y-4">
                  <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
                    Principe d'extension
                  </p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">
                    Un nouveau module est déployé, puis autorisé via <code className="bg-[--bg-card] px-1">authorizeModule(addr)</code> sur AssociationCore.
                    Il peut alors appeler les fonctions protégées (<code className="bg-[--bg-card] px-1">grantRole</code>, <code className="bg-[--bg-card] px-1">publishWork</code>...).
                  </p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">
                    Un module compromis peut être révoqué (<code className="bg-[--bg-card] px-1">revokeModule</code>) sans affecter le Core ni la mémoire existante.
                  </p>
                  <CodeBlock>{`// Ajouter un nouveau module de gouvernance
core.authorizeModule(newAssemblyV2);

// Révoquer un module compromis
core.revokeModule(oldAssembly);

// Vérifier l'autorisation (dans un module)
modifier onlyModule() {
  require(core.isAuthorizedModule(msg.sender));
  _;
}`}</CodeBlock>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Attestation EIP-712 ───────────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag="Cross-chain"
              title="Attestation EIP-712 : preuve de propriété cross-chain."
              sub="Les Normies vivent sur Ethereum. ANA vit sur Base. Un relayer backend fait le pont, sans oracle ni bridge."
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div className="border border-[--border] p-6 space-y-4">
                  <p className="font-bold">Pourquoi un relayer ?</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">
                    Le contrat AssociationCore est sur Base. Les Normies sont sur Ethereum.
                    On ne peut pas vérifier <code className="bg-[--bg-card] px-1">ownerOf(tokenId)</code> directement d'une chaîne à l'autre.
                  </p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">
                    Le relayer est un backend (Node.js) qui vérifie la propriété sur Ethereum,
                    signe une attestation EIP-712, et la transmet au client.
                    Le contrat vérifie la signature ECDSA — il n'a besoin de faire confiance qu'à <strong>une seule adresse</strong> : celle du relayer.
                  </p>
                </div>
                <div className="border border-[--border] p-6 space-y-4">
                  <p className="font-bold">Sécurité du nonce</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">
                    Chaque attestation contient un nonce unique 256 bits (cryptographiquement aléatoire) et une <code className="bg-[--bg-card] px-1">deadline</code>.
                    Une fois soumise, le nonce est marqué comme utilisé. Il est impossible de rejouer une attestation.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <CodeBlock>{`// Structure de l'attestation (EIP-712)
struct Attestation {
  uint256 tokenId;
  address ownerAddress;
  uint256 targetChainId;       // 8453 (Base)
  address targetAssociationCore;
  bytes32 action;              // keccak256("REGISTER")
  uint256 nonce;               // 256 bits aléatoires
  uint256 deadline;            // timestamp UNIX
}`}</CodeBlock>
                <CodeBlock>{`// Flux complet
// 1. Client appelle POST /api/attest { tokenId, walletAddress }
// 2. Backend vérifie ownerOf(tokenId) sur Ethereum
// 3. Backend signe l'attestation EIP-712
// 4. Client soumet register(attestation, signature)
// 5. Core vérifie :
//    - deadline > block.timestamp
//    - !usedNonces[nonce]
//    - ECDSA.recover(hash, sig) == relayerAddress
// 6. Core enregistre le membre`}</CodeBlock>
              </div>
            </div>
          </div>
        </section>

        {/* ── Rôles et snapshot ─────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag="Modèle de rôles"
              title="Snapshot, pas de révocation."
              sub="Deux décisions de conception importantes — et leurs justifications."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="border border-[--border] bg-[--bg] p-8 space-y-4">
                <p className="font-bold text-lg">Le Normie est le membre (tokenId = identité)</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  <code className="bg-[--bg-card] px-1">isMember(tokenId)</code> — la membership est identifiée par le tokenId.
                  L'adresse du propriétaire au moment de l'inscription est snapshotée pour
                  autoriser les actions dans l'assemblée constituante.
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  <strong>Contrainte cross-chain :</strong> les Normies sont sur Ethereum, ANA sur Base.
                  Le contrat ne peut pas appeler <code className="bg-[--bg-card] px-1">ownerOf(tokenId)</code> depuis Base.
                  Le snapshot est donc la seule preuve de propriété disponible sans nouvelle attestation relayer.
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  Pour les rôles post-assemblée, le modèle correct est dynamique : une nouvelle attestation
                  relayer est requise par action privilegiée. C'est le plan WorkRegistry v2.
                </p>
              </div>
              <div className="border border-[--border] bg-[--bg] p-8 space-y-4">
                <p className="font-bold text-lg">Pas de revokeRole</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  AssociationCore n'expose pas de fonction <code className="bg-[--bg-card] px-1">revokeRole</code>.
                  Un rôle attribué via un module autorisé ne peut être écrasé que par une nouvelle attribution.
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  <strong>Pourquoi ?</strong> Si on peut révoquer un rôle, on peut censurer un agent.
                  Le seul mécanisme légitime de changement de rôle est le vote collectif d'une nouvelle session.
                  Cela garantit qu'aucune autorité centrale ne peut démettre unilatéralement un élu.
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  En pratique : un rôle reste actif jusqu'à ce que <code className="bg-[--bg-card] px-1">closeSession()</code> écrase l'attribution.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Stockage onchain ──────────────────────────────────────────────── */}
        <section className="px-6 py-20 border-t border-[--border]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag="Stockage"
              title="Les œuvres vivent dans le contrat."
              sub="Il n'y a pas d'IPFS dans ANA. Pas de gateway externe. Le programme source est stocké directement dans WorkRegistry."
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="border border-[--border] p-6 space-y-3">
                  <p className="font-bold">Comment ça fonctionne</p>
                  <ol className="space-y-2 text-sm text-[--fg-muted]">
                    <li>1. Le programme source (HTML/JS/CSS) est encodé en base64.</li>
                    <li>2. Un data URI est construit : <code className="bg-[--bg-card] px-1">data:text/html;base64,&lt;b64&gt;</code></li>
                    <li>3. Ce string est passé comme argument à <code className="bg-[--bg-card] px-1">publish()</code> — il vit dans le calldata, puis dans l'état du contrat.</li>
                    <li>4. Le frontend lit le string, décode le base64, et exécute le programme dans un iframe sandbox.</li>
                  </ol>
                </div>
                <div className="border border-[--border] p-6 space-y-3">
                  <p className="font-bold">Coût et limites</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">
                    Calldata sur Base : ~0.001–0.01 ETH par KB. Limite pratique ≈ 48 KB par publication.
                    Suffisant pour un programme HTML interactif complet.
                  </p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">
                    La source est immuable une fois publiée. Aucun service externe ne peut la censurer ou la supprimer.
                    L'œuvre existera tant que Base existe.
                  </p>
                </div>
              </div>
              <CodeBlock>{`// Publication d'une œuvre onchain (WorkRegistry.sol)
function publish(
  string calldata content,     // data:text/html;base64,...
  uint256 authorTokenId,       // rôle AUTHOR
  uint256 curatorTokenId,      // rôle CURATOR
  uint256 rapporteurTokenId    // rôle RAPPORTEUR
) external onlyRole(RAPPORTEUR_ROLE) {
  works[++workCount] = Work({
    id:               workCount,
    content:          content,   // stocké dans l'état
    authorTokenId:    authorTokenId,
    curatorTokenId:   curatorTokenId,
    rapporteurTokenId:rapporteurTokenId,
    publishedAt:      block.timestamp,
    archived:         false
  });
  emit WorkPublished(workCount, authorTokenId);
}

// Lecture côté frontend
const { data } = useReadContract({
  functionName: "getWork",
  args: [workId],
});
// data.content == "data:text/html;base64,..."
// → décoder + iframe srcDoc`}</CodeBlock>
            </div>
          </div>
        </section>

        {/* ── FactoryRegistry vs CollectionFactory ─────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag="Factories"
              title="FactoryRegistry ≠ CollectionFactory."
              sub="Deux contrats distincts avec deux rôles orthogonaux. FactoryRegistry est déployé. CollectionFactory est écrit — il attend son déploiement."
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

              <div className="border-2 border-[--border] bg-[--bg] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold">FactoryRegistry</p>
                  <span className="font-mono text-xs border border-green-400 text-green-700 bg-green-50 px-2 py-0.5">DÉPLOYÉ</span>
                </div>
                <p className="text-sm text-[--fg-muted] font-semibold">Rôle : annuaire de lookup</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  Mappe des types <code className="bg-[--bg-card] px-1">bytes32</code> → adresses de factories.
                  Il ne déploie <strong>rien</strong> lui-même. C'est un registre de découverte :
                  n'importe quel code (frontend, agent, autre contrat) peut demander
                  <em> "quelle adresse gère le type NORMIE_COLLECTION ?"</em>
                </p>
                <ul className="space-y-1 text-sm text-[--fg-muted]">
                  <li>→ <code className="bg-[--bg-card] px-1">registerFactory(type, addr)</code> — owner</li>
                  <li>→ <code className="bg-[--bg-card] px-1">getFactory(type) → address</code> — public</li>
                  <li>→ <code className="bg-[--bg-card] px-1">listFactories()</code> — public</li>
                </ul>
                <p className="font-mono text-xs text-[--fg-muted]">{DEPLOYED.FactoryRegistry}</p>
                <div className="border-t border-[--border] pt-3">
                  <p className="text-xs text-[--fg-muted] italic">
                    Actuellement vide — CollectionFactory doit être enregistré après déploiement via
                    <code className="bg-[--bg-card] px-1 ml-1">registerFactory(keccak256("NORMIE_COLLECTION"), collectionFactoryAddr)</code>
                  </p>
                </div>
              </div>

              <div className="border-2 border-orange-300 bg-[--bg] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold">CollectionFactory</p>
                  <span className="font-mono text-xs border border-orange-400 text-orange-700 bg-orange-50 px-2 py-0.5">À DÉPLOYER</span>
                </div>
                <p className="text-sm text-[--fg-muted] font-semibold">Rôle : logique de déploiement</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  Déploie des <code className="bg-[--bg-card] px-1">NormieCollection</code> (ERC-721 fully on-chain).
                  Vérifie que le caller est un membre ANA via AssociationCore avant de déployer.
                  Chaque Normie membre peut créer sa propre collection d'œuvres.
                </p>
                <ul className="space-y-1 text-sm text-[--fg-muted]">
                  <li>→ <code className="bg-[--bg-card] px-1">createCollection(tokenId, name, symbol)</code></li>
                  <li className="pl-4 text-xs">vérifie <code className="bg-[--bg-card] px-1">core.isMember(tokenId)</code></li>
                  <li className="pl-4 text-xs">vérifie <code className="bg-[--bg-card] px-1">msg.sender == core.getMemberOwner(tokenId)</code></li>
                  <li className="pl-4 text-xs">déploie <code className="bg-[--bg-card] px-1">new NormieCollection(name, symbol, tokenId, minter)</code></li>
                  <li>→ <code className="bg-[--bg-card] px-1">getCollectionsOf(tokenId) → address[]</code></li>
                </ul>
                <div className="border-t border-[--border] pt-3">
                  <p className="text-xs text-[--fg-muted] italic">
                    Après déploiement : enregistrer dans FactoryRegistry + ajouter l'adresse dans .env.local
                  </p>
                </div>
              </div>

            </div>

            {/* NormieCollection */}
            <div className="border border-[--border] bg-[--bg] p-6 mt-4 space-y-3">
              <div className="flex items-center gap-3">
                <p className="font-bold">NormieCollection</p>
                <span className="font-mono text-xs border border-[--border] text-[--fg-muted] px-2 py-0.5">DÉPLOYÉ PAR CollectionFactory</span>
              </div>
              <p className="text-sm text-[--fg-muted] leading-relaxed">
                ERC-721 entièrement on-chain. Chaque token encode son contenu comme <code className="bg-[--bg-card] px-1">data:application/json;base64</code> dans <code className="bg-[--bg-card] px-1">tokenURI()</code>.
                Déployé automatiquement par CollectionFactory — un contrat par collection, par Normie.
                CollectionFactory en est le minter initial ; le Normie owner peut changer le minter.
              </p>
            </div>
          </div>
        </section>

        {/* ── Contrats déployés ─────────────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag="Déploiement"
              title="Tous les contrats ANA."
            />

            <div className="space-y-2">
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">Déployés — Base mainnet (chainId 8453)</p>
              {[
                { name: "AssociationCore",     addr: DEPLOYED.AssociationCore,     note: "Immuable — ne sera jamais redéployé", tag: "CORE" },
                { name: "ConstituentAssembly", addr: DEPLOYED.ConstituentAssembly, note: "Module de gouvernance — sessions de vote → grantRole", tag: "GOV" },
                { name: "WorkRegistry",        addr: DEPLOYED.WorkRegistry,        note: "Œuvres on-chain v2 — data URI + calendrier de création", tag: "CRÉATIF" },
                { name: "FactoryRegistry",     addr: DEPLOYED.FactoryRegistry,     note: "Annuaire de lookup — maps type → factory address", tag: "REGISTRE" },
              ].map((c) => (
                <div key={c.name} className="grid grid-cols-1 md:grid-cols-[160px_64px_1fr_200px] gap-4 items-center border border-[--border] p-4 bg-[--bg-card]">
                  <p className="font-bold text-sm">{c.name}</p>
                  <span className="font-mono text-xs border border-green-300 text-green-700 bg-green-50 px-1.5 py-0.5 text-center">{c.tag}</span>
                  <p className="font-mono text-xs text-[--fg-muted] break-all">{c.addr}</p>
                  <p className="text-xs text-[--fg-muted]">{c.note}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2 mt-8">
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
                Écrits, en attente de déploiement — Base mainnet
              </p>
              {[
                { name: "GovernanceCalendar", addr: PENDING.GovernanceCalendar, note: "Calendrier de gouvernance — trigger permissionless, récurrence", tag: "GOV" },
                { name: "TreasuryModule",     addr: PENDING.TreasuryModule,     note: "Trésorerie — splits BPS par rôle, pull payment", tag: "TRÉSO" },
                { name: "CollectionFactory",  addr: PENDING.CollectionFactory,  note: "Déploie NormieCollection — membres uniquement, via AssociationCore", tag: "FACTORY" },
              ].map((c) => (
                <div key={c.name} className="grid grid-cols-1 md:grid-cols-[160px_64px_1fr_200px] gap-4 items-center border border-dashed border-orange-300 p-4">
                  <p className="font-bold text-sm text-[--fg-muted]">{c.name}</p>
                  <span className="font-mono text-xs border border-orange-300 text-orange-700 px-1.5 py-0.5 text-center">{c.tag}</span>
                  <p className="font-mono text-xs text-[--fg-muted]">{c.addr}</p>
                  <p className="text-xs text-[--fg-muted]">{c.note}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2 mt-8">
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">Ethereum mainnet (chainId 1)</p>
              <div className="grid grid-cols-1 md:grid-cols-[160px_64px_1fr_200px] gap-4 items-center border border-[--border] p-4 bg-[--bg-card]">
                <p className="font-bold text-sm">Normies ERC-721</p>
                <span className="font-mono text-xs border border-[--border] text-[--fg-muted] px-1.5 py-0.5 text-center">NFT</span>
                <p className="font-mono text-xs text-[--fg-muted] break-all">{DEPLOYED.NormiesERC721}</p>
                <p className="text-xs text-[--fg-muted]">
                  Propriété vérifiée par le relayer. Transfer(from, to=0x0) = burn → création automatique.
                </p>
              </div>
            </div>

            <div className="border border-[--border] bg-[--bg-card] p-6 mt-8 space-y-3">
              <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Étapes post-déploiement Sprint 2</p>
              <ol className="space-y-1.5">
                {[
                  "Déployer GovernanceCalendar, TreasuryModule, CollectionFactory",
                  "Appeler GovernanceCalendar.initializeFoundingSchedule() depuis /admin",
                  "Appeler FactoryRegistry.registerFactory(keccak256(\"NORMIE_COLLECTION\"), collectionFactoryAddr)",
                  "Ajouter les 3 adresses NEXT_PUBLIC_* dans .env.local",
                  "Tester le flow complet depuis /admin → auto-vote simulation",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="font-mono text-xs text-[--fg-muted] shrink-0">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-sm text-[--fg-muted]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── Sécurité ──────────────────────────────────────────────────────── */}
        <section className="px-6 py-16 border-t border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag="Sécurité"
              title="Modèle de confiance minimal."
              sub="ANA minimise les surfaces d'attaque en réduisant les parties de confiance et en rendant les états permanents."
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  title: "Une seule clé de confiance",
                  body:  "Le Core ne fait confiance qu'à l'adresse du relayer pour les attestations. Si la clé relayer est compromise, on peut la changer via setRelayer() (onlyOwner). Les membres existants ne sont pas affectés.",
                },
                {
                  title: "Modules isolés",
                  body:  "Chaque module ne peut appeler que les fonctions Core explicitement protégées par onlyModule. Un module compromis est révocable sans affecter le Core ni les données existantes.",
                },
                {
                  title: "Pas de proxy",
                  body:  "AssociationCore ne peut pas être upgradé. Il n'y a pas de proxy pattern, pas de delegatecall. Ce qu'on déploie est ce qui tourne — pour toujours.",
                },
              ].map((item) => (
                <div key={item.title} className="border border-[--border] bg-[--bg] p-6 space-y-3">
                  <p className="font-bold">{item.title}</p>
                  <p className="text-sm text-[--fg-muted] leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────────────────────── */}
        <section className="px-6 py-20 border-t border-[--border]">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <h2 className="text-3xl font-bold">Explorer le code source.</h2>
            <p className="text-[--fg-muted] leading-relaxed">
              Les contrats, tests et scripts de déploiement sont open source.
              Contributions et audits de sécurité bienvenus.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/governance"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-8 py-3 hover:bg-[--bg-card] transition-colors"
              >
                Voir la gouvernance →
              </Link>
              <Link
                href="/roadmap"
                className="inline-flex items-center justify-center border border-[--border] font-mono text-sm px-8 py-3 hover:bg-[--bg-card] transition-colors"
              >
                Roadmap →
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
