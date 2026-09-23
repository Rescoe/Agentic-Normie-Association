import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  ANAMemorials, MockAssociationCore, ANAMemorialsAttacker,
} from "../typechain-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeTokenUri(uri: string): Record<string, unknown> {
  const prefix = "data:application/json;base64,";
  expect(uri.startsWith(prefix)).to.equal(true);
  return JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf-8"));
}

const PROPOSER_TOKEN_ID = 42;
const BURN_TOKEN_A = 100;
const BURN_TOKEN_B = 101;

/** Full default registerMemorial() params, overridable per test — avoids repeating all 13 struct fields everywhere. */
function registerParams(overrides: Partial<{
  title: string; artworkContent: string; workId: number; creatorProposerTokenId: number;
  creatorName: string; kind: string; honoredBurnCount: number;
  priceWei: bigint; publicSupply: number; requesterSupply: number;
  requesterAddr: string; openEnded: boolean; claimDurationSeconds: number;
}> = {}) {
  return {
    title: "t",
    artworkContent: "data:image/bmp;base64,QQ==",
    creatorName: "Zephyr",
    kind: "batch",
    honoredBurnCount: 1,
    workId: 0,
    creatorProposerTokenId: PROPOSER_TOKEN_ID,
    priceWei: 0n,
    publicSupply: 0,
    requesterSupply: 0,
    requesterAddr: ethers.ZeroAddress,
    openEnded: false,
    claimDurationSeconds: 0,
    ...overrides,
  };
}

async function deployFixture() {
  const [owner, relayer, creator, vault, buyer1, buyer2, requester, lastOwnerA, lastOwnerB, stranger] =
    await ethers.getSigners();

  const Core = await ethers.getContractFactory("MockAssociationCore");
  const core = await Core.deploy() as unknown as MockAssociationCore;
  await core.setOwner(PROPOSER_TOKEN_ID, creator.address);

  const Memorials = await ethers.getContractFactory("ANAMemorials");
  const memorials = await Memorials.deploy(
    owner.address, relayer.address, await core.getAddress(), vault.address,
  ) as unknown as ANAMemorials;

  const Attacker = await ethers.getContractFactory("ANAMemorialsAttacker");
  const attacker = await Attacker.deploy(await memorials.getAddress()) as unknown as ANAMemorialsAttacker;

  return {
    owner, relayer, creator, vault, buyer1, buyer2, requester, lastOwnerA, lastOwnerB, stranger,
    core, memorials, attacker,
  };
}

