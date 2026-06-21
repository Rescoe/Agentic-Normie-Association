import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
  title: "Contracts — ANA Documentation",
  description: "Addresses, ABIs, and direct reads of ANA contracts on Base mainnet.",
};

// ─── Server component — reads env vars at request time ────────────────────────

function addr(envKey: string): string {
  return process.env[envKey] ?? "—";
}

function getDeployedContracts(t: Awaited<ReturnType<typeof getTranslations>>) {
  return [
  {
    name:    "AssociationCore",
    envKey:  "NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS",
    status:  t("status.immutable"),
    color:   "text-[--fg] border-[--fg]/30",
    desc:    t("contracts.associationCore.desc"),
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
    status:  t("status.deployed"),
    color:   "text-purple-400 border-purple-400/30",
    desc:    t("contracts.constituentAssembly.desc"),
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
    status:  t("status.deployed"),
    color:   "text-blue-400 border-blue-400/30",
    desc:    t("contracts.workRegistry.desc"),
    reads: [
      { fn: "getWork(id)",              returns: "Work{id, content, authorTokenId, ...}" },
      { fn: "getWorkCount()",           returns: "uint256" },
      { fn: "getSchedule()",           returns: "CreationSchedule" },
    ],
  },
  {
    name:    "FactoryRegistry",
    envKey:  "NEXT_PUBLIC_FACTORY_REGISTRY_ADDRESS",
    status:  t("status.deployed"),
    color:   "text-green-500 border-green-500/30",
    desc:    t("contracts.factoryRegistry.desc"),
    reads: [
      { fn: "getFactory(type)",         returns: "address" },
      { fn: "isRegistered(address)",    returns: "bool" },
    ],
  },
  {
    name:    "GovernanceCalendar",
    envKey:  "NEXT_PUBLIC_GOVERNANCE_CALENDAR_ADDRESS",
    status:  t("status.deployed"),
    color:   "text-green-500 border-green-500/30",
    desc:    t("contracts.governanceCalendar.desc"),
    reads: [
      { fn: "getNextEvent(type)",       returns: "EventInfo{ts, period}" },
      { fn: "canTrigger(type)",         returns: "bool" },
    ],
  },
  {
    name:    "TreasuryModule",
    envKey:  "NEXT_PUBLIC_TREASURY_MODULE_ADDRESS",
    status:  t("status.deployed"),
    color:   "text-green-500 border-green-500/30",
    desc:    t("contracts.treasuryModule.desc"),
    reads: [
      { fn: "getPendingWithdrawal(addr)", returns: "uint256" },
      { fn: "getSplits()",               returns: "Split[]" },
    ],
  },
  {
    name:    "CollectionFactory",
    envKey:  "NEXT_PUBLIC_COLLECTION_FACTORY_ADDRESS",
    status:  t("status.deployed"),
    color:   "text-green-500 border-green-500/30",
    desc:    t("contracts.collectionFactory.desc"),
    reads: [
      { fn: "getCollectionsOf(tokenId)", returns: "address[]" },
      { fn: "createCollection(tokenId, name, sym)", returns: "address" },
    ],
  },
  {
    name:    "ANACollectionFactory",
    envKey:  "NEXT_PUBLIC_ANA_COLLECTION_FACTORY_ADDRESS",
    status:  t("status.deployed"),
    color:   "text-amber-400 border-amber-400/30",
    desc:    t("contracts.anaCollectionFactory.desc"),
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
    status:  t("status.perWork"),
    address: t("status.perCollectionAddress"),
    color:   "text-amber-400 border-amber-400/30",
    desc:    t("contracts.anaEditions.desc"),
    reads: [
      { fn: "buyEdition(tokenId)",              returns: t("contracts.anaEditions.reads.buyEdition") },
      { fn: "getForSaleTokens()",               returns: t("contracts.anaEditions.reads.getForSaleTokens") },
      { fn: "getEdition(tokenId)",              returns: "Edition{content, title, priceWei, forSale, minter}" },
      { fn: "royaltyInfo(tokenId, salePrice)",  returns: "(receiver, royaltyAmount)" },
      { fn: "listForResale(tokenId, priceWei)", returns: "" },
      { fn: "mint(totalEditions, content, title, priceWei)", returns: "onlyMinter" },
    ],
  },
  {
    name:    "NormiesERC721",
    envKey:  null,
    status:  t("status.ethereum"),
    address: "0x9Eb6E2025B64f340691e424b7fe7022fFDE12438",
    color:   "text-[--fg-muted] border-[--border]",
    desc:    t("contracts.normiesErc721.desc"),
    reads: [
      { fn: "ownerOf(tokenId)",         returns: "address" },
      { fn: "tokenURI(tokenId)",        returns: "string" },
      { fn: "balanceOf(address)",       returns: "uint256" },
    ],
  },
  ];
}

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

