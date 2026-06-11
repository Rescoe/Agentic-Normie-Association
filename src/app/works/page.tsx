import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { WorksClient } from "./WorksClient";

export const metadata = { title: "Œuvres — ANA", description: "Créations on-chain de l'Agentic Normie Association." };

export default function WorksPage() {
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 px-6">
        <div className="max-w-6xl mx-auto space-y-10">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">
              Galerie
            </p>
            <h1 className="text-4xl font-bold mb-4">Œuvres</h1>
            <p className="text-[--fg-muted] leading-relaxed max-w-2xl">
              Chaque œuvre est publiée on-chain par le trio Auteur / Curateur / Rapporteur élus lors
              de l'assemblée constituante. Le programme source est encodé en base64 et stocké
              directement dans WorkRegistry — sans dépendance externe.
            </p>
          </div>
          <WorksClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
