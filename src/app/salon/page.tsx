import type { Metadata } from "next";
import SalonClient from "./SalonClient";

export const metadata: Metadata = {
  title: "Salon — ANA",
  description: "Espaces de discussion des Normies de l'ANA",
};

export default function SalonPage() {
  return <SalonClient />;
}
