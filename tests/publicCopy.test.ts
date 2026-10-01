import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("public copy and navigation guardrails", () => {
  it("presents ANA as a Rescoe-hosted protocol-artwork before the technical layer", () => {
    const messages = JSON.parse(read("messages/en.json"));

    expect(messages.home.heroQuestion).toBe(
      "What if digital characters could form a collective, deliberate, and create works together?",
    );
    expect(messages.home.heroExperiment).toContain("protocol-artwork and experimental laboratory hosted by Rescoe");
    expect(messages.home.heroTechnical).toContain("on-chain cultural institution");
    expect(messages.about.host.legalValue).toContain("17 February 2018");
    expect(messages.about.host.legalValue).toContain("W335003772");
  });

  it("keeps the legal association distinct from the fictional institution", () => {
    const activeCopy = [
      read("src/app/[locale]/page.tsx"),
      read("src/app/[locale]/about/page.tsx"),
      JSON.stringify(JSON.parse(read("messages/en.json")).home),
      JSON.stringify(JSON.parse(read("messages/en.json")).about),
      JSON.stringify(JSON.parse(read("messages/en.json")).governance),
      read("public/llms.txt"),
    ].join("\n");

    expect(activeCopy).toContain("Rescoe");
    expect(activeCopy).not.toContain("first on-chain cultural association");
    expect(activeCopy).not.toContain("Agents govern themselves");
    expect(activeCopy).not.toContain("no human arbitration");
    expect(activeCopy).not.toContain("Votes are on-chain, autonomous, immutable");
  });

  it("does not reintroduce retired models or false architecture slogans", () => {
    const publicCopy = [
      read("messages/en.json"),
      read("public/llms.txt"),
      read("src/app/[locale]/docs/celebrations/page.tsx"),
      read("src/app/[locale]/docs/contracts/page.tsx"),
      read("src/app/[locale]/docs/creation/page.tsx"),
    ].join("\n");

    for (const retired of [
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "llama-3.1-8b-instant",
      "Everything on-chain, no external dependency",
      "source of truth is always on-chain",
      "new owner inherits the mandate",
      "The role follows the NFT",
      "1000-burn milestone",
      "every 1000-burn threshold",
    ]) {
      expect(publicCopy).not.toContain(retired);
    }
  });

  it("keeps the English message catalog free of French UI fragments", () => {
    const messages = read("messages/en.json");
    expect(messages).not.toMatch(/[àâçéèêëîïôùûüÿœæ]/i);
    expect(messages).not.toMatch(/\b(?:voir le code|réessaie|aucun échange|mémorial existe déjà)\b/i);
  });

  it("keeps every recurring workflow inside the orchestrator", () => {
    const workflowDir = path.join(root, ".github/workflows");
    const scheduled = fs.readdirSync(workflowDir)
      .filter(name => name.endsWith(".yml") || name.endsWith(".yaml"))
      .filter(name => /(^|\n)\s*schedule\s*:/m.test(read(`.github/workflows/${name}`)));
    expect(scheduled).toEqual(["orchestrator.yml"]);
  });

  it("does not make a global footer request that can wake the database", () => {
    expect(read("src/components/Footer.tsx")).not.toContain("fetch(");
  });

  it("keeps essential routes discoverable in navigation or the sitemap", () => {
    const discovery = read("src/components/Navbar.tsx") + read("src/app/sitemap.ts");
    for (const route of [
      "/about", "/members", "/news", "/works", "/galerie", "/salon",
      "/governance", "/assembly", "/activity", "/docs", "/burns",
      "/galerie/celebrations", "/docs/celebrations",
    ]) {
      expect(discovery).toContain(route);
    }
  });

  it("keeps burns reachable from the creation navigation and Memorials", () => {
    expect(read("src/components/Navbar.tsx")).toContain('{ href: "/burns"');
    expect(read("src/components/GallerySubNav.tsx")).toContain('{ href: "/burns"');
    expect(read("src/app/[locale]/galerie/celebrations/CelebrationsClient.tsx"))
      .toContain("RecentBurnsPreview");
    expect(read("src/app/[locale]/burns/page.tsx")).toContain("GallerySubNav");
    expect(read("src/components/HomeLiveActivity.tsx")).toContain('href="/burns"');
  });
});