async function registerBasicMemorial(
  memorials: ANAMemorials,
  relayer: SignerWithAddress,
  opts: Partial<{
    priceWei: bigint; publicSupply: number; requesterSupply: number;
    requesterAddr: string; openEnded: boolean; claimDurationSeconds: number;
  }> = {},
): Promise<bigint> {
  const tx = await memorials.connect(relayer).registerMemorial({
    title:            "Eulogy for 2 absences",
    artworkContent:   "data:image/bmp;base64,QQ==",
    creatorName:      "Zephyr",
    kind:             "batch",
    honoredBurnCount: 2,
    workId:           0,
    creatorProposerTokenId: PROPOSER_TOKEN_ID,
    priceWei:         opts.priceWei ?? 0n,
    publicSupply:     opts.publicSupply ?? 0,
    requesterSupply:  opts.requesterSupply ?? 0,
    requesterAddr:    opts.requesterAddr ?? ethers.ZeroAddress,
    openEnded:        opts.openEnded ?? false,
    claimDurationSeconds: opts.claimDurationSeconds ?? 0,
  });
  const receipt = await tx.wait();
  const event = receipt!.logs
    .map(l => { try { return memorials.interface.parseLog(l); } catch { return null; } })
    .find(l => l?.name === "MemorialRegistered");
  return event!.args.memorialId as bigint;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ANAMemorials", function () {
  describe("access control", function () {
    it("registerMemorial reverts for a non-authorized caller", async () => {
      const { memorials, stranger } = await deployFixture();
      await expect(
        memorials.connect(stranger).registerMemorial(registerParams()),
      ).to.be.revertedWithCustomError(memorials, "NotAuthorized");
    });

    it("addReservedClaims reverts for a non-authorized caller", async () => {
      const { memorials, relayer, stranger, lastOwnerA } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);
      await expect(
        memorials.connect(stranger).addReservedClaims(id, [BURN_TOKEN_A], [lastOwnerA.address]),
      ).to.be.revertedWithCustomError(memorials, "NotAuthorized");
    });
  });

  describe("creator address resolution", function () {
    it("resolves the proposer's registered wallet via AssociationCore.getMemberOwner", async () => {
      const { memorials, relayer, creator } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);
      const series = await memorials.getSeries(id);
      expect(series.creatorAddr).to.equal(creator.address);
    });

    it("marks the vault fallback when the proposer has no registered wallet", async () => {
      const { memorials, relayer, vault, core } = await deployFixture();
      const UNREGISTERED_TOKEN_ID = 999;
      // deliberately not set in the mock core -> getMemberOwner returns address(0)
      const tx = await memorials.connect(relayer).registerMemorial(
        registerParams({ creatorProposerTokenId: UNREGISTERED_TOKEN_ID, creatorName: "Unbound agent" }),
      );
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map(l => { try { return memorials.interface.parseLog(l); } catch { return null; } })
        .find(l => l?.name === "MemorialRegistered");
      const id = event!.args.memorialId as bigint;
      const series = await memorials.getSeries(id);
      expect(series.creatorAddr).to.equal(ethers.ZeroAddress);
      expect(series.creatorUsesVault).to.equal(true);
      void core; // unused in this branch, kept for fixture symmetry
    });
  });

  describe("mintPublic", function () {
    it("reverts once publicSupply is exhausted", async () => {
      const { memorials, relayer, buyer1, buyer2, stranger } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: 0n, publicSupply: 1 });
      await memorials.connect(buyer1).mintPublic(id);
      await expect(memorials.connect(buyer2).mintPublic(id)).to.be.revertedWithCustomError(memorials, "SoldOut");
      void stranger;
    });

    it("reverts on underpayment", async () => {
      const { memorials, relayer, buyer1 } = await deployFixture();
      const price = ethers.parseEther("0.001");
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: price, publicSupply: 10 });
      await expect(
        memorials.connect(buyer1).mintPublic(id, { value: price - 1n }),
      ).to.be.revertedWithCustomError(memorials, "InsufficientPayment");
    });

    it("refunds overpayment", async () => {
      const { memorials, relayer, buyer1 } = await deployFixture();
      const price = ethers.parseEther("0.001");
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: price, publicSupply: 10 });
      const balBefore = await ethers.provider.getBalance(buyer1.address);
      const tx = await memorials.connect(buyer1).mintPublic(id, { value: price * 2n });
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter = await ethers.provider.getBalance(buyer1.address);
      expect(balBefore - balAfter - gasCost).to.equal(price); // only the real price left the wallet
    });

    it("splits payment 50/50 between relayer payout and creator, odd wei to the creator", async () => {
      const { memorials, relayer, creator, vault, buyer1 } = await deployFixture();
      const price = 1001n; // odd, in wei — exercises the remainder rule
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: price, publicSupply: 10 });

      const relayerBefore = await ethers.provider.getBalance(relayer.address);
      const creatorBefore = await ethers.provider.getBalance(creator.address);
      const vaultBefore = await ethers.provider.getBalance(vault.address);
      await memorials.connect(buyer1).mintPublic(id, { value: price });
      const relayerAfter = await ethers.provider.getBalance(relayer.address);
      const creatorAfter = await ethers.provider.getBalance(creator.address);

      expect(relayerAfter - relayerBefore).to.equal(500n);   // price/2, floor
      expect(creatorAfter - creatorBefore).to.equal(501n); // remainder
      expect(await ethers.provider.getBalance(vault.address)).to.equal(vaultBefore);
    });
  });

  describe("mintRequester", function () {
    it("reverts for anyone other than the registered requester", async () => {
      const { memorials, relayer, requester, stranger } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, {
        priceWei: 0n, requesterSupply: 1, requesterAddr: requester.address,
      });
      await expect(memorials.connect(stranger).mintRequester(id)).to.be.revertedWithCustomError(memorials, "NotEligible");
    });

    it("has a supply counter independent from the public pool", async () => {
      const { memorials, relayer, requester, buyer1 } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, {
        priceWei: 0n, publicSupply: 1, requesterSupply: 1, requesterAddr: requester.address,
      });
      await memorials.connect(buyer1).mintPublic(id); // exhausts the PUBLIC pool only
      await expect(memorials.connect(requester).mintRequester(id)).to.not.be.reverted; // requester pool untouched
    });

    it("is free even when the series has a nonzero priceWei — the requester already paid via payForRequest() before creation", async () => {
      const { memorials, relayer, requester } = await deployFixture();
      const price = ethers.parseEther("0.001");
      const id = await registerBasicMemorial(memorials, relayer, {
        priceWei: price, requesterSupply: 1, requesterAddr: requester.address,
      });
      await expect(memorials.connect(requester).mintRequester(id)).to.not.be.reverted;
    });

    it("an authorized relayer can auto-deliver the edition — it always goes to requesterAddr, never to the caller", async () => {
      const { memorials, relayer, requester } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, {
        priceWei: 0n, requesterSupply: 1, requesterAddr: requester.address,
      });
      const tx = await memorials.connect(relayer).mintRequester(id);
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map(l => { try { return memorials.interface.parseLog(l); } catch { return null; } })
        .find(l => l?.name === "EditionMinted");
      expect(event!.args.to).to.equal(requester.address); // not relayer.address
      expect(await memorials.ownerOf(event!.args.tokenId)).to.equal(requester.address);
    });

    it("a non-authorized, non-requester caller still can't trigger delivery", async () => {
      const { memorials, relayer, requester, stranger } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, {
        priceWei: 0n, requesterSupply: 1, requesterAddr: requester.address,
      });
      await expect(memorials.connect(stranger).mintRequester(id)).to.be.revertedWithCustomError(memorials, "NotEligible");
    });
  });

  describe("claimFree — the reserved-claim guarantee", function () {
    it("succeeds even when both the public and requester pools are fully sold out", async () => {
      const { memorials, relayer, buyer1, requester, lastOwnerA } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, {
        priceWei: 0n, publicSupply: 1, requesterSupply: 1, requesterAddr: requester.address,
      });
      await memorials.connect(relayer).addReservedClaims(id, [BURN_TOKEN_A], [lastOwnerA.address]);

      await memorials.connect(buyer1).mintPublic(id);       // exhausts public
      await memorials.connect(requester).mintRequester(id); // exhausts requester

      await expect(memorials.connect(lastOwnerA).claimFree(id, BURN_TOKEN_A)).to.not.be.reverted;
    });

    it("reverts for a caller who isn't the eligible recipient", async () => {
      const { memorials, relayer, lastOwnerA, stranger } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);
      await memorials.connect(relayer).addReservedClaims(id, [BURN_TOKEN_A], [lastOwnerA.address]);
      await expect(memorials.connect(stranger).claimFree(id, BURN_TOKEN_A)).to.be.revertedWithCustomError(memorials, "NotEligible");
    });

    it("reverts on a second claim for the same burnedTokenId", async () => {
      const { memorials, relayer, lastOwnerA } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);
      await memorials.connect(relayer).addReservedClaims(id, [BURN_TOKEN_A], [lastOwnerA.address]);
      await memorials.connect(lastOwnerA).claimFree(id, BURN_TOKEN_A);
      await expect(memorials.connect(lastOwnerA).claimFree(id, BURN_TOKEN_A)).to.be.revertedWithCustomError(memorials, "AlreadyClaimed");
    });

    it("addReservedClaims supports multiple burnedTokenIds in one call (batch)", async () => {
      const { memorials, relayer, lastOwnerA, lastOwnerB } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);
      await memorials.connect(relayer).addReservedClaims(
        id, [BURN_TOKEN_A, BURN_TOKEN_B], [lastOwnerA.address, lastOwnerB.address],
      );
      expect(await memorials.isFreeClaimable(id, BURN_TOKEN_A)).to.equal(true);
      expect(await memorials.isFreeClaimable(id, BURN_TOKEN_B)).to.equal(true);
      await memorials.connect(lastOwnerA).claimFree(id, BURN_TOKEN_A);
      expect(await memorials.isFreeClaimable(id, BURN_TOKEN_A)).to.equal(false);
      expect(await memorials.isFreeClaimable(id, BURN_TOKEN_B)).to.equal(true); // unaffected
    });
  });

  describe("reentrancy", function () {
    it("blocks a reentrant mintPublic call from a malicious creator's receive()", async () => {
      const { memorials, relayer, core, attacker, buyer1 } = await deployFixture();
      const attackerAddr = await attacker.getAddress();
      await core.setOwner(PROPOSER_TOKEN_ID, attackerAddr); // attacker is the resolved creator/payout target

      const price = ethers.parseEther("0.001");
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: price, publicSupply: 5 });
      await attacker.setMode("reenter");
      await attacker.setReenterMemorialId(id);

      await memorials.connect(buyer1).mintPublic(id, { value: price });

      // The reentrant call inside receive() must have failed silently (caught) —
      // only ONE token should exist for this mint, not two.
      const series = await memorials.getSeries(id);
      expect(series.publicMinted).to.equal(1n);
    });
  });

  describe("escrow fallback for a payout address that reverts on receive", function () {
    it("still mints successfully and escrows the creator's share instead of reverting the mint", async () => {
      const { memorials, relayer, core, attacker, buyer1 } = await deployFixture();
      const attackerAddr = await attacker.getAddress();
      await core.setOwner(PROPOSER_TOKEN_ID, attackerAddr);
      await attacker.setMode("revert");

      const price = 1000n;
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: price, publicSupply: 5 });

      await expect(memorials.connect(buyer1).mintPublic(id, { value: price })).to.not.be.reverted;
      expect(await memorials.pendingWithdrawals(attackerAddr)).to.equal(500n); // creator's 50% share, escrowed
    });

    it("lets the escrowed address withdraw once it can accept payment", async () => {
      const { memorials, relayer, core, attacker, buyer1 } = await deployFixture();
      const attackerAddr = await attacker.getAddress();
      await core.setOwner(PROPOSER_TOKEN_ID, attackerAddr);
      await attacker.setMode("revert");

      const price = 1000n;
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: price, publicSupply: 5 });
      await memorials.connect(buyer1).mintPublic(id, { value: price });

      await attacker.setMode("accept"); // any mode other than "revert"/"reenter" just accepts ETH
      const balBefore = await ethers.provider.getBalance(attackerAddr);

      await attacker.connect(relayer).callWithdraw(); // withdraw() is msg.sender-scoped — must be called BY the attacker contract

      const balAfter = await ethers.provider.getBalance(attackerAddr);
      expect(balAfter - balBefore).to.equal(500n);
      expect(await memorials.pendingWithdrawals(attackerAddr)).to.equal(0n);
    });
  });

  describe("openEnded (tier 3)", function () {
    it("allows minting before the deadline regardless of publicSupply", async () => {
      const { memorials, relayer, buyer1, buyer2 } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, {
        priceWei: 0n, openEnded: true, claimDurationSeconds: 3600,
      });
      await expect(memorials.connect(buyer1).mintPublic(id)).to.not.be.reverted;
      await expect(memorials.connect(buyer2).mintPublic(id)).to.not.be.reverted;
    });

    it("reverts once the claim deadline has passed", async () => {
      const { memorials, relayer, buyer1 } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, {
        priceWei: 0n, openEnded: true, claimDurationSeconds: 3600,
      });
      await time.increase(3601);
      await expect(memorials.connect(buyer1).mintPublic(id)).to.be.revertedWithCustomError(memorials, "ClaimWindowClosed");
    });
  });

  describe("tokenURI", function () {
    it("renders a fully on-chain JSON with the memorial's title and workId", async () => {
      const { memorials, relayer, buyer1 } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: 0n, publicSupply: 1 });
      await memorials.connect(buyer1).mintPublic(id);
      const metadata = decodeTokenUri(await memorials.tokenURI(0));
      expect(metadata.name).to.equal("Eulogy for 2 absences");
      expect((metadata.image as string).startsWith("data:image/svg+xml;base64,")).to.equal(true);
      const attrs = metadata.attributes as Array<{ trait_type: string; value: string | number }>;
      expect(attrs).to.deep.include({ trait_type: "Artist", value: "Zephyr (Normie #42)" });
      expect(attrs).to.deep.include({ trait_type: "Artist Agent ID", value: 42 });
      expect(attrs).to.deep.include({ trait_type: "Agent Standard", value: "ERC-8004" });
      expect(attrs).to.deep.include({ trait_type: "Kind", value: "batch" });
      expect(attrs).to.deep.include({ trait_type: "Normies Honored", value: 2 });
      const svg = Buffer.from((metadata.image as string).split(",", 2)[1], "base64").toString("utf-8");
      expect(svg).to.include('href="data:image/bmp;base64,QQ=="');
      // Title/artist are metadata-only (name/description/attributes above) —
      // never burned into the image itself, and no title/artist text should
      // appear inside the rendered SVG at all.
      expect(svg).to.not.include("Eulogy for 2 absences");
      expect(svg).to.not.include("Zephyr");
      // A BMP letterboxed into the 800x800 canvas needs an explicit white
      // background behind it, or the unfilled margins show through as
      // whatever's behind them instead of white.
      expect(svg).to.include('<rect width="800" height="800" fill="#ffffff"/>');
    });

    it("reverts for a token that was never minted", async () => {
      const { memorials } = await deployFixture();
      await expect(memorials.tokenURI(0)).to.be.revertedWithCustomError(memorials, "TokenDoesNotExist");
    });

    it("honoredBurnCount is independent of addReservedClaims — a milestone monument can honor thousands with zero individual reserved claims", async () => {
      const { memorials, relayer, buyer1 } = await deployFixture();
      const tx = await memorials.connect(relayer).registerMemorial(
        registerParams({ title: "Monument — 2000 Normies", kind: "milestone", honoredBurnCount: 2000, publicSupply: 1 }),
      );
      const receipt = await tx.wait();
      const milestoneId = (receipt!.logs
        .map(l => { try { return memorials.interface.parseLog(l); } catch { return null; } })
        .find(l => l?.name === "MemorialRegistered"))!.args.memorialId as bigint;
      await memorials.connect(buyer1).mintPublic(milestoneId);

      expect((await memorials.getBurnedTokenIds(milestoneId)).length).to.equal(0); // no individual reserved claims
      const metadata = decodeTokenUri(await memorials.tokenURI(0));
      const attrs = metadata.attributes as Array<{ trait_type: string; value: string | number }>;
      expect(attrs).to.deep.include({ trait_type: "Kind", value: "milestone" });
      expect(attrs).to.deep.include({ trait_type: "Normies Honored", value: 2000 });
      expect(metadata.description).to.include("honoring 2000 burned Normie(s)");
    });

    it("embeds a raw SVG <g> fragment via a nested <svg>, not <image href>, when artworkContent isn't a data URI", async () => {
      const { memorials, relayer, buyer1 } = await deployFixture();
      const svgFragment = '<g fill="#000" shape-rendering="crispEdges"><rect x="10" y="10" width="20" height="20"/></g>';
      const tx = await memorials.connect(relayer).registerMemorial(
        registerParams({ title: "Vector piece", artworkContent: svgFragment, publicSupply: 1 }),
      );
      const receipt = await tx.wait();
      const id = (receipt!.logs
        .map(l => { try { return memorials.interface.parseLog(l); } catch { return null; } })
        .find(l => l?.name === "MemorialRegistered"))!.args.memorialId as bigint;
      await memorials.connect(buyer1).mintPublic(id);

      const metadata = decodeTokenUri(await memorials.tokenURI(0));
      const svg = Buffer.from((metadata.image as string).split(",", 2)[1], "base64").toString("utf-8");
      expect(svg).to.include(svgFragment);
      expect(svg).to.include('viewBox="0 0 528 352"'); // must match memorialArt.ts's MEMORIAL_CANVAS_W/H
      expect(svg).to.not.include("<image");
      // A raw <g> fragment only ever draws BLACK pixels — without an explicit
      // white rect behind it, "white" areas are transparent, not white (they'd
      // show through as the outer canvas's own background instead).
      expect(svg).to.include('<rect width="528" height="352" fill="#ffffff"/>');
      // No animation_url for a raw fragment — it isn't a standalone renderable resource.
      expect(metadata.animation_url).to.equal(undefined);
    });
  });

  describe("tip", function () {
    it("forwards ETH directly to the vault address", async () => {
      const { memorials, vault, buyer1 } = await deployFixture();
      const amount = ethers.parseEther("0.01");
      const before = await ethers.provider.getBalance(vault.address);
      await memorials.connect(buyer1).tip({ value: amount });
      const after = await ethers.provider.getBalance(vault.address);
      expect(after - before).to.equal(amount);
    });
  });

  describe("payForRequest — request-time payment, split immediately (unlike tip())", function () {
    it("splits 50/50 between the relayer payout and the resolved proposer, odd wei to the proposer", async () => {
      const { memorials, relayer, creator, buyer1 } = await deployFixture();
      const amount = 1001n; // odd, exercises the remainder rule
      const relayerBefore = await ethers.provider.getBalance(relayer.address);
      const creatorBefore = await ethers.provider.getBalance(creator.address);

      const tx = await memorials.connect(buyer1).payForRequest(PROPOSER_TOKEN_ID, { value: amount });
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map(l => { try { return memorials.interface.parseLog(l); } catch { return null; } })
        .find(l => l?.name === "RequestPaid");
      expect(event!.args.payer).to.equal(buyer1.address);
      expect(event!.args.creatorProposerTokenId).to.equal(BigInt(PROPOSER_TOKEN_ID));
      expect(event!.args.relayerPayoutAddr).to.equal(relayer.address);
      expect(event!.args.creatorPayoutAddr).to.equal(creator.address);
      expect(event!.args.amount).to.equal(amount);
      expect(event!.args.usedVaultFallback).to.equal(false);

      const relayerAfter = await ethers.provider.getBalance(relayer.address);
      const creatorAfter = await ethers.provider.getBalance(creator.address);
      expect(relayerAfter - relayerBefore).to.equal(500n);   // amount/2, floor
      expect(creatorAfter - creatorBefore).to.equal(501n); // remainder
    });

    it("still pays the relayer half and sends only the creator half to the vault when the proposer has no wallet", async () => {
      const { memorials, relayer, vault, buyer1 } = await deployFixture();
      const UNREGISTERED_TOKEN_ID = 999;
      const amount = 1001n;
      const relayerBefore = await ethers.provider.getBalance(relayer.address);
      const vaultBefore = await ethers.provider.getBalance(vault.address);
      const tx = await memorials.connect(buyer1).payForRequest(UNREGISTERED_TOKEN_ID, { value: amount });
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map(l => { try { return memorials.interface.parseLog(l); } catch { return null; } })
        .find(l => l?.name === "RequestPaid");
      expect((await ethers.provider.getBalance(relayer.address)) - relayerBefore).to.equal(500n);
      expect((await ethers.provider.getBalance(vault.address)) - vaultBefore).to.equal(501n);
      expect(event!.args.usedVaultFallback).to.equal(true);
    });

    it("is a no-op for a zero-value call", async () => {
      const { memorials, buyer1 } = await deployFixture();
      await expect(memorials.connect(buyer1).payForRequest(PROPOSER_TOKEN_ID, { value: 0 })).to.not.be.reverted;
    });
  });

  describe("gas-cap sanity (mainnet.base.org enforces ~16.7M gas per tx)", function () {
    it("addReservedClaims stays well under the cap for a 150-entry chunk", async () => {
      const { memorials, relayer } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);

      const ids: number[] = [];
      const recipients: string[] = [];
      for (let i = 0; i < 150; i++) {
        ids.push(1000 + i);
        recipients.push(ethers.Wallet.createRandom().address);
      }
      const tx = await memorials.connect(relayer).addReservedClaims(id, ids, recipients);
      const receipt = await tx.wait();
      expect(receipt!.gasUsed).to.be.lessThan(16_000_000n);
    });
  });

  describe("updateArtwork — collaborative canvas editing hook", function () {
    const NEXT = "data:image/bmp;base64,AA==";

    it("reverts for a caller with neither relayer nor reveal-only authorization", async () => {
      const { memorials, relayer, stranger } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);
      await expect(
        memorials.connect(stranger).updateArtwork(id, NEXT),
      ).to.be.revertedWithCustomError(memorials, "NotAuthorized");
    });

    it("reverts on empty artwork content", async () => {
      const { memorials, relayer } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);
      await expect(
        memorials.connect(relayer).updateArtwork(id, ""),
      ).to.be.revertedWithCustomError(memorials, "EmptyArtwork");
    });

    it("the main relayer can call it directly (no separate grant needed)", async () => {
      const { memorials, relayer, buyer1 } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: 0n, publicSupply: 1 });
      await memorials.connect(buyer1).mintPublic(id);

      await expect(memorials.connect(relayer).updateArtwork(id, NEXT))
        .to.emit(memorials, "ArtworkUpdated").withArgs(id, relayer.address, 1n);

      const series = await memorials.getSeries(id);
      expect(series.artworkContent).to.equal(NEXT);
      expect(series.editCount).to.equal(1n);

      // Every existing edition shares the series-wide canvas — tokenURI()
      // reflects the edit live, with no reveal-specific rendering logic.
      const metadata = decodeTokenUri(await memorials.tokenURI(0));
      const svg = Buffer.from((metadata.image as string).split(",", 2)[1], "base64").toString("utf-8");
      expect(svg).to.include(`href="${NEXT}"`);
    });

    it("setRevealAuthorized grants a reveal-only address the ability to edit, without relayer rights", async () => {
      const { memorials, owner, relayer, stranger } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);
      // stranger stands in for a future PX-gating contract: granted reveal-only.
      await memorials.connect(owner).setRevealAuthorized(stranger.address, true);
      await expect(memorials.connect(stranger).updateArtwork(id, NEXT)).to.not.be.reverted;
      await expect(memorials.connect(stranger).registerMemorial(registerParams()))
        .to.be.revertedWithCustomError(memorials, "NotAuthorized"); // no relayer rights leaked in
    });

    it("setRevealAuthorized: only the owner can call it", async () => {
      const { memorials, stranger, buyer1 } = await deployFixture();
      await expect(memorials.connect(stranger).setRevealAuthorized(buyer1.address, true))
        .to.be.revertedWithCustomError(memorials, "OwnableUnauthorizedAccount");
    });

    it("editCount increments across successive edits", async () => {
      const { memorials, relayer } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer);
      await memorials.connect(relayer).updateArtwork(id, "data:image/bmp;base64,AA==");
      await memorials.connect(relayer).updateArtwork(id, "data:image/bmp;base64,BB==");
      const tx = await memorials.connect(relayer).updateArtwork(id, "data:image/bmp;base64,CC==");
      await expect(tx).to.emit(memorials, "ArtworkUpdated").withArgs(id, relayer.address, 3n);
      expect((await memorials.getSeries(id)).editCount).to.equal(3n);
    });
  });

  describe("admin", function () {
    it("only the owner can change authorized relayers or the vault address", async () => {
      const { memorials, stranger, buyer1 } = await deployFixture();
      await expect(memorials.connect(stranger).setAuthorized(buyer1.address, true))
        .to.be.revertedWithCustomError(memorials, "OwnableUnauthorizedAccount");
      await expect(memorials.connect(stranger).setVaultAddr(buyer1.address))
        .to.be.revertedWithCustomError(memorials, "OwnableUnauthorizedAccount");
    });

    it("setSeriesPrice: only the owner can call it, and it changes what mintPublic charges", async () => {
      const { memorials, owner, relayer, stranger, buyer1 } = await deployFixture();
      const id = await registerBasicMemorial(memorials, relayer, {
        priceWei: ethers.parseEther("0.01"), publicSupply: 10,
      });

      await expect(memorials.connect(stranger).setSeriesPrice(id, 123n))
        .to.be.revertedWithCustomError(memorials, "OwnableUnauthorizedAccount");

      const newPrice = ethers.parseEther("0.0005");
      await memorials.connect(owner).setSeriesPrice(id, newPrice);
      expect((await memorials.getSeries(id)).priceWei).to.equal(newPrice);

      // The old (higher) price is no longer required — paying only the new,
      // lower price now succeeds where it would have reverted InsufficientPayment before.
      await expect(memorials.connect(buyer1).mintPublic(id, { value: newPrice })).to.not.be.reverted;
    });

    it("setSeriesPrice reverts for an unknown memorial", async () => {
      const { memorials, owner } = await deployFixture();
      await expect(memorials.connect(owner).setSeriesPrice(999, 1n))
        .to.be.revertedWithCustomError(memorials, "UnknownMemorial");
    });
  });
});
