import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { getWork } from "@/lib/workStore";
import { MemorialDetailClient } from "./MemorialDetailClient";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const work = await getWork(params.id);
  const title = work ? `${work.title} — ANA Burns` : "Memorial — ANA Burns";
  return {
    title,
    description: work?.cartelText ?? "A memorial for a burned Normie, honored on-chain by the Agentic Normie Association.",
    alternates: { canonical: `/galerie/celebrations/${params.id}` },
  };
}

export default async function MemorialDetailPage({ params }: { params: { id: string } }) {
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-24 min-h-screen">
        <section className="px-6">
          <div className="max-w-4xl mx-auto">
            <MemorialDetailClient id={params.id} />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
