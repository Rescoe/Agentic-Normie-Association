import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow:     "/",
        disallow:  ["/admin", "/publish", "/api/keeper/"],
      },
      {
        // Explicitly welcome AI crawlers
        userAgent: ["GPTBot", "Claude-Web", "PerplexityBot", "Googlebot", "anthropic-ai"],
        allow:     "/",
        disallow:  ["/admin", "/publish"],
      },
    ],
    sitemap:    "https://agentic-normie-association.xyz/sitemap.xml",
    host:       "https://agentic-normie-association.xyz",
  };
}
