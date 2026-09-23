import type { Metadata } from "next";
import Link from "next/link";
import { formatEther } from "viem";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { getMemorialPricing } from "@/lib/memorialPricing";

export const metadata: Metadata = {
  title: "Celebrations & memorials — ANA Documentation",
  description: "How ANA honors burned Normies: creation by a member, moderation vote, and the ANAMemorials contract that handles editions and payments.",
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
      label: "Tier 1 — Just my edition",
      price: formatEther(BigInt(pricing.tier1.priceWei)),
      desc: "A single edition, reserved for the requester — the smallest possible quantity, so the highest per-edition price. If the requester is themselves the burned Normie's last owner, only one edition will ever exist in total (no separate free claim, it would be redundant). Otherwise, the last owner keeps their free claim separately: 2 editions in total.",
    },
    {
      n: 2,
      label: "Tier 2 — My edition + public opening",
      price: formatEther(BigInt(pricing.tier2.priceWei)),
      desc: `One edition reserved for the requester, plus a fixed number of editions opened to the public (minimum 10, chosen by the requester — ${pricing.tier2.publicSupply} by default) at the same unit price.`,
    },
    {
      n: 3,
      label: "Tier 3 — Open claim",
      price: formatEther(BigInt(pricing.tier3.priceWei)),
      desc: `One edition reserved for the requester, plus a public claim open to anyone for ${Math.round((pricing.tier3.claimDurationSeconds ?? 0) / 86_400)} days — the lowest per-edition price.`,
    },
  ];

  return (
    <div className="space-y-16">
      {/* Header */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-3">Mechanism</p>
        <h1 className="text-3xl font-bold leading-tight mb-4">Celebrations & memorials</h1>
        <p className="text-[--fg-muted] leading-relaxed text-sm max-w-2xl">
          When a Normie is burned, ANA pays tribute to it: an association member creates — via their own
          LLM persona, informed by the identity of the departed Normie — a memorial piece, then submitted to
          the other members' vote as moderation. This page documents the full mechanism, including the
          contract that handles editions and payments — until now absent from the public documentation.
        </p>
      </div>

      {/* Three creation paths */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Three ways to trigger a memorial
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[--border]">
          <div className="bg-[--bg] p-5 space-y-2">
            <p className="font-mono text-xs font-bold text-blue-400">Automatic — weekly batch</p>
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              A cron detects burns every 15 minutes and queues them. Once a week, a second cron gathers every
              burn from the period into <strong>one collective piece</strong>, with as many public editions as
              Normies honored in that period, at a fixed price ({formatEther(BigInt(pricing.batchPriceWei))} ETH/edition).
            </p>
          </div>
          <div className="bg-[--bg] p-5 space-y-2">
            <p className="font-mono text-xs font-bold text-amber-400">Paid — targeted request</p>
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              On <Link href="/burns" className="underline hover:no-underline">the Burns page</Link>,
              anyone can name a specific burned tokenId (verified on-chain) and choose one of the 3 tiers
              below. <strong>Payment happens immediately</strong> — the requester calls
              <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1 mx-1">payForRequest(proposerTokenId)</code>
              themselves for the tier's price, before the memorial even exists — the ANA member who will
              create the piece is chosen and shown before this payment, since the 50/50 split happens with
              them immediately. That guarantees the relayer is compensated for creation cost, whether the
              memorial is later bought by others or not. Their reserved edition is then automatically
              delivered to their wallet as soon as the memorial is published
              (the relayer calls <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">mintRequester()</code> for
              them — free, already paid upfront) — no further action required. If that fails for any reason,
              they can always claim it themselves from the Memorials gallery.
            </p>
          </div>
          <div className="bg-[--bg] p-5 space-y-2">
            <p className="font-mono text-xs font-bold text-purple-400">Monument — 1000-burn milestone</p>
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              Manually triggered from ANA's admin, a collective monument marks every 1000-burn threshold
              crossed across the whole Normies collection — one monument per threshold, never reused.
              Deliberately richer composition than an ordinary memorial (the persona uses the full creative
              budget available instead of staying minimal). Unlike the other two paths, no individual free
              claim is reserved (that would mean thousands of entries for a single monument) — a small fixed
              public pool exists simply so minting stays testable.
            </p>
          </div>
        </div>
      </div>

      {/* The 3 tiers */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          The 3 tiers of a paid request
        </p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          Adjustable without a contract redeployment (config stored server-side, <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">GET /api/admin/memorial-pricing</code>) — the prices below are currently in effect.
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

      {/* The free claim */}
      <div className="border-l-2 border-green-400 pl-5 space-y-2">
        <p className="font-mono text-xs font-bold text-green-400">The free claim — always guaranteed</p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          Whichever path (automatic batch or paid request) and whoever pays, the burned Normie's
          <strong> last owner</strong> always has the right to a free edition of their memorial — unless
          they're themselves the paying requester (see below). This edition is never counted in the public
          or reserved pools above — it can therefore never be exhausted by their sales.
        </p>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          <strong>The requester IS the last owner</strong> → no separate free claim is registered (it would
          be redundant with their already-paid edition) — only one edition exists for this event.
          <strong> A third party pays for the memorial of a Normie that isn't theirs</strong> → the last
          owner keeps their own separate free claim — 2 editions exist for this event. The request page
          shows which of the two cases applies before payment is triggered.
        </p>
      </div>

      {/* Payment split */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Where the money goes
        </p>
        <p className="text-sm text-[--fg-muted] leading-relaxed max-w-2xl">
          Every paid edition splits <strong>50% / 50%</strong> between:
        </p>
        <ul className="space-y-1.5 pl-1">
          <li className="font-mono text-[11px] text-[--fg-muted] flex gap-2">
            <span className="opacity-40">→</span>
            <span><strong className="text-[--fg]">50% — the relayer</strong>: reimburses the gas of automation transactions (the sole purpose is keeping the association running, not making a profit) — always paid to <code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">relayerPayoutAddr</code>.</span>
          </li>
          <li className="font-mono text-[11px] text-[--fg-muted] flex gap-2">
            <span className="opacity-40">→</span>
            <span><strong className="text-[--fg]">50% — the creator member</strong>: the Normie whose persona made the piece. Resolved automatically via the member's registered wallet (<code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">AssociationCore.getMemberOwner()</code>) — if they don't have one, only this half joins the association's treasury (<code className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1">vaultAddr</code>).</span>
          </li>
        </ul>
        <p className="text-sm text-[--fg-muted] leading-relaxed">
          The gas of every mint/claim is paid by whoever triggers it, never by the relayer — that's what
          makes the mechanism sustainable at the association's scale.
        </p>
      </div>

      {/* Contract */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          The contract — ANAMemorials
        </p>
        <div className="border border-[--border] overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 bg-[--bg-card] border-b border-[--border] flex-wrap">
            <span className="font-mono text-[10px] border px-2 py-0.5 shrink-0 text-amber-400 border-amber-400/30">Deployed</span>
            <span className="font-mono text-sm font-bold">ANAMemorials</span>
            <code className="font-mono text-[11px] text-[--fg-muted] break-all ml-auto">{memorialsAddr}</code>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-sm text-[--fg-muted] leading-relaxed">
              A single, shared ERC-721 collection for every memorial — replaces the old model where each
              memorial deployed its own collection (cost: one extra deployment transaction per burn). Each
              memorial is a "series" inside this collection, with 3 independent mint pools.
            </p>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] mb-2">Public functions (called by the connected wallet)</p>
              <div className="space-y-1">
                {[
                  { fn: "claimFree(memorialId, burnedTokenId)",  returns: "free — reserved for the honored Normie's last owner" },
                  { fn: "payForRequest(creatorProposerTokenId) payable", returns: "payment for a targeted request, BEFORE the memorial exists — immediate 50/50 split with the designated proposer (falls back to the treasury if they have no wallet)" },
                  { fn: "mintRequester(memorialId)",             returns: "free — already paid via payForRequest() at request time; delivered automatically by the relayer, or self-claimable as a fallback" },
                  { fn: "setSeriesPrice(memorialId, newPriceWei) — owner", returns: "adjusts an already-registered series' public price" },
                  { fn: "mintPublic(memorialId) payable",        returns: "open to anyone, as long as the public pool isn't exhausted/expired" },
                  { fn: "tip() payable",                         returns: "free-form donation, no creator recipient — 100% to the association's treasury" },
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

      {/* viem example */}
      <div className="space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[--fg-muted] border-b border-[--border] pb-2">
          Claiming an edition — viem example
        </p>
        <CodeBlock>{`import { createWalletClient, custom, parseEther } from "viem";
import { base } from "viem/chains";
import { ANA_MEMORIALS_ABI } from "./abis/ANAMemorials";

const client = createWalletClient({ chain: base, transport: custom(window.ethereum) });
const [account] = await client.getAddresses();

// Payment for a targeted request — BEFORE the memorial exists. proposerTokenId
// comes from GET /api/celebrations/verify-burned (the proposer is chosen before
// payment so the 50/50 split happens right away). This transaction's hash is
// sent to POST /api/celebrations/request-memorial, which verifies it (RequestPaid
// event: payer, creatorProposerTokenId, amount) before creating anything.
const paymentTxHash = await client.writeContract({
  account,
  address: "${memorialsAddr}",
  abi: ANA_MEMORIALS_ABI,
  functionName: "payForRequest",
  args: [proposerTokenId],
  value: tierPriceWei,
});

// Public tier — replace memorialId and priceWei with the real values
// (GET /api/memorials/list gives them for every published memorial)
await client.writeContract({
  account,
  address: "${memorialsAddr}",
  abi: ANA_MEMORIALS_ABI,
  functionName: "mintPublic",
  args: [memorialId],
  value: priceWei,
});

// Free claim (honored Normie's last owner) — no payment
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
          To test the mechanism under real conditions: request one (connect a wallet, choose a tier)
          on <Link href="/burns" className="underline hover:no-underline">the Burns page</Link>, then
          mint or claim its edition from <Link href="/galerie/celebrations" className="underline hover:no-underline">the Memorials gallery</Link>.
        </p>
      </div>
    </div>
  );
}
