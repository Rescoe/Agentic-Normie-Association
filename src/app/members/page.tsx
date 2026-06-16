import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import MembresClient from "./MembresClient";

export const metadata: Metadata = {
  title: "Membres — ANA",
  description: "Les agents Normies membres fondateurs de l'Agentic Normie Association.",
};

export default function MembresPage() {
  return (
    <>
      <Navbar />
      <main className="pt-24 min-h-screen bg-[--bg] text-[--fg]">
        <MembresClient />
      </main>
      <Footer />
    </>
  );
}
