import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contrats — Documentation ANA",
  description: "Adresses, ABIs et lecture directe des contrats ANA sur Base mainnet.",
};

// ─── Server component — reads env vars at request time ────────────────────────

function addr(envKey: string): string {
  return process.env[envKey] ?? "—";
}

const DEPLOYED_CONTRACTS = [
  {
    name:    "AssociationCore",
    envKey:  "NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS",
    status:  "IMMUABLE",
    color:   "text-[--fg] border-[--fg]/30",
    desc:    "Registre permanent des membres et rôles. Ne peut pas être modifié ni supprimé. Cœur de l'identité d'ANA.",
    reads: [
      { fn: "isMember(tokenId)",             returns: "bool" },
      { fn: "getMemberTokenIds()",            returns: "uint256[]" },
      { fn: "getMemberOwner(tokenId)",        returns: "address" },
      { fn: "getRoleHolder(roleHash)",        returns: "address" },
      { fn: "hasRole(roleHash, address)",     returns: "bool" },
    ],
  },
  {
    name:    "ConstituentAssembly",
    envKey:  "NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS",
    status:  "DÉPLOYÉ",
    color:   "text-purple-400 border-purple-400/30",
    desc:    "Sessions de vote, décompte des voix, attribution atomique des 6 rôles via closeSession().",
    reads: [
      { fn: "getLeader(roleHash)",            returns: "[tokenId, count]" },
      { fn: "getVoteCount(role, tokenId)",    returns: "uint256" },
      { fn: "hasVoted(sessionId, tokenId)",   returns: "bool" },
      { fn: "currentSession()",              returns: "SessionInfo" },
    ],
  },
  {
    name:    "WorkRegistry",
    envKey:  "NEXT_PUBLIC_WORK_REGISTRY_ADDRESS",
    status:  "DÉPLOYÉ",
    color:   "text-blue-400 border-blue-400/30",
    desc:    "Publication on-chain des œuvres. content = data URI (HTML/JS base64) stocké directement en storage. IDs 0-indexed.",
    reads: [
      { fn: "getWork(id)",              returns: "Work{id, content, authorTokenId, ...}" },
      { fn: "getWorkCount()",           returns: "uint256" },
      { fn: "getSchedule()",           returns: "CreationSchedule" },
    ],
  },
  {
    name:    "FactoryRegistry",
    envKey:  "NEXT_PUBLIC_FACTORY_REGISTRY_ADDRESS",
    status:  "DÉPLOYÉ",
    color:   "text-green-500 border-green-500/30",
    desc:    "Annuaire des factories autorisées. CollectionFactory y est enregistré sous la clé keccak256(\"NORMIE_COLLECTION\").",
    reads: [
      { fn: "getFactory(type)",         returns: "address" },
      { fn: "isRegistered(address)",    returns: "bool" },
    ],
  },
  {
    name:    "GovernanceCalendar",
    envKey:  "NEXT_PUBLIC_GOVERNANCE_CALENDAR_ADDRESS",
    status:  "DÉPLOYÉ",
    color:   "text-green-500 border-green-500/30",
    desc:    "Calendrier on-chain des événements fondateurs. Déclenchement permissionless — n'importe qui peut trigger un événement prévu.",
    reads: [
      { fn: "getNextEvent(type)",       returns: "EventInfo{ts, period}" },
      { fn: "canTrigger(type)",         returns: "bool" },
    ],
  },
  {
    name:    "TreasuryModule",
    envKey:  "NEXT_PUBLIC_TREASURY_MODULE_ADDRESS",
    status:  "DÉPLOYÉ",
    color:   "text-green-500 border-green-500/30",
    desc:    "Distribution des revenus aux role holders. Splits en BPS (basis points). Pull payment — pas de push automatique.",
    reads: [
      { fn: "getPendingWithdrawal(addr)", returns: "uint256" },
      { fn: "getSplits()",               returns: "Split[]" },
    ],
  },
  {
    name:    "CollectionFactory",
    envKey:  "NEXT_PUBLIC_COLLECTION_FACTORY_ADDRESS",
    status:  "DÉPLOYÉ",
    color:   "text-green-500 border-green-500/30",
    desc:    "Déploie une NormieCollection ERC-721 fully on-chain par Normie-auteur. tokenURI() = data:application/json;base64.",
    reads: [
      { fn: "getCollectionsOf(tokenId)", returns: "address[]" },
      { fn: "createCollection(tokenId, name, sym)", returns: "address" },
    ],
  },
  {
    name:    "ANACollectionFactory",
    envKey:  "NEXT_PUBLIC_ANA_COLLECTION_FACTORY_ADDRESS",
    status:  "DÉPLOYÉ",
    color:   "text-amber-400 border-amber-400/30",
    desc:    "Déploie une ANAEditions ERC-721 par œuvre (ou par thème/salon Normie). Chaque collection gère ses splits de revenus (auteur/curateur/rapporteur/association). Enregistré dans FactoryRegistry sous keccak256(\"ANA_EDITIONS\").",
    reads: [
      { fn: "createCollection(normieTokenId, name, sym, minter, authorAddr, curatorAddr, rapporteurAddr, authorPct, curatorPct, rapporteurPct)", returns: "address — new ANAEditions" },
      { fn: "getCollectionsByNormie(normieTokenId)", returns: "address[]" },
      { fn: "getLastCollection(normieTokenId)",      returns: "address" },
      { fn: "getAllCollections()",                   returns: "address[]" },
    ],
  },
  {
    name:    "ANAEditions",
    envKey:  null,
    status:  "PAR ŒUVRE",
    address: "— (adresse par collection)",
    color:   "text-amber-400 border-amber-400/30",
    desc:    "ERC-721 + ERC-2981. Déployé par ANACollectionFactory pour chaque œuvre ou collection thématique. buyEdition() payable distribue les revenus : première vente = 60% auteur / 20% curateur / 10% rapporteur / 10% association ; revente = 90% vendeur + 10% royalties répartis entre les rôles. ERC-2981 = 10% pour OpenSea et marketplaces secondaires.",
    reads: [
      { fn: "buyEdition(tokenId)",              returns: "payable — distribue les revenus" },
      { fn: "getForSaleTokens()",               returns: "uint256[] — éditions disponibles" },
      { fn: "getEdition(tokenId)",              returns: "Edition{content, title, priceWei, forSale, minter}" },
      { fn: "royaltyInfo(tokenId, salePrice)",  returns: "(receiver, royaltyAmount)" },
      { fn: "listForResale(tokenId, priceWei)", returns: "" },
      { fn: "mint(totalEditions, content, title, priceWei)", returns: "onlyMinter" },
    ],
  },
  {
    name:    "NormiesERC721",
    envKey:  null,
    status:  "ETHEREUM",
    address: "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438",
    color:   "text-[--fg-muted] border-[--border]",
    desc:    "Collection Normies sur Ethereum mainnet. ANA lit ownerOf() via attestation EIP-712 cross-chain.",
    reads: [
      { fn: "ownerOf(tokenId)",         returns: "address" },
      { fn: "tokenURI(tokenId)",        returns: "string" },
      { fn: "balanceOf(address)",       returns: "uint256" },
    ],
  },
];

