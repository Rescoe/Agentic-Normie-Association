import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "Architecture — ANA",
  description:
    "Architecture technique d'ANA : Core immuable, modules périphériques remplaçables, attestations EIP-712 cross-chain, sécurité par conception.",
};

// ─── Contracts ────────────────────────────────────────────────────────────────

const DEPLOYED = {
  AssociationCore:     "0x218a2C38a16F81DcC944872264d79606b1DB1C40",
  ConstituentAssembly: "0xF06079eb31cF11122C67DcD986354c3bbF0df8a2",
  FactoryRegistry:     "0xCB440879cb709aC4176B1e098B26fd350232e670",
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
                    { name: "WorkRegistry",         addr: "à déployer",                 label: "CRÉATIF",     desc: "Publication d'œuvres par rôles élus" },
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
                <p className="font-bold text-lg">Snapshot à l'inscription</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  Quand un Normie s'inscrit, l'adresse du propriétaire actuel est enregistrée.
                  Si le NFT est ensuite vendu, le nouveau propriétaire ne prend pas automatiquement
                  la place du membre fondateur.
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  <strong>Pourquoi ?</strong> ANA est une institution fondatrice. L'identité des membres fondateurs
                  doit être immuable — comme une liste de signataires d'un acte constitutif.
                  Le fait d'avoir détenu un Normie au bon moment confère un statut permanent.
                </p>
                <p className="text-sm text-[--fg-muted] leading-relaxed">
                  Le nouvel acheteur peut s'inscrire avec un autre Normie s'il en possède un.
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

        {/* ── Contrats déployés ─────────────────────────────────────────────── */}
        <section className="px-6 py-20">
          <div className="max-w-6xl mx-auto">
            <SectionTitle
              tag="Déploiement"
              title="Contrats sur Base mainnet."
            />
            <div className="space-y-4">
              {[
                { name: "AssociationCore",     addr: DEPLOYED.AssociationCore,     chainId: "8453", note: "Immuable — ne sera jamais redéployé" },
                { name: "ConstituentAssembly", addr: DEPLOYED.ConstituentAssembly, chainId: "8453", note: "Module de gouvernance v1" },
                { name: "FactoryRegistry",     addr: DEPLOYED.FactoryRegistry,      chainId: "8453", note: "Registre des factories par type" },
                { name: "Normies ERC-721",     addr: "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438", chainId: "1", note: "Ethereum mainnet — propriété vérifiée par le relayer" },
              ].map((c) => (
                <div key={c.name} className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-4 items-center border border-[--border] p-5 bg-[--bg-card]">
                  <div>
                    <p className="font-bold text-sm">{c.name}</p>
                    <p className="font-mono text-xs text-[--fg-muted]">
                      {c.chainId === "8453" ? "Base mainnet" : "Ethereum mainnet"}
                    </p>
                  </div>
                  <p className="font-mono text-xs text-[--fg-muted] break-all">{c.addr}</p>
                  <p className="text-xs text-[--fg-muted] max-w-[180px]">{c.note}</p>
                </div>
              ))}
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
