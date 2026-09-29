import { describe, it, expect } from "vitest";
import {
  mediaForWork, linksForWork, mediaForNormie, mediaForBurn, linksForBurn, linksForEditionMinted,
  institutionalMedia, formatPriceEth, truncateAddress, buildSocialText, isAllowedMediaHost,
  buildVisualProps, visualUrl, workFactId, chainFactId, burnFactId,
} from "../src/lib/newsMedia";

describe("regression test #1: published work → media, gallery, certificate, Basescan, OpenSea", () => {
  const work = {
    id: "work_1", title: "Autumn Light", artForm: "poem", artworkText: "a poem about light",
    authorName: "Kori", onChainWorkId: 3, txHash: "0xabc123", collectionAddress: "0xCollectionAddr",
  };

  it("builds artwork media for a text work (no fabricated screenshot)", () => {
    const media = mediaForWork(work);
    expect(media.kind).toBe("artwork");
    expect(media.sourceUrl).toBeUndefined(); // text work — no raster image to show
    expect(media.alt).toContain("Autumn Light");
  });

  it("uses the artworkText data URI directly when the artwork IS a safe image (pixel drawing)", () => {
    const pixelWork = { ...work, artworkText: "data:image/bmp;base64,Qk0=" };
    const media = mediaForWork(pixelWork);
    expect(media.sourceUrl).toBe(pixelWork.artworkText);
  });

  it("attaches gallery, certificate, Basescan tx, Basescan collection and OpenSea links", () => {
    const links = linksForWork(work);
    const kinds = links.map(l => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(["gallery", "certificate", "basescan_tx", "basescan_address", "opensea_collection"]));
    expect(links.find(l => l.kind === "certificate")!.url).toBe("https://agentic-normie-association.xyz/api/works/certificate/3");
    expect(links.find(l => l.kind === "opensea_collection")!.url).toBe("https://opensea.io/assets/base/0xCollectionAddr");
  });
});

describe("regression test #2: registered member → Normie portrait", () => {
  it("uses the Normie's own portrait image", () => {
    const media = mediaForNormie(2613, "Normie #2613 — new ANA member");
    expect(media.kind).toBe("normie");
    expect(media.sourceUrl).toContain("/normie/2613/image.png");
    expect(media.tokenId).toBe(2613);
  });
});

describe("regression test #3: role resolved → same Normie-portrait media builder", () => {
  it("carries the winner's tokenId through", () => {
    const media = mediaForNormie(5271, "Normie #5271 — elected Rapporteur");
    expect(media.tokenId).toBe(5271);
    expect(media.alt).toContain("Rapporteur");
  });
});

describe("regression test #4: burn on Ethereum, no existing memorial → burned image, Etherscan, no fake memorial", () => {
  it("uses the burned token's own image and never claims a memorial exists", () => {
    const media = mediaForBurn(9630, null);
    expect(media.kind).toBe("normie");
    expect(media.sourceUrl).toContain("/history/burned/9630/image.png");
  });

  it("links to Etherscan only — no gallery/collection links without a memorial", () => {
    const links = linksForBurn("0xburntx", null);
    expect(links).toEqual([{ kind: "etherscan_tx", label: "Ethereum burn transaction", url: "https://etherscan.io/tx/0xburntx" }]);
  });
});

describe("regression test #5: burn WITH an existing memorial → memorial image + gallery/collection links", () => {
  const memorial = { id: "work_mem_1", title: "In Memory of #9630", artworkText: "data:image/bmp;base64,Qk0=", onChainWorkId: 7, collectionAddress: "0xMemorialColl" };

  it("uses the memorial's own image, not the raw burned portrait", () => {
    const media = mediaForBurn(9630, memorial);
    expect(media.kind).toBe("memorial");
    expect(media.sourceUrl).toBe(memorial.artworkText);
    expect(media.workId).toBe("work_mem_1");
  });

  it("adds gallery, certificate and collection links alongside the burn tx", () => {
    const links = linksForBurn("0xburntx", memorial);
    const kinds = links.map(l => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(["etherscan_tx", "gallery", "certificate", "basescan_address", "opensea_collection"]));
  });
});

