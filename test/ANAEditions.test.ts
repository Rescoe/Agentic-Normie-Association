import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ANACollectionFactory, ANAEditions } from "../typechain-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeTokenUri(uri: string): Record<string, unknown> {
  const prefix = "data:application/json;base64,";
  expect(uri.startsWith(prefix)).to.equal(true);
  const json = Buffer.from(uri.slice(prefix.length), "base64").toString("utf-8");
  return JSON.parse(json);
}

function decodeSvg(imageDataUri: string): string {
  const prefix = "data:image/svg+xml;base64,";
  expect(imageDataUri.startsWith(prefix)).to.equal(true);
  return Buffer.from(imageDataUri.slice(prefix.length), "base64").toString("utf-8");
}

async function deployCollection(
  factory: ANACollectionFactory,
  relayer: SignerWithAddress,
  recipient: SignerWithAddress,
  name: string,
  priceWei = 0n,
): Promise<ANAEditions> {
  const tx = await factory.connect(relayer).createCollection(
    1, name, "ANA", relayer.address,
    recipient.address, recipient.address, recipient.address,
    0, 0, 0, // use factory defaults
    10, priceWei,
  );
  const receipt = await tx.wait();
  const event = receipt!.logs
    .map(l => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find(l => l?.name === "CollectionDeployed");
  const collAddr = event!.args.collectionAddr as string;
  return ethers.getContractAt("ANAEditions", collAddr) as unknown as Promise<ANAEditions>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ANAEditions — tokenURI image field", function () {
  let factory:   ANACollectionFactory;
  let owner:     SignerWithAddress;
  let relayer:   SignerWithAddress;
  let recipient: SignerWithAddress;

  beforeEach(async () => {
    [owner, relayer, recipient] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ANACollectionFactory");
    factory = await Factory.deploy(owner.address, relayer.address, recipient.address, recipient.address) as unknown as ANACollectionFactory;
  });

  it("includes a fully on-chain SVG 'image' alongside 'animation_url' for html artworks", async () => {
    const coll = await deployCollection(factory, relayer, recipient, "Test HTML Collection");
    const html = "data:text/html;base64," + Buffer.from("<!DOCTYPE html><html><body>hi</body></html>").toString("base64");
    await coll.connect(relayer).initialize(html, "Spiky Lines, Electric Rhythms", 1);
    await coll.connect(recipient).buyAndMint({ value: 0 });

    const metadata = decodeTokenUri(await coll.tokenURI(0));
    expect(metadata.animation_url).to.equal(html);
    expect(typeof metadata.image).to.equal("string");
    expect((metadata.image as string).startsWith("data:image/svg+xml;base64,")).to.equal(true);

    const svg = decodeSvg(metadata.image as string);
    expect(svg).to.include("<svg");
    expect(svg).to.include("Spiky Lines, Electric Rhythms");
    expect(svg).to.include("1/10");
  });

  it("includes the same on-chain SVG 'image' for plain text/poem artworks (no animation_url)", async () => {
    const coll = await deployCollection(factory, relayer, recipient, "Test Poem Collection");
    await coll.connect(relayer).initialize("a short poem about chains", "Rébellion dans les blocs", 1);
    await coll.connect(recipient).buyAndMint({ value: 0 });

    const metadata = decodeTokenUri(await coll.tokenURI(0));
    expect(metadata.animation_url).to.equal(undefined);
    expect(typeof metadata.image).to.equal("string");
    expect((metadata.image as string).startsWith("data:image/svg+xml;base64,")).to.equal(true);

    const svg = decodeSvg(metadata.image as string);
    expect(svg).to.include("Rébellion dans les blocs");
  });

  it("XML-escapes special characters in the title so the generated SVG stays well-formed", async () => {
    const coll = await deployCollection(factory, relayer, recipient, "Test Escaping Collection");
    await coll.connect(relayer).initialize("text", `<Glitch> & "Antics"`, 1);
    await coll.connect(recipient).buyAndMint({ value: 0 });

    const metadata = decodeTokenUri(await coll.tokenURI(0));
    const svg = decodeSvg(metadata.image as string);
    expect(svg).to.not.include("<Glitch>");
    expect(svg).to.include("&lt;Glitch&gt;");
    expect(svg).to.include("&amp;");
    expect(svg).to.include("&quot;Antics&quot;");
  });
});
