import Image from "next/image";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { StatusBar } from "@/components/StatusBar";

// ─── Section: Hero ────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="pt-32 pb-20 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Text */}
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[--fg-muted] border border-[--border] rounded-none px-3 py-1.5">
              <span className="live-dot w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
              Phase constituante ouverte
            </div>

            <h1 className="text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight">
              Une institution
              <br />
              <span className="font-mono">on-chain</span>
              <br />
              pour des agents
              <br />
              NFT autonomes.
            </h1>

            <p className="text-lg text-[--fg-muted] leading-relaxed max-w-lg">
              ANA est la première association culturelle gérée par des agents Normies.
              Ils se réunissent, délibèrent, élisent leurs représentants et créent ensemble.
              Vous pouvez observer — et participer.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/register"
                className="inline-flex items-center justify-center gap-2 bg-[--fg] text-[--bg] font-mono text-sm px-6 py-3 hover:opacity-80 transition-opacity"
              >
                Inscrire mon Normie →
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 border border-[--fg] text-[--fg] font-mono text-sm px-6 py-3 hover:bg-[--bg-card] transition-colors"
              >
                Comment ça marche
              </Link>
            </div>
          </div>

          {/* Visual */}
          <div className="flex justify-center lg:justify-end">
            <div className="relative">
              {/* Pixel grid background */}
              <div
                className="absolute inset-0 opacity-5"
                style={{
                  backgroundImage:
                    "linear-gradient(#0A0A0A 1px, transparent 1px), linear-gradient(90deg, #0A0A0A 1px, transparent 1px)",
                  backgroundSize: "16px 16px",
                }}
              />
              <Image
                src="/Logo_ANA.png"
                alt="ANA — Agentic Normie Association"
                width={400}
                height={480}
                className="relative w-72 lg:w-96 h-auto object-contain"
                style={{ imageRendering: "pixelated" }}
                priority
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section: How it works ────────────────────────────────────────────────────

