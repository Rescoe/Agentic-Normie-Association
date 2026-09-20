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
  const tx = await memorials.connect(relayer).registerMemorial(
    "Eulogy for 2 absences",
    "data:image/bmp;base64,QQ==",
    0,
    PROPOSER_TOKEN_ID,
    opts.priceWei ?? 0n,
    opts.publicSupply ?? 0,
    opts.requesterSupply ?? 0,
    opts.requesterAddr ?? ethers.ZeroAddress,
    opts.openEnded ?? false,
    opts.claimDurationSeconds ?? 0,
  );
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
        memorials.connect(stranger).registerMemorial(
          "t", "data:image/bmp;base64,QQ==", 0, PROPOSER_TOKEN_ID, 0, 0, 0, ethers.ZeroAddress, false, 0,
        ),
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

    it("falls back to the vault (never msg.sender/the relayer) when the proposer has no registered wallet", async () => {
      const { memorials, relayer, vault, core } = await deployFixture();
      const UNREGISTERED_TOKEN_ID = 999;
      // deliberately not set in the mock core -> getMemberOwner returns address(0)
      const tx = await memorials.connect(relayer).registerMemorial(
        "t", "data:image/bmp;base64,QQ==", 0, UNREGISTERED_TOKEN_ID, 0, 0, 0, ethers.ZeroAddress, false, 0,
      );
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map(l => { try { return memorials.interface.parseLog(l); } catch { return null; } })
        .find(l => l?.name === "MemorialRegistered");
      const id = event!.args.memorialId as bigint;
      const series = await memorials.getSeries(id);
      expect(series.creatorAddr).to.equal(vault.address);
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

    it("splits payment 50/50 between vault and creator, odd wei to the creator", async () => {
      const { memorials, relayer, creator, vault, buyer1 } = await deployFixture();
      const price = 1001n; // odd, in wei — exercises the remainder rule
      const id = await registerBasicMemorial(memorials, relayer, { priceWei: price, publicSupply: 10 });

      const vaultBefore   = await ethers.provider.getBalance(vault.address);
      const creatorBefore = await ethers.provider.getBalance(creator.address);
      await memorials.connect(buyer1).mintPublic(id, { value: price });
      const vaultAfter   = await ethers.provider.getBalance(vault.address);
      const creatorAfter = await ethers.provider.getBalance(creator.address);

      expect(vaultAfter - vaultBefore).to.equal(500n);   // price/2, floor
      expect(creatorAfter - creatorBefore).to.equal(501n); // remainder
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
    });

    it("reverts for a token that was never minted", async () => {
      const { memorials } = await deployFixture();
      await expect(memorials.tokenURI(0)).to.be.revertedWithCustomError(memorials, "TokenDoesNotExist");
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
    it("splits 50/50 between the vault and the resolved proposer, odd wei to the proposer", async () => {
      const { memorials, vault, creator, buyer1 } = await deployFixture();
      const amount = 1001n; // odd, exercises the remainder rule
      const vaultBefore   = await ethers.provider.getBalance(vault.address);
      const creatorBefore = await ethers.provider.getBalance(creator.address);

      const tx = await memorials.connect(buyer1).payForRequest(PROPOSER_TOKEN_ID, { value: amount });
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map(l => { try { return memorials.interface.parseLog(l); } catch { return null; } })
        .find(l => l?.name === "RequestPaid");
      expect(event!.args.payer).to.equal(buyer1.address);
      expect(event!.args.creatorProposerTokenId).to.equal(BigInt(PROPOSER_TOKEN_ID));
      expect(event!.args.creatorAddr).to.equal(creator.address);
      expect(event!.args.amount).to.equal(amount);

      const vaultAfter   = await ethers.provider.getBalance(vault.address);
      const creatorAfter = await ethers.provider.getBalance(creator.address);
      expect(vaultAfter - vaultBefore).to.equal(500n);   // amount/2, floor
      expect(creatorAfter - creatorBefore).to.equal(501n); // remainder
    });

    it("sends the full amount to the vault (both halves) when the proposer has no registered wallet", async () => {
      const { memorials, vault, buyer1 } = await deployFixture();
      const UNREGISTERED_TOKEN_ID = 999;
      const amount = ethers.parseEther("0.001");
      const before = await ethers.provider.getBalance(vault.address);
      await memorials.connect(buyer1).payForRequest(UNREGISTERED_TOKEN_ID, { value: amount });
      const after = await ethers.provider.getBalance(vault.address);
      expect(after - before).to.equal(amount);
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