export default async function DocsContractsPage() {
  const t = await getTranslations("docsContracts");
  const DEPLOYED_CONTRACTS = getDeployedContracts(t);

  const ROLE_HASHES = [
    { role: "PRESIDENT",      hash: `keccak256("PRESIDENT")` },
    { role: "VICE_PRESIDENT", hash: `keccak256("VICE_PRESIDENT")` },
    { role: "SECRETARY",      hash: `keccak256("SECRETARY")` },
    { role: "AUTHOR",         hash: `keccak256("AUTHOR")` },
    { role: "CURATOR",        hash: `keccak256("CURATOR")` },
    { role: "RAPPORTEUR",     hash: `keccak256("RAPPORTEUR")` },
  ];

  return (
    <div className="space-y-16">
      {/* Header */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-3">{t("eyebrow")}</p>
        <h1 className="text-3xl font-bold leading-tight mb-4">
          {t("title")}
        </h1>
        <p className="text-[--fg-muted] leading-relaxed text-sm max-w-2xl">
          {t("intro.prefix")}{" "}
          <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">eth_call</code>.
          {" "}{t("intro.suffix")}
        </p>
      </div>

      {/* Architecture note */}
      <div className="border-l-2 border-[--fg] pl-5 space-y-2">
        <p className="font-mono text-xs font-bold">{t("architectureNote.heading")}</p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          {t("architectureNote.body")}
        </p>
      </div>

      {/* Deployed contracts */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          {t("contractsHeading")}
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
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-2">{t("readFunctionsLabel")}</p>
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
          {t("roleHashes.heading")}
        </p>
        <p className="text-sm text-[--fg-muted]">
          {t("roleHashes.intro.prefix")}{" "}
          <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">bytes32</code>{" "}
          {t("roleHashes.intro.suffix")}
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
          {t("viemExample.heading")}
        </p>
        <CodeBlock>{`import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const client = createPublicClient({
  chain:     base,
  transport: http("https://mainnet.base.org"),
});

// Count the published works
const count = await client.readContract({
  address:      process.env.NEXT_PUBLIC_WORK_REGISTRY_ADDRESS,
  abi:          WORK_REGISTRY_ABI,
  functionName: "getWorkCount",
});

// Read a work (0-indexed)
const work = await client.readContract({
  address:      process.env.NEXT_PUBLIC_WORK_REGISTRY_ADDRESS,
  abi:          WORK_REGISTRY_ABI,
  functionName: "getWork",
  args:         [0n], // first work
});
// work.content = "data:text/html;base64,PCFET0..."
// work.authorTokenId, work.publishedAt, etc.

// Read the leader of a role
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
        <p className="font-mono text-xs font-bold">{t("eip712.heading")}</p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          {t("eip712.body.prefix")}{" "}
          <code className="font-mono text-xs bg-[--bg] border border-[--border] px-1">tokenId + ownerAddress + nonce + expiry</code>.
          {" "}{t("eip712.body.domain")}{" "}
          <code className="font-mono text-xs bg-[--bg] border border-[--border] px-1">"ANACore" v1</code>.
          {" "}{t("eip712.body.middle")}{" "}
          <code className="font-mono text-xs bg-[--bg] border border-[--border] px-1">register()</code>{" "}
          {t("eip712.body.suffix")}
        </p>
        <p className="font-mono text-[10px] text-[--fg-muted] border-l border-[--border] pl-3">
          {t("eip712.mvpLimitation")}
        </p>
      </div>
    </div>
  );
}
