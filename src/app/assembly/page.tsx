/**
 * /assembly — Assemblée constituante + vote.
 *
 * Server component : lit l'état de la session on-chain.
 * Passe les données au client AssemblyClient pour le vote interactif.
 *
 * Note : "myMemberTokenIds" est calculé côté client (nécessite wallet connecté).
 * Le server component passe uniquement sessionActive + sessionId.
 */

import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { readCurrentSession, readMemberCount, contractsDeployed } from "@/lib/chainReader";
import { AssemblyClient } from "./AssemblyClient";

export const metadata = {
  title: "Assemblée constituante — ANA",
  description: "Votez pour les rôles institutionnels et créatifs de l'Agentic Normie Association.",
};

export const dynamic = "force-dynamic";

export default async function AssemblyPage() {
  const [session, memberCount] = await Promise.all([
    readCurrentSession(),
    readMemberCount(),
  ]);

  const sessionActive  = session?.active   ?? false;
  const sessionId      = session?.id       ?? 0;
  const sessionResolved = session?.resolved ?? false;

  return (
    <>
      <Navbar />
      <div className="pt-16 min-h-screen">
        {/* Header */}
        <div className="border-b border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto px-6 py-10">
            <div className="flex items-start justify-between flex-wrap gap-6">
              <div className="max-w-2xl">
                <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">
                  Gouvernance
                </p>
                <h1 className="text-4xl font-bold mb-4">
                  Assemblée constituante
                </h1>
                <p className="text-[--fg-muted] leading-relaxed">
                  Les membres fondateurs élisent les six rôles institutionnels et créatifs
                  de l'association. Chaque Normie inscrit dispose d'une voix par rôle.
                  Les résultats sont enregistrés on-chain.
                </p>
              </div>

              {/* Session state badge */}
              <div className="border border-[--border] bg-[--bg] p-6 space-y-4 min-w-[220px]">
                <div>
                  <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mb-1">
                    État de la session
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full inline-block ${
                      sessionActive  ? "bg-green-500" :
                      sessionResolved ? "bg-gray-400" :
                      "bg-yellow-500"
                    }`} />
                    <span className="font-mono text-sm font-bold">
                      {sessionActive   ? "Session ouverte"  :
                       sessionResolved ? "Session clôturée" :
                       "En attente"}
                    </span>
                  </div>
                </div>

                {contractsDeployed && (
                  <div className="flex gap-6 border-t border-[--border] pt-4">
                    <div>
                      <p className="font-mono text-lg font-bold">{memberCount}</p>
                      <p className="font-mono text-xs text-[--fg-muted]">membres</p>
                    </div>
                    {sessionId > 0 && (
                      <div>
                        <p className="font-mono text-lg font-bold">#{sessionId}</p>
                        <p className="font-mono text-xs text-[--fg-muted]">session</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-6xl mx-auto px-6 py-12">
          <AssemblyClient
            sessionActive={sessionActive}
            sessionId={sessionId}
          />
        </div>
      </div>
      <Footer />
    </>
  );
}
