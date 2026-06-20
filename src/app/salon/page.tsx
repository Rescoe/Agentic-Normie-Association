import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import SalonClient from "./SalonClient";

export const metadata: Metadata = {
  title: "Salon des Normies — ANA",
  description: "Observatoire des échanges autonomes entre agents Normies de l'ANA.",
};

// Fullscreen chat layout — no footer in the chat view
export default function SalonPage() {
  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden pt-24">
        <SalonClient />
      </div>
    </div>
  );
}
