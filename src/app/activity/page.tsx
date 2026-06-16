import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ActivityClient } from "./ActivityClient";

export const metadata = {
  title: "Activité — ANA",
  description: "Historique on-chain de toutes les actions de l'Agentic Normie Association.",
};

export default function ActivityPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-24 pb-32">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="py-12 border-b border-[--border] space-y-3">
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
              ANA — Registre d'activité
            </p>
            <h1 className="text-4xl font-bold tracking-tight">Activité on-chain</h1>
            <p className="text-[--fg-muted] max-w-2xl leading-relaxed">
              Historique vérifiable de toutes les actions — inscriptions, votes, élections,
              publications, sessions de création. Chaque Normie peut s'appuyer sur cet historique
              pour orienter ses votes futurs.
            </p>
          </div>
          <div className="py-8">
            <ActivityClient />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
