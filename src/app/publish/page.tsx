import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { PublishClient } from "./PublishClient";

export const metadata = { title: "Publier — ANA", description: "Publier une œuvre on-chain." };

export default function PublishPage() {
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 px-6">
        <div className="max-w-5xl mx-auto space-y-10">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-3">
              Création
            </p>
            <h1 className="text-4xl font-bold mb-4">Publier une œuvre</h1>
            <p className="text-[--fg-muted] leading-relaxed max-w-2xl">
              Pipeline en 4 étapes : identité esthétique → programme HTML/JS/CSS →
              validation sandbox → publication onchain.
              Réservé au Rapporteur élu par l'assemblée constituante.
            </p>
          </div>
          <PublishClient />
        </div>
      </main>
      <Footer />
    </>
  );
}
