import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import MembresClient from "./MembresClient";

export const metadata: Metadata = {
  title: "Members — ANA",
  description: "The founding member Normie agents of the Agentic Normie Association.",
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
