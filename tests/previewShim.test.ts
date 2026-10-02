import { describe, expect, it } from "vitest";
import { injectPreviewShim, PREVIEW_SHIM_SCRIPT } from "@/lib/previewShim";
import { buildGenerativeCsp } from "@/lib/generativeArtwork";

const DOC = `<!DOCTYPE html><html><head><style>body{margin:0}</style><script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script></head><body><script>function setup(){}</script></body></html>`;

describe("previewShim — vignettes muettes et autonomes (?preview=1)", () => {
  it("s'insère juste après <head>, AVANT toute bibliothèque (le shim doit patcher AudioContext avant p5.sound)", () => {
    const out = injectPreviewShim(DOC);
    const shimAt = out.indexOf(PREVIEW_SHIM_SCRIPT);
    expect(shimAt).toBeGreaterThan(out.indexOf("<head>"));
    expect(shimAt).toBeLessThan(out.indexOf("p5.min.js"));
    expect(out.replace(`<script>${PREVIEW_SHIM_SCRIPT}</script>`, "")).toBe(DOC);   // rien d'autre n'est modifié
  });

  it("sans <head> : crée un head ; sans <html> : en tête de document", () => {
    expect(injectPreviewShim("<html><body>x</body></html>")).toMatch(/^<html><head><script>/);
    expect(injectPreviewShim("<canvas></canvas>").startsWith("<script>")).toBe(true);
  });

  it("le shim est couvert par SON PROPRE hash CSP — jamais 'unsafe-inline'", () => {
    const plain = buildGenerativeCsp(DOC), injected = buildGenerativeCsp(injectPreviewShim(DOC));
    const hashes = (c: string) => (c.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? []).length;
    expect(hashes(injected)).toBe(hashes(plain) + 1);
    expect(injected).not.toContain("unsafe-inline");
    expect(injected).not.toContain("unsafe-eval");
  });

  it("ne dépend d'aucune requête réseau, de aucun accès parent/wallet, et passe le validateur d'œuvres (pas de fetch/XHR/WebSocket)", () => {
    for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "window.parent", "window.top", "ethereum", "eval(", "new Function"]) {
      expect(PREVIEW_SHIM_SCRIPT).not.toContain(forbidden);
    }
  });

  it("est du JavaScript valide et ne lève jamais, même sans navigateur (tout est sous try/catch)", () => {
    expect(() => new Function(PREVIEW_SHIM_SCRIPT)).not.toThrow();
    expect(() => new Function(PREVIEW_SHIM_SCRIPT)()).not.toThrow();
  });

  it("garantit le silence : la destination audio est remplacée par un gain à 0", () => {
    expect(PREVIEW_SHIM_SCRIPT).toContain("createGain");
    expect(PREVIEW_SHIM_SCRIPT).toContain("gain.value = 0");
    expect(PREVIEW_SHIM_SCRIPT).toContain("'destination'");
  });
});