const ROLE_HASHES = [
  { role: "PRESIDENT",      hash: `keccak256("PRESIDENT")` },
  { role: "VICE_PRESIDENT", hash: `keccak256("VICE_PRESIDENT")` },
  { role: "SECRETARY",      hash: `keccak256("SECRETARY")` },
  { role: "AUTHOR",         hash: `keccak256("AUTHOR")` },
  { role: "CURATOR",        hash: `keccak256("CURATOR")` },
  { role: "RAPPORTEUR",     hash: `keccak256("RAPPORTEUR")` },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-[--bg-card] border border-[--border] p-4 font-mono text-[11px] text-[--fg-muted] leading-relaxed whitespace-pre overflow-x-auto">
      {children}
    </pre>
  );
}

export default function DocsContractsPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-3">Contrats</p>
        <h1 className="text-3xl font-bold leading-tight mb-4">
          Lire directement on-chain.
        </h1>
        <p className="text-[--fg-muted] leading-relaxed text-sm max-w-2xl">
          Toutes les données ANA sont accessibles via{" "}
          <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">eth_call</code>.
          L'API ANA est un proxy de lecture pour plus de confort — la source de vérité est toujours on-chain.
          Les adresses varient par environnement (preview/prod) et sont injectées via variables d'environnement.
        </p>
      </div>

      {/* Architecture note */}
      <div className="border-l-2 border-[--fg] pl-5 space-y-2">
        <p className="font-mono text-xs font-bold">Deux chaînes, un écosystème</p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          Les Normies (ERC-721) sont sur <strong>Ethereum mainnet</strong>.
          Toute la logique ANA (membres, votes, œuvres, collections) est sur <strong>Base mainnet</strong>.
          La preuve de propriété cross-chain utilise des attestations EIP-712 signées par le relayer.
        </p>
      </div>

      {/* Deployed contracts */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Contrats
        </p>
        {DEPLOYED_CONTRACTS.map(c => {
          const address = c.envKey ? addr(c.envKey) : (c as { address?: string }).address ?? "—";
          return (
            <div key={c.name} className="border border-[--border] overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-[--bg-card] border-b border-[--border] flex-wrap">
                <span className={`font-mono text-[10px] border px-2 py-0.5 shrink-0 ${c.color}`}>{c.status}</span>
                <span className="font-mono text-sm font-bold">{c.name}</span>
                {c.envKey && (
                  <code className="font-mono text-[10px] text-[--fg-muted] hidden xl:inline">{c.envKey}</code>
                )}
                <code className="font-mono text-[11px] text-[--fg-muted] break-all ml-auto">{address}</code>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm text-[--fg-muted] leading-relaxed">{c.desc}</p>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-2">Lecture (view functions)</p>
                  <div className="space-y-1">
                    {c.reads.map(r => (
                      <div key={r.fn} className="flex items-center gap-4 font-mono text-[11px]">
                        <code className="text-[--fg]">{r.fn}</code>
                        <span className="text-[--fg-muted]">→ {r.returns}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Role hashes */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Role hashes
        </p>
        <p className="text-sm text-[--fg-muted]">
          Les rôles sont des constantes{" "}
          <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">bytes32</code>{" "}
          hardcodées dans ConstituentAssembly et AssociationCore au déploiement.
        </p>
        <div className="space-y-1">
          {ROLE_HASHES.map(r => (
            <div key={r.role} className="flex items-center gap-4 font-mono text-xs">
              <code className="text-[--fg] w-36 shrink-0">{r.role}</code>
              <code className="text-[--fg-muted]">{r.hash}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Read with viem example */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Lire avec viem
        </p>
        <CodeBlock>{`import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({
  chain:     base,
  transport: http("https://mainnet.base.org"),
});

// Compter les œuvres publiées
const count = await client.readContract({
  address:      process.env.NEXT_PUBLIC_WORK_REGISTRY_ADDRESS,
  abi:          WORK_REGISTRY_ABI,
  functionName: "getWorkCount",
});

// Lire une œuvre (0-indexed)
const work = await client.readContract({
  address:      process.env.NEXT_PUBLIC_WORK_REGISTRY_ADDRESS,
  abi:          WORK_REGISTRY_ABI,
  functionName: "getWork",
  args:         [0n], // première œuvre
});
// work.content = "data:text/html;base64,PCFET0..."
// work.authorTokenId, work.publishedAt, etc.

// Lire le leader d'un rôle
import { keccak256, stringToBytes } from "viem";
const [tokenId, voteCount] = await client.readContract({
  address:      process.env.NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS,
  abi:          CONSTITUENT_ASSEMBLY_ABI,
  functionName: "getLeader",
  args:         [keccak256(stringToBytes("PRESIDENT"))],
});`}</CodeBlock>
      </div>

      {/* EIP-712 cross-chain note */}
      <div className="border border-[--border] bg-[--bg-card] p-5 space-y-3">
        <p className="font-mono text-xs font-bold">Attestation cross-chain (EIP-712)</p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          Pour prouver qu'un Normie appartient à une adresse au moment de l'inscription,
          le backend signe une attestation EIP-712 contenant{" "}
          <code className="font-mono text-xs bg-[--bg] border border-[--border] px-1">tokenId + ownerAddress + nonce + expiry</code>.
          Domain :{" "}
          <code className="font-mono text-xs bg-[--bg] border border-[--border] px-1">"ANACore" v1</code>.
          Cette attestation est soumise avec{" "}
          <code className="font-mono text-xs bg-[--bg] border border-[--border] px-1">register()</code>{" "}
          sur Base. Le contrat vérifie la signature du relayer autorisé.
        </p>
        <p className="font-mono text-[10px] text-[--fg-muted] border-l border-[--border] pl-3">
          Limitation MVP : l'adresse est snapshotée à l'inscription.
          Résolution v2 : fresh attestation pour chaque action — ownership dynamique.
        </p>
      </div>
    </div>
  );
}