describe("regression test #6: edition minted → formatEther price, Basescan, OpenSea asset", () => {
  it("formats a wei price via viem's formatEther, never hand-rolled math", () => {
    expect(formatPriceEth("10000000000000000")).toBe("0.01 ETH");
    expect(formatPriceEth(0n)).toBe("0 ETH");
  });

  it("builds tx/collection/asset links, plus the certificate when a work is resolved", () => {
    const links = linksForEditionMinted({ collectionAddress: "0xColl", editionTokenId: 4, txHash: "0xminttx", work: { onChainWorkId: 9 } });
    expect(links.find(l => l.kind === "opensea_asset")!.url).toBe("https://opensea.io/assets/base/0xColl/4");
    expect(links.find(l => l.kind === "certificate")!.url).toContain("/9");
  });

  it("truncates the buyer address for public display", () => {
    expect(truncateAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});

describe("regression test #7: fallback institutional media has no image", () => {
  it("carries no sourceUrl", () => {
    const media = institutionalMedia("ANA — bureau resolved");
    expect(media.kind).toBe("institutional");
    expect(media.sourceUrl).toBeUndefined();
  });

  it("buildVisualProps renders imageUrl:null for institutional media, never a broken/fabricated image", () => {
    const props = buildVisualProps({ title: "t", eventType: "ROLES_RESOLVED", eventAt: Date.now(), authorName: "Kori", authorTokenId: 1, media: institutionalMedia() });
    expect(props.imageUrl).toBeNull();
  });
});

describe("regression test #8: an old news item (no media/links) is still fully readable", () => {
  it("visualUrl() falls back to the deterministic path when visualPath is absent", () => {
    expect(visualUrl({ id: "old_item_1" })).toBe("/api/news/old_item_1/visual.png");
  });

  it("buildVisualProps degrades cleanly with no media at all", () => {
    const props = buildVisualProps({ title: "Legacy dispatch", eventType: "WORK_PUBLISHED", eventAt: 1, authorName: "Axiom", authorTokenId: 4 });
    expect(props.imageUrl).toBeNull();
    expect(props.title).toBe("Legacy dispatch");
  });
});

describe("regression test #9: socialText stays <=260 chars, link included", () => {
  it("appends the link when the model's own text omits it, respecting the budget", () => {
    const base = "a".repeat(250);
    const out = buildSocialText(base, "https://agentic-normie-association.xyz/galerie");
    expect(out.length).toBeLessThanOrEqual(260);
    expect(out).toContain("https://agentic-normie-association.xyz/galerie");
  });

  it("does not duplicate the link if the model already included it", () => {
    const base = "Check it out: https://agentic-normie-association.xyz/galerie";
    const out = buildSocialText(base, "https://agentic-normie-association.xyz/galerie");
    expect(out).toBe(base);
  });

  it("never exceeds 260 chars even with no link", () => {
    expect(buildSocialText("b".repeat(400), undefined).length).toBe(260);
  });
});

describe("regression test #10: an external URL from a non-allow-listed host is refused", () => {
  it("accepts the configured normies.art API host", () => {
    expect(isAllowedMediaHost("https://api.normies.art/normie/1/image.png")).toBe(true);
  });

  it("accepts a data: image URI unconditionally (no network fetch involved)", () => {
    expect(isAllowedMediaHost("data:image/png;base64,AAAA")).toBe(true);
  });

  it("refuses an arbitrary/attacker-controlled host", () => {
    expect(isAllowedMediaHost("https://evil.example/steal.png")).toBe(false);
  });

  it("refuses plain http (not just an unlisted host)", () => {
    expect(isAllowedMediaHost("http://api.normies.art/normie/1/image.png")).toBe(false);
  });

  it("buildVisualProps drops a disallowed sourceUrl instead of ever fetching it", () => {
    const props = buildVisualProps({
      title: "t", eventType: "MEMBER_REGISTERED", eventAt: 1, authorName: "Kori", authorTokenId: 1,
      media: { kind: "normie", sourceUrl: "https://evil.example/steal.png", alt: "x" },
    });
    expect(props.imageUrl).toBeNull();
  });
});

describe("stable fact ids — dedup relies on these being deterministic (regression test #14)", () => {
  it("the same underlying event always produces the same id", () => {
    expect(burnFactId("0xtx", 9630)).toBe(burnFactId("0xtx", 9630));
    expect(chainFactId("EDITION_MINTED-123-0")).toBe(chainFactId("EDITION_MINTED-123-0"));
    expect(workFactId("work_1", "PUBLISHING", 100)).toBe(workFactId("work_1", "PUBLISHING", 100));
  });

  it("different events never collide", () => {
    expect(burnFactId("0xtx", 1)).not.toBe(burnFactId("0xtx", 2));
    expect(burnFactId("0xtx1", 1)).not.toBe(burnFactId("0xtx2", 1));
  });
});
