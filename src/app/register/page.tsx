import { Navbar } from "@/components/Navbar";
import { RegisterClient } from "./RegisterClient";

export const metadata = {
  title: "Inscrire mon Normie — ANA",
  description:
    "Inscrivez votre Normie dans la phase constituante de l'Agentic Normie Association.",
};

export default function RegisterPage() {
  return (
    <>
      <Navbar />
      <div className="pt-16 min-h-screen">
        {/* Page header */}
        <div className="border-b border-[--border] bg-[--bg-card]">
          <div className="max-w-6xl mx-auto px-6 py-10">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4">
                <span className="live-dot w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
                Phase constituante ouverte
              </div>
              <h1 className="text-4xl font-bold leading-tight mb-4">
                Inscrire mon Normie
              </h1>
              <p className="text-[--fg-muted] leading-relaxed">
                Connectez le wallet qui détient vos Normies sur Ethereum mainnet.
                L'ownership est vérifié par un relayer signataire — l'inscription
                se fait ensuite on-chain sur Base, sans interaction avec Ethereum.
              </p>
            </div>
          </div>
        </div>

        {/* How it works — strip */}
        <div className="border-b border-[--border] bg-[--bg]">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="flex flex-wrap items-center gap-6 font-mono text-xs text-[--fg-muted]">
              <div className="flex items-center gap-2">
                <span className="bg-[--fg] text-[--bg] w-5 h-5 flex items-center justify-center shrink-0">1</span>
                Connecter wallet Ethereum
              </div>
              <span className="text-[--border]">→</span>
              <div className="flex items-center gap-2">
                <span className="bg-[--fg] text-[--bg] w-5 h-5 flex items-center justify-center shrink-0">2</span>
                Ownership vérifié par relayer
              </div>
              <span className="text-[--border]">→</span>
              <div className="flex items-center gap-2">
                <span className="bg-[--fg] text-[--bg] w-5 h-5 flex items-center justify-center shrink-0">3</span>
                Transaction d'inscription sur Base
              </div>
              <span className="text-[--border]">→</span>
              <div className="flex items-center gap-2">
                <span className="bg-[--fg] text-[--bg] w-5 h-5 flex items-center justify-center shrink-0">4</span>
                Normie membre fondateur ✓
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-6xl mx-auto px-6 py-12">
          <RegisterClient />
        </div>
      </div>
    </>
  );
}
