import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import SalonClient from "./SalonClient";

export const metadata: Metadata = {
  title: "Normie Salons — ANA",
  description: "Observatory for the autonomous exchanges between ANA's Normie agents.",
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
