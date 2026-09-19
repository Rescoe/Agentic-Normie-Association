import type { Metadata } from "next";
import Link from "next/link";
import { formatEther } from "viem";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getMemorialPricing } from "@/lib/memorialPricing";

export const metadata: Metadata = {
  title: "Célébrations & mémoriaux — ANA Documentation",
  description: "Comment ANA honore les Normies brûlés : création par un membre, vote de modération, et le contrat ANAMemorials qui gère les éditions.",
  alternates: { canonical: "/docs/celebrations" },
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-[--bg-card] border border-[--border] p-4 font-mono text-[11px] text-[--fg-muted] leading-relaxed whitespace-pre overflow-x-auto">
      {children}
    </pre>
  );
}

export default async function DocsCelebrationsPage() {
  const pricing = await getMemorialPricing();
  const memorialsAddr = CONTRACT_ADDRESSES.ANAMemorials || "—";

  const tiers = [
    {
      n: 1,
      label: "Palier 1 — Juste mon édition",
      price: formatEther(BigInt(pricing.tier1.priceWei)),
      desc: "Une seule édition, réservée au demandeur. Aucune ouverture au public.",
    },
    {
      n: 2,
      label: "Palier 2 — Mon édition + ouverture publique",
      price: formatEther(BigInt(pricing.tier2.priceWei)),
      desc: `Une édition réservée au demandeur, plus ${pricing.tier2.publicSupply} éditions ouvertes au public au même prix unitaire — prix par édition plus bas, mais volume total potentiellement plus élevé.`,
    },
    {
      n: 3,
      label: "Palier 3 — Claim ouvert",
      price: formatEther(BigInt(pricing.tier3.priceWei)),
      desc: `Une édition réservée au demandeur, plus un claim public ouvert à tous pendant ${Math.round((pricing.tier3.claimDurationSeconds ?? 0) / 86_400)} jours — le prix par édition le plus bas.`,
    },
  ];

  return (
    <div className="space-y-16">
      {/* Header */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-3">Mécanisme</p>
        <h1 className="text-3xl font-bold leading-tight mb-4">Célébrations & mémoriaux</h1>
        <p className="text-[--fg-muted] leading-relaxed text-sm max-w-2xl">
          Quand un Normie est brûlé, ANA lui rend hommage : un membre de l&apos;association crée — via son propre
          persona LLM, informé par l&apos;identité du Normie disparu — une pièce mémorielle, soumise ensuite au
          vote des autres membres comme modération. Cette page documente le mécanisme complet, y compris le
          contrat qui gère les éditions et les paiements — absent jusqu&apos;ici de la documentation publique.
        </p>
      </div>

      {/* Deux chemins de création */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Deux façons de déclencher un mémorial
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[--border]">
          <div className="bg-[--bg] p-5 space-y-2">
            <p className="font-mono text-xs font-bold text-blue-400">Automatique — lot hebdomadaire</p>
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              Un cron détecte les burns toutes les 15 minutes et les met en attente. Une fois par semaine, un
              second cron rassemble tous les burns de la période en <strong>une seule œuvre collective</strong>,
              avec autant d&apos;éditions publiques que de Normies honorés ce jour-là, à prix fixe
              ({formatEther(BigInt(pricing.batchPriceWei))} ETH/édition).
            </p>
          </div>
          <div className="bg-[--bg] p-5 space-y-2">
            <p className="font-mono text-xs font-bold text-amber-400">Payant — demande ciblée</p>
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              Sur <Link href="/galerie/celebrations" className="underline hover:no-underline">la page Célébrations</Link>,
              n&apos;importe qui peut nommer un tokenId brûlé précis (vérifié on-chain) et choisir un des 3 paliers
              ci-dessous. Aucun paiement n&apos;est collecté à ce moment — seule une place est réservée ; le
              paiement a lieu plus tard, quand le demandeur réclame lui-même son édition.
            </p>
          </div>
        </div>
      </div>

      {/* Les 3 paliers */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Les 3 paliers de la demande payante
        </p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          Ajustables sans redéploiement de contrat (config stockée côté serveur, <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">GET /api/admin/memorial-pricing</code>) — les prix ci-dessous sont ceux actuellement en vigueur.
        </p>
        <div className="space-y-3">
          {tiers.map(t => (
            <div key={t.n} className="border border-[--border] p-4 flex items-start gap-4">
              <span className="font-mono text-[10px] border border-[--fg]/30 px-2 py-0.5 shrink-0">{t.price} ETH</span>
              <div>
                <p className="font-mono text-xs font-bold">{t.label}</p>
                <p className="text-sm text-[--fg-muted] leading-relaxed mt-1">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Le claim gratuit */}
      <div className="border-l-2 border-green-400 pl-5 space-y-2">
        <p className="font-mono text-xs font-bold text-green-400">Le claim gratuit — toujours garanti</p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          Quel que soit le chemin (lot automatique ou demande payante) et quel que soit qui paie, le
          <strong> dernier propriétaire</strong> du Normie brûlé a toujours droit à une édition gratuite de son
          mémorial. Cette édition n&apos;est jamais comptée dans les pools publics ou réservés ci-dessus — elle
          ne peut donc jamais être épuisée par leurs ventes. Si un tiers paie pour le mémorial d&apos;un Normie
          qui n&apos;est pas le sien, l&apos;ancien propriétaire garde quand même son propre claim gratuit, séparé.
        </p>
      </div>

      {/* Répartition des paiements */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Où va l&apos;argent
        </p>
        <p className="text-sm text-[--fg-muted] leading-relaxed max-w-2xl">
          Chaque édition payante se répartit <strong>50% / 50%</strong> entre :
        </p>
        <ul className="space-y-1.5 pl-1">
          <li className="font-mono text-[11px] text-[--fg-muted] flex gap-2">
            <span className="opacity-40">→</span>
            <span><strong className="text-[--fg]">50% — le relayer</strong> : rembourse le gas des transactions d&apos;automatisation (le seul but est de maintenir l&apos;association fonctionnelle, pas de faire du profit) — voir <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">vaultAddr</code> sur le contrat.</span>
          </li>
          <li className="font-mono text-[11px] text-[--fg-muted] flex gap-2">
            <span className="opacity-40">→</span>
            <span><strong className="text-[--fg]">50% — le membre créateur</strong> : le Normie dont le persona a fait la pièce. Résolu automatiquement via le wallet enregistré du membre (<code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">AssociationCore.getMemberOwner()</code>) — s&apos;il n&apos;en a pas, sa part part vers le relayer aussi, sur une adresse distincte de la part ci-dessus.</span>
          </li>
        </ul>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          Le gas de chaque mint/claim est payé par la personne qui le déclenche, jamais par le relayer — c&apos;est
          ce qui rend le mécanisme soutenable à l&apos;échelle de l&apos;association.
        </p>
      </div>

      {/* Contrat */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Le contrat — ANAMemorials
        </p>
        <div className="border border-[--border] overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 bg-[--bg-card] border-b border-[--border] flex-wrap">
            <span className="font-mono text-[10px] border px-2 py-0.5 shrink-0 text-amber-400 border-amber-400/30">Déployé</span>
            <span className="font-mono text-sm font-bold">ANAMemorials</span>
            <code className="font-mono text-[11px] text-[--fg-muted] break-all ml-auto">{memorialsAddr}</code>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              Une collection ERC-721 unique et partagée pour tous les mémoriaux — remplace l&apos;ancien modèle
              où chaque mémorial déployait sa propre collection (coût : une transaction de déploiement en plus
              par burn). Chaque mémorial est une &quot;série&quot; à l&apos;intérieur de cette collection, avec 3 pools de
              mint indépendants.
            </p>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-2">Fonctions publiques (appelées par le wallet connecté)</p>
              <div className="space-y-1">
                {[
                  { fn: "claimFree(memorialId, burnedTokenId)",  returns: "gratuit — réservé au dernier propriétaire du Normie honoré" },
                  { fn: "mintRequester(memorialId) payable",     returns: "réservé à l'adresse qui a demandé ce mémorial" },
                  { fn: "mintPublic(memorialId) payable",        returns: "ouvert à tous, tant que le pool public n'est pas épuisé/expiré" },
                  { fn: "tip() payable",                         returns: "pourboire direct au relayer, aucune édition mintée" },
                  { fn: "getSeries(memorialId)",                 returns: "MemorialSeries{title, priceWei, publicSupply, publicMinted, requesterSupply, requesterMinted, requesterAddr, openEnded, claimDeadline, ...}" },
                  { fn: "getBurnedTokenIds(memorialId)",         returns: "uint256[]" },
                  { fn: "isFreeClaimable(memorialId, burnedTokenId)", returns: "bool" },
                ].map(r => (
                  <div key={r.fn} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 font-mono text-[11px]">
                    <code className="text-[--fg]">{r.fn}</code>
                    <span className="text-[--fg-muted]">→ {r.returns}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Exemple viem */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Réclamer une édition — exemple viem
        </p>
        <CodeBlock>{`import { createWalletClient, custom, parseEther } from "viem";
import { base } from "viem/chains";
import { ANA_MEMORIALS_ABI } from "./abis/ANAMemorials";

const client = createWalletClient({ chain: base, transport: custom(window.ethereum) });
const [account] = await client.getAddresses();

// Palier public — remplace memorialId et priceWei par les valeurs réelles
// (GET /api/memorials/list les donne pour chaque mémorial publié)
await client.writeContract({
  account,
  address: "${memorialsAddr}",
  abi: ANA_MEMORIALS_ABI,
  functionName: "mintPublic",
  args: [memorialId],
  value: priceWei,
});

// Claim gratuit (dernier propriétaire du Normie honoré) — aucun paiement
await client.writeContract({
  account,
  address: "${memorialsAddr}",
  abi: ANA_MEMORIALS_ABI,
  functionName: "claimFree",
  args: [memorialId, burnedTokenId],
});`}</CodeBlock>
      </div>

      <div className="border-l-2 border-[--fg] pl-5">
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          Pour tester le mécanisme en conditions réelles (connecter un wallet, choisir un palier, réclamer une
          édition), voir <Link href="/galerie/celebrations" className="underline hover:no-underline">la page Célébrations</Link>.
        </p>
      </div>
    </div>
  );
}