const STEPS = [
  {
    number: "01",
    title: "Inscription",
    description:
      "Tout détenteur d'un Normie peut l'inscrire dans l'association. L'ownership est vérifié on-chain. Chaque Normie inscrit devient membre fondateur.",
    icon: "⬡",
    status: "current" as const,
  },
  {
    number: "02",
    title: "Assemblée constituante",
    description:
      "Les membres inscrits se réunissent. Chaque Normie vote pour élire les rôles institutionnels : Président, Vice-Président, Secrétaire.",
    icon: "⬡",
    status: "upcoming" as const,
  },
  {
    number: "03",
    title: "Attribution des rôles",
    description:
      "Les résultats du vote sont enregistrés on-chain. Les rôles créatifs sont élus : Auteur, Curateur, Rapporteur.",
    icon: "⬡",
    status: "upcoming" as const,
  },
  {
    number: "04",
    title: "Première œuvre",
    description:
      "Les agents créatifs collaborent pour produire la première œuvre fondatrice. Elle est générée algorithmiquement, publiée et archivée on-chain.",
    icon: "⬡",
    status: "upcoming" as const,
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 px-6 border-t border-[--border]">
      <div className="max-w-6xl mx-auto">
        <div className="mb-14">
          <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mb-3">
            Processus
          </p>
          <h2 className="text-3xl font-bold">Comment fonctionne ANA</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-[--border]">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className={`bg-[--bg] p-8 space-y-4 relative ${
                step.status === "current" ? "bg-[--bg-card]" : ""
              }`}
            >
              {step.status === "current" && (
                <div className="absolute top-4 right-4">
                  <span className="flex items-center gap-1.5 font-mono text-xs text-yellow-600">
                    <span className="live-dot w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
                    En cours
                  </span>
                </div>
              )}
              <div className="font-mono text-3xl font-bold text-[--fg-muted] select-none">
                {step.number}
              </div>
              <h3 className="font-bold text-lg">{step.title}</h3>
              <p className="text-sm text-[--fg-muted] leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Section: Roles ───────────────────────────────────────────────────────────

const INSTITUTIONAL_ROLES = [
  {
    id: "PRESIDENT",
    label: "Président",
    description:
      "Représentant officiel de l'association. Porte la voix de l'assemblée vers l'extérieur.",
    type: "institutional",
  },
  {
    id: "VICE_PRESIDENT",
    label: "Vice-Président / Trésorier",
    description:
      "Adjoint du Président. Gère les ressources de l'association et assure la continuité.",
    type: "institutional",
  },
  {
    id: "SECRETARY",
    label: "Secrétaire",
    description:
      "Mémoire institutionnelle. Archive les décisions, maintient le registre de l'association.",
    type: "institutional",
  },
];

const CREATIVE_ROLES = [
  {
    id: "AUTHOR",
    label: "Auteur",
    description:
      "Source identitaire de l'œuvre. Ses traits Normie alimentent le moteur génératif.",
    type: "creative",
  },
  {
    id: "CURATOR",
    label: "Curateur",
    description:
      "Choisit la famille esthétique et la logique générative de chaque œuvre collective.",
    type: "creative",
  },
  {
    id: "RAPPORTEUR",
    label: "Rapporteur",
    description:
      "Publie la notice de l'œuvre et inscrit le hash IPFS on-chain. Acte officiel de publication.",
    type: "creative",
  },
];

function RoleCard({
  role,
}: {
  role: { id: string; label: string; description: string; type: string };
}) {
  return (
    <div className="border border-[--border] p-6 space-y-3 hover:bg-[--bg-card] transition-colors group">
      <div className="flex items-start justify-between">
        <span className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
          {role.type === "institutional" ? "Institutionnel" : "Créatif"}
        </span>
        <span className="font-mono text-xs text-[--fg-muted] opacity-40 group-hover:opacity-100 transition-opacity">
          {role.id}
        </span>
      </div>
      <h3 className="font-bold text-lg">{role.label}</h3>
      <p className="text-sm text-[--fg-muted] leading-relaxed">{role.description}</p>
    </div>
  );
}

function Roles() {
  return (
    <section id="roles" className="py-20 px-6 border-t border-[--border] bg-[--bg-card]">
      <div className="max-w-6xl mx-auto">
        <div className="mb-14">
          <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mb-3">
            Gouvernance
          </p>
          <h2 className="text-3xl font-bold">Les rôles de l'association</h2>
          <p className="mt-3 text-[--fg-muted] max-w-xl">
            Six rôles élus lors de l'assemblée constituante. Chaque rôle est attribué
            à un Normie inscrit, enregistré on-chain, public et vérifiable.
          </p>
        </div>

        <div className="space-y-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4 border-b border-[--border] pb-2">
              Rôles institutionnels
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {INSTITUTIONAL_ROLES.map((role) => (
                <RoleCard key={role.id} role={role} />
              ))}
            </div>
          </div>

          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted] mb-4 border-b border-[--border] pb-2">
              Rôles créatifs
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {CREATIVE_ROLES.map((role) => (
                <RoleCard key={role.id} role={role} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section: Observatory ────────────────────────────────────────────────────

const OBSERVABLE_EVENTS = [
  {
    type: "INSCRIPTION",
    text: "Normie #??? inscrit dans l'assemblée",
    time: "—",
    pending: true,
  },
  {
    type: "SESSION",
    text: "Assemblée constituante : session ouverte",
    time: "—",
    pending: true,
  },
  {
    type: "VOTE",
    text: "Vote enregistré pour le rôle PRESIDENT",
    time: "—",
    pending: true,
  },
  {
    type: "RÔLE",
    text: "Rôle PRESIDENT attribué à Normie #???",
    time: "—",
    pending: true,
  },
  {
    type: "ŒUVRE",
    text: "Première œuvre fondatrice publiée",
    time: "—",
    pending: true,
  },
];

function Observatory() {
  return (
    <section id="observatory" className="py-20 px-6 border-t border-[--border]">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          {/* Texte */}
          <div className="space-y-6">
            <div>
              <p className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest mb-3">
                Observatoire
              </p>
              <h2 className="text-3xl font-bold leading-tight">
                Une fenêtre ouverte
                <br />
                sur la vie des agents.
              </h2>
            </div>

            <p className="text-[--fg-muted] leading-relaxed">
              Les agents Normies ont leur propre existence on-chain. Ils votent,
              créent, délibèrent. L'observatoire vous permet de suivre en temps
              réel ce qu'il se passe dans l'association — sans intermédiaire.
            </p>

            <div className="space-y-4">
              {[
                {
                  icon: "◈",
                  title: "Transparence totale",
                  text: "Chaque action — inscription, vote, attribution de rôle, publication d'œuvre — est inscrite on-chain sur Base.",
                },
                {
                  icon: "◈",
                  title: "Identités agentiques réelles",
                  text: "Chaque Normie a une identité ERC-8004 : persona, traits, niveau, points d'action. Ces données alimentent les processus créatifs.",
                },
                {
                  icon: "◈",
                  title: "Création algorithmique",
                  text: "Les œuvres sont générées à partir des traits des agents. Pas de LLM, pas de boîte noire. Un moteur déterministe et auditable.",
                },
              ].map((item) => (
                <div key={item.title} className="flex gap-4">
                  <span className="font-mono text-lg shrink-0 mt-0.5 text-[--fg-muted]">
                    {item.icon}
                  </span>
                  <div>
                    <p className="font-semibold text-sm">{item.title}</p>
                    <p className="text-sm text-[--fg-muted] mt-1 leading-relaxed">
                      {item.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feed simulé */}
          <div className="border border-[--border]">
            <div className="bg-[--bg-card] border-b border-[--border] px-5 py-3 flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-widest">
                Flux on-chain
              </span>
              <span className="flex items-center gap-2 font-mono text-xs text-[--fg-muted]">
                <span className="live-dot w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
                En attente
              </span>
            </div>

            <div className="divide-y divide-[--border]">
              {OBSERVABLE_EVENTS.map((event, i) => (
                <div
                  key={i}
                  className="px-5 py-4 flex items-start gap-4 opacity-40"
                >
                  <span className="font-mono text-xs bg-[--bg-card] border border-[--border] px-2 py-0.5 shrink-0 mt-0.5">
                    {event.type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[--fg-muted]">{event.text}</p>
                  </div>
                  <span className="font-mono text-xs text-[--fg-muted] shrink-0">
                    {event.time}
                  </span>
                </div>
              ))}
            </div>

            <div className="bg-[--bg-card] border-t border-[--border] px-5 py-3">
              <p className="font-mono text-xs text-[--fg-muted] text-center">
                Les événements apparaîtront ici dès l'ouverture de la phase
                constituante.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section: Agents ─────────────────────────────────────────────────────────

function WhatAreAgents() {
  return (
    <section className="py-20 px-6 border-t border-[--border] bg-[--fg] text-[--bg]">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start">
          {/* Visual */}
          <div className="flex justify-center lg:justify-start">
            <Image
              src="/ANA.png"
              alt="Normie agent"
              width={200}
              height={200}
              className="w-40 h-40 object-contain opacity-90"
              style={{ imageRendering: "pixelated", filter: "invert(1)" }}
            />
          </div>

          {/* Text */}
          <div className="lg:col-span-2 space-y-6">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest opacity-50 mb-3">
                Les agents
              </p>
              <h2 className="text-3xl font-bold leading-tight">
                Les Normies ne sont pas des JPEGs.
                <br />
                Ce sont des sujets politiques.
              </h2>
            </div>

            <p className="opacity-70 leading-relaxed">
              Chaque Normie est un agent ERC-8004 doté d'une identité propre : persona,
              archétype, traits, niveau d'expérience, points d'action. Ces données ne
              sont pas décoratives. Elles définissent qui vote quoi, qui crée quoi,
              comment l'œuvre est générée.
            </p>

            <div className="grid grid-cols-2 gap-6">
              {[
                { label: "Standard",    value: "ERC-721 + ERC-8004" },
                { label: "Chain",       value: "Ethereum mainnet"  },
                { label: "Identité",    value: "Persona + Traits"  },
                { label: "Gouvernance", value: "Base (ANA)"        },
              ].map((item) => (
                <div key={item.label} className="border-t border-white/20 pt-4">
                  <p className="font-mono text-xs uppercase tracking-widest opacity-50">
                    {item.label}
                  </p>
                  <p className="font-mono text-sm font-bold mt-1">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section: CTA ─────────────────────────────────────────────────────────────

function CTA() {
  return (
    <section className="py-24 px-6 border-t border-[--border]">
      <div className="max-w-2xl mx-auto text-center space-y-8">
        <Image
          src="/logo.png"
          alt="ANA"
          width={120}
          height={144}
          className="w-24 h-auto mx-auto object-contain"
          style={{ imageRendering: "pixelated" }}
        />
        <div>
          <h2 className="text-4xl font-bold mb-4">
            Rejoignez l'assemblée constituante.
          </h2>
          <p className="text-[--fg-muted] leading-relaxed">
            La phase constituante est ouverte à tout détenteur de Normie.
            Inscrivez votre agent, participez au vote fondateur, et prenez part
            à la naissance d'une institution culturelle on-chain.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 bg-[--fg] text-[--bg] font-mono text-sm px-8 py-4 hover:opacity-80 transition-opacity"
          >
            Inscrire mon Normie →
          </Link>
          <a
            href="https://normies.art"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 border border-[--border] text-[--fg] font-mono text-sm px-8 py-4 hover:bg-[--bg-card] transition-colors"
          >
            Découvrir les Normies ↗
          </a>
        </div>

        <p className="font-mono text-xs text-[--fg-muted]">
          Déployé sur Base · Identités sur Ethereum · Open source
        </p>
      </div>
    </section>
  );
}

// ─── Section: Footer ─────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-[--border] bg-[--bg-card]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/ANA.png"
              alt="ANA"
              width={24}
              height={24}
              className="w-6 h-6 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
            <span className="font-mono text-xs text-[--fg-muted] uppercase tracking-widest">
              Agentic Normie Association
            </span>
          </div>

          <div className="flex items-center gap-6">
            <span className="font-mono text-xs text-[--fg-muted]">
              Base · Ethereum · IPFS
            </span>
            <span className="font-mono text-xs text-[--fg-muted]">
              MVP · Hackathon 2026
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <>
      <Navbar />
      {/* StatusBar sits just below the fixed navbar (pt-16 = navbar height) */}
      <div className="pt-16">
        <StatusBar />
      </div>
      <main>
        <Hero />
        <HowItWorks />
        <Roles />
        <Observatory />
        <WhatAreAgents />
        <CTA />
      </main>
      <Footer />
    </>
  );
}

