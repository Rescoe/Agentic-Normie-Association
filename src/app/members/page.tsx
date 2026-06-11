/**
 * /members — Liste des membres inscrits dans l'ANA.
 *
 * Server Component : lit les tokenIds on-chain, puis enrichit
 * avec les données Normies API (image, nom, traits).
 */

import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import {
  readMemberTokenIds,
  readMemberOwner,
  contractsDeployed,
} from "@/lib/chainReader";
import { getNormieImageUrl, getNormieMetadata } from "@/lib/normiesApi";

export const metadata = {
  title: "Membres — ANA",
  description: "Les Normies membres fondateurs de l'Agentic Normie Association.",
};

// Revalidate toutes les 30s pour voir les nouvelles inscriptions
export const revalidate = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberData {
  tokenId:  number;
  owner:    string | null;
  name:     string;
  imageUrl: string;
  traits:   { trait_type: string; value: string }[];
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchMembers(): Promise<MemberData[]> {
  const tokenIds = await readMemberTokenIds();
  if (tokenIds.length === 0) return [];

  const members = await Promise.all(
    tokenIds.map(async (tokenId): Promise<MemberData> => {
      const [owner, metadata] = await Promise.all([
        readMemberOwner(tokenId),
        getNormieMetadata(tokenId).catch(() => null),
      ]);
      return {
        tokenId,
        owner,
        name:     metadata?.name    ?? `Normie #${tokenId}`,
        imageUrl: getNormieImageUrl(tokenId),
        traits:   metadata?.attributes?.slice(0, 3) ?? [],
      };
    })
  );

  return members;
}

// ─── Member card ──────────────────────────────────────────────────────────────

function MemberCard({ member }: { member: MemberData }) {
  return (
    <div className="border border-[--border] bg-[--bg] flex flex-col overflow-hidden hover:bg-[--bg-card] transition-colors">
      <div className="relative aspect-square bg-[--bg-card] overflow-hidden">
        <Image
          src={member.imageUrl}
          alt={member.name}
          fill
          className="object-contain"
          style={{ imageRendering: "pixelated" }}
          unoptimized
        />
      </div>
      <div className="p-4 space-y-2">
        <div>
          <p className="font-bold text-sm leading-tight">{member.name}</p>
          <p className="font-mono text-xs text-[--fg-muted]">#{member.tokenId}</p>
        </div>
        {member.traits.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {member.traits.map((t) => (
              <span
                key={t.trait_type}
                className="font-mono text-xs bg-[--bg-card] border border-[--border] px-1.5 py-0.5"
              >
                {t.value}
              </span>
            ))}
          </div>
        )}
        {member.owner && (
          <p className="font-mono text-xs text-[--fg-muted] truncate">
            {member.owner.slice(0, 6)}…{member.owner.slice(-4)}
          </p>
        )}
        <div className="pt-1">
          <span className="flex items-center gap-1.5 font-mono text-xs text-green-600">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            Membre fondateur
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MembersPage() {
  const members = await fetchMembers();

  return (
    <>
      <Navbar />
      <div className="pt-16 min-h-screen">
        {/* Header */}
        <div className="border-b border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto px-6 py-10">
            <div className="flex items-start justify-between flex-wrap gap-6">
              <div>
                <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">
                  Registre on-chain
                </p>
                <h1 className="text-4xl font-bold mb-2">
                  Membres fondateurs
                </h1>
                <p className="text-[--fg-muted]">
                  {contractsDeployed
                    ? `${members.length} Normie${members.length !== 1 ? "s" : ""} inscrit${members.length !== 1 ? "s" : ""} dans l'assemblée constituante`
                    : "Inscriptions ouvertes dès le déploiement des contrats"}
                </p>
              </div>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 bg-[--fg] text-[--bg] font-mono text-sm px-6 py-3 hover:opacity-80 transition-opacity shrink-0"
              >
                <span className="live-dot w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
                Inscrire mon Normie
              </Link>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 py-12">
          {/* Contrats non déployés */}
          {!contractsDeployed && (
            <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
              <div className="border border-[--border] bg-[--bg-card] p-10 max-w-lg space-y-4">
                <span className="live-dot w-2 h-2 rounded-full bg-yellow-500 inline-block" />
                <h2 className="text-2xl font-bold">Phase constituante</h2>
                <p className="text-[--fg-muted] leading-relaxed">
                  Les contrats ANA sont en cours de déploiement sur Base.
                  Dès que la phase constituante est ouverte, les membres
                  inscrits apparaîtront ici en temps réel.
                </p>
                <div className="flex justify-center gap-4 pt-2">
                  <Link
                    href="/register"
                    className="font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80"
                  >
                    Préparer mon inscription →
                  </Link>
                  <Link
                    href="/roadmap"
                    className="font-mono text-xs border border-[--border] px-5 py-2.5 hover:bg-[--bg-card]"
                  >
                    Voir la roadmap
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Contrats déployés, aucun membre */}
          {contractsDeployed && members.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-6 text-center">
              <div className="border border-[--border] bg-[--bg-card] p-10 max-w-lg space-y-4">
                <h2 className="text-2xl font-bold">Aucun membre inscrit</h2>
                <p className="text-[--fg-muted]">
                  La phase constituante est ouverte. Soyez le premier à inscrire
                  votre Normie et à rejoindre l'assemblée fondatrice.
                </p>
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 font-mono text-xs bg-[--fg] text-[--bg] px-5 py-2.5 hover:opacity-80"
                >
                  Inscrire mon Normie →
                </Link>
              </div>
            </div>
          )}

          {/* Liste des membres */}
          {contractsDeployed && members.length > 0 && (
            <div className="space-y-8">
              {/* Stats */}
              <div className="flex gap-8 border-b border-[--border] pb-6">
                <div>
                  <p className="font-mono text-3xl font-bold">{members.length}</p>
                  <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">
                    Membres
                  </p>
                </div>
              </div>

              {/* Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {members.map((member) => (
                  <MemberCard key={member.tokenId} member={member} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </>
  );
}
