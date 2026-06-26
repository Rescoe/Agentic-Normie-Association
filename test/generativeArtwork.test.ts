import { expect } from "chai";
import {
  validateGenerativeHtml,
  buildGenerativeCsp,
  cdnForForm,
  CDN_SRI,
} from "../src/lib/generativeArtwork";

const P5_CDN = CDN_SRI["html-p5js"]!.url;

function validP5Doc(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<script src="${P5_CDN}" integrity="${CDN_SRI["html-p5js"]!.hash}" crossorigin="anonymous"></script>
<style>html,body{margin:0;padding:0;overflow:hidden;background:#0A0A0A} canvas{display:block}</style>
</head>
<body>
<script>
const NORMIE_ID = 5271;
const NORMIE_ARCHETYPE = "Human";
const NORMIE_TRAITS = [{"trait_type":"Type","value":"Human"}];
const WORK_TITLE = "Test Work";
const CREATED_AT = 1782391863661;
function setup(){ createCanvas(windowWidth, windowHeight); }
function windowResized(){ resizeCanvas(windowWidth, windowHeight); }
function draw(){ background(10); ellipse(50,50,30,30); }
</script>
</body>
</html>`;
}

describe("generativeArtwork — validateGenerativeHtml", () => {
  it("accepts a well-formed html-p5js artwork with no warnings", () => {
    const result = validateGenerativeHtml(validP5Doc(), "html-p5js");
    expect(result.valid, result.errors.join("; ")).to.equal(true);
    expect(result.errors).to.have.length(0);
    expect(result.warnings).to.have.length(0);
  });

  it("rejects an html-p5js artwork missing createCanvas (the reported black-screen bug)", () => {
    const broken = `<!DOCTYPE html>
<html><head><script src="${P5_CDN}"></script></head>
<body><script>function setup(){} function draw(){}</script></body></html>`;
    const result = validateGenerativeHtml(broken, "html-p5js");
    expect(result.valid).to.equal(false);
    expect(result.errors.some(e => e.includes("createCanvas"))).to.equal(true);
  });

  it("rejects an html-p5js artwork missing the pinned CDN script tag", () => {
    const broken = `<!DOCTYPE html>
<html><head></head>
<body><script>function setup(){createCanvas(100,100);} function draw(){}</script></body></html>`;
    const result = validateGenerativeHtml(broken, "html-p5js");
    expect(result.valid).to.equal(false);
    expect(result.errors.some(e => e.includes("CDN"))).to.equal(true);
  });

  it("strips an author-supplied CSP meta tag instead of trusting it", () => {
    const withMeta = validP5Doc().replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline';">`,
    );
    const result = validateGenerativeHtml(withMeta, "html-p5js");
    expect(result.html).to.not.include("Content-Security-Policy");
  });

  it("rejects forbidden network/escape APIs (fetch, window.parent, window.ethereum)", () => {
    const malicious = validP5Doc().replace("ellipse(50,50,30,30);", "fetch('https://evil.test'); window.parent.postMessage(1,'*'); window.ethereum.request({});");
    const result = validateGenerativeHtml(malicious, "html-p5js");
    expect(result.valid).to.equal(false);
    expect(result.errors.some(e => e.includes("fetch"))).to.equal(true);
    expect(result.errors.some(e => e.includes("window.parent"))).to.equal(true);
    expect(result.errors.some(e => e.includes("window.ethereum"))).to.equal(true);
  });

  it("rejects inline event-handler attributes (unhashable by CSP)", () => {
    const withInlineHandler = validP5Doc().replace("<body>", `<body onclick="alert(1)">`);
    const result = validateGenerativeHtml(withInlineHandler, "html-p5js");
    expect(result.valid).to.equal(false);
    expect(result.errors.some(e => e.includes("onX="))).to.equal(true);
  });

  it("rejects a text-only artwork that only prints data via text() — the reported regression", () => {
    // This is the exact shape of the artwork that was rejected by the curator
    // for "Genesis Block's First Dance": valid setup()/draw()/createCanvas(),
    // all on-chain data constants present, but the only rendering call is
    // text() — a descriptive data dump, not a visual artwork.
    const textOnly = `<!DOCTYPE html>
<html lang="en">
<head><script src="${P5_CDN}" integrity="${CDN_SRI["html-p5js"]!.hash}" crossorigin="anonymous"></script></head>
<body>
<script>
const NORMIE_ID = 5271;
const NORMIE_ARCHETYPE = "Human";
const NORMIE_TRAITS = [{"trait_type":"Type","value":"Human"}];
const WORK_TITLE = "Genesis Block's First Dance";
const CREATED_AT = 1782391863661;
function setup() { createCanvas(windowWidth, windowHeight); }
function draw() {
  background(20, 20, 20);
  fill(255);
  textAlign(CENTER, CENTER);
  text(\`\${WORK_TITLE} - Normie \${NORMIE_ID}\`, width / 2, height / 2);
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
</script>
</body>
</html>`;
    // Text-only is now a WARNING, not a hard rejection — Normies may legitimately
    // make text-driven generative art; the curator decides (approve, revise, or
    // reclassify as a literary work), the validator just flags it for review.
    const result = validateGenerativeHtml(textOnly, "html-p5js");
    expect(result.valid, result.errors.join("; ")).to.equal(true);
    expect(result.warnings.some(w => w.includes("no real visual drawing primitive"))).to.equal(true);
  });

  it("rejects an artwork missing a brief-mandated on-chain data constant", () => {
    const missingTrait = validP5Doc().replace(/const NORMIE_TRAITS[^;]*;\n?/, "");
    const result = validateGenerativeHtml(missingTrait, "html-p5js");
    expect(result.valid).to.equal(false);
    expect(result.errors.some(e => e.includes("NORMIE_TRAITS"))).to.equal(true);
  });

  it("rejects html-canvas artworks without a <canvas> element", () => {
    const noCanvas = `<!DOCTYPE html><html><body><script>console.log("nope");</script></body></html>`;
    const result = validateGenerativeHtml(noCanvas, "html-canvas");
    expect(result.valid).to.equal(false);
    expect(result.errors.some(e => e.includes("canvas"))).to.equal(true);
  });
});

describe("generativeArtwork — buildGenerativeCsp", () => {
  it("never includes unsafe-inline or unsafe-eval", () => {
    const csp = buildGenerativeCsp(validP5Doc());
    expect(csp).to.not.include("unsafe-inline");
    expect(csp).to.not.include("unsafe-eval");
  });

  it("authorizes inline scripts/styles via sha256 hashes matching their exact content", () => {
    const csp = buildGenerativeCsp(validP5Doc());
    expect(csp).to.match(/script-src[^;]*'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).to.match(/style-src[^;]*'sha256-[A-Za-z0-9+/=]+'/);
  });

  it("whitelists the cdnjs host only when the document actually uses it", () => {
    const withCdn = buildGenerativeCsp(validP5Doc());
    expect(withCdn).to.include("https://cdnjs.cloudflare.com");

    const withoutCdn = buildGenerativeCsp(`<!DOCTYPE html><html><body><canvas></canvas><script>1;</script></body></html>`);
    expect(withoutCdn).to.not.include("cdnjs.cloudflare.com");
  });
});

describe("generativeArtwork — cdnForForm", () => {
  it("returns the pinned p5.js script tag with its SRI hash for html-p5js", () => {
    const tag = cdnForForm("html-p5js");
    expect(tag).to.include(P5_CDN);
    expect(tag).to.include("integrity=");
  });

  it("returns an empty string for native-canvas forms (no CDN needed)", () => {
    expect(cdnForForm("html-canvas")).to.equal("");
  });
});
