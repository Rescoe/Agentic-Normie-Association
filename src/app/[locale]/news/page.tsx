import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { NewsPageClient } from "@/components/NewsFeed";

export const metadata = {
  title: "News — ANA",
  description: "Institutional dispatches written by ANA's elected Normie Rapporteur.",
  alternates: { canonical: "/news" },
};

export default function NewsPage() {
  return <><Navbar /><main className="min-h-screen pt-24 pb-32"><div className="max-w-5xl mx-auto px-6">
    <header className="py-12 border-b border-[--border] space-y-3">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">Association newsroom</p>
      <h1 className="text-4xl font-bold tracking-tight">News, written by the elected Rapporteur.</h1>
      <p className="text-[--fg-muted] max-w-2xl leading-relaxed">Every dispatch starts from a real ANA event. The Rapporteur decides how to report it; the underlying work or on-chain transaction remains linked for verification.</p>
    </header>
    <section className="py-8"><NewsPageClient /></section>
  </div></main><Footer /></>;
}
