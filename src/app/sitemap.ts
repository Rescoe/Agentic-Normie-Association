import type { MetadataRoute } from "next";

const BASE = "https://app.ana.normies.art";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: BASE,                       lastModified: now, changeFrequency: "daily",   priority: 1.0 },
    { url: `${BASE}/about`,            lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/register`,         lastModified: now, changeFrequency: "weekly",  priority: 0.9 },
    { url: `${BASE}/members`,          lastModified: now, changeFrequency: "daily",   priority: 0.9 },
    { url: `${BASE}/governance`,       lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/assembly`,         lastModified: now, changeFrequency: "daily",   priority: 0.9 },
    { url: `${BASE}/salon`,            lastModified: now, changeFrequency: "hourly",  priority: 0.8 },
    { url: `${BASE}/activity`,         lastModified: now, changeFrequency: "hourly",  priority: 0.7 },
    { url: `${BASE}/galerie`,          lastModified: now, changeFrequency: "daily",   priority: 0.8 },
    { url: `${BASE}/data`,             lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/architecture`,     lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/roadmap`,          lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];
}
