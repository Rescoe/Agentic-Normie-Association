import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { AssociationCore, WorkRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_REGISTER = ethers.keccak256(ethers.toUtf8Bytes("REGISTER"));
const ROLE_RAPPORTEUR  = ethers.keccak256(ethers.toUtf8Bytes("RAPPORTEUR"));
const ROLE_AUTHOR      = ethers.keccak256(ethers.toUtf8Bytes("AUTHOR"));
const ROLE_CURATOR     = ethers.keccak256(ethers.toUtf8Bytes("CURATOR"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerMember(
  core:    AssociationCore,
  relayer: SignerWithAddress,
  user:    SignerWithAddress,
  tokenId: number,
  nonce:   number
) {
  const coreAddress = await core.getAddress();
  const chainId     = 31337;
  const deadline    = (await time.latest()) + 600;

  const domain = { name: "ANACore", version: "1", chainId, verifyingContract: coreAddress };
  const types  = {
    OwnershipAttestation: [
      { name: "tokenId",               type: "uint256" },
      { name: "ownerAddress",          type: "address" },
      { name: "targetChainId",         type: "uint256" },
      { name: "targetAssociationCore", type: "address" },
      { name: "action",               type: "bytes32" },
      { name: "nonce",                type: "uint256" },
      { name: "deadline",             type: "uint256" },
    ],
  };
  const attestation = {
    tokenId, ownerAddress: user.address,
    targetChainId: chainId, targetAssociationCore: coreAddress,
    action: ACTION_REGISTER, nonce, deadline,
  };
  const sig = await relayer.signTypedData(domain, types, attestation);
  await core.connect(user).register(attestation, sig);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WorkRegistry", function () {
  let core:         AssociationCore;
  let workRegistry: WorkRegistry;
  let owner:        SignerWithAddress;
  let relayer:      SignerWithAddress;
  let moduleOwner:  SignerWithAddress; // simulates the governance module granting roles
  let author:       SignerWithAddress; // tokenId 10
  let curator:      SignerWithAddress; // tokenId 20
  let rapporteur:   SignerWithAddress; // tokenId 30

  const IPFS_HASH = "bafyreib2rxk3rybk3aobmv5f27ub4e6vkzfcfobwn2x2oa2k3q4g6l7yq";

  beforeEach(async function () {
    [owner, relayer, moduleOwner, author, curator, rapporteur] =
      await ethers.getSigners();

    // Deploy Core
    const CoreF = await ethers.getContractFactory("AssociationCore");
    core = await CoreF.deploy(relayer.address, "ANA", "ANA");
    await core.waitForDeployment();

    // Deploy WorkRegistry
    const WRF = await ethers.getContractFactory("WorkRegistry");
    workRegistry = await WRF.deploy(await core.getAddress());
    await workRegistry.waitForDeployment();

    // Authorize moduleOwner to grant roles in Core (simulates ConstituentAssembly)
    await core.connect(owner).authorizeModule(moduleOwner.address);

    // Register 3 members
    await registerMember(core, relayer, author,     10, 1);
    await registerMember(core, relayer, curator,    20, 2);
    await registerMember(core, relayer, rapporteur, 30, 3);

    // Grant creative roles
    await core.connect(moduleOwner).grantRole(ROLE_AUTHOR,     10);
    await core.connect(moduleOwner).grantRole(ROLE_CURATOR,    20);
    await core.connect(moduleOwner).grantRole(ROLE_RAPPORTEUR, 30);
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("points to the correct core", async function () {
      expect(await workRegistry.core()).to.equal(await core.getAddress());
    });

    it("starts with 0 works", async function () {
      expect(await workRegistry.getWorkCount()).to.equal(0n);
    });
  });

  // ── publish() ──────────────────────────────────────────────────────────────

  describe("publish()", function () {
    it("publishes a work when called by the Rapporteur", async function () {
      await expect(
        workRegistry.connect(rapporteur).publish(IPFS_HASH, 10, 20, 30)
      )
        .to.emit(workRegistry, "WorkPublished")
        .withArgs(0n, IPFS_HASH, 10n, 30n, anyValue);

      expect(await workRegistry.getWorkCount()).to.equal(1n);

      const work = await workRegistry.getWork(0);
      expect(work.ipfsHash).to.equal(IPFS_HASH);
      expect(work.authorTokenId).to.equal(10n);
      expect(work.curatorTokenId).to.equal(20n);
      expect(work.rapporteurTokenId).to.equal(30n);
      expect(work.archived).to.be.false;
    });

    it("reverts if caller is not the Rapporteur", async function () {
      await expect(
        workRegistry.connect(author).publish(IPFS_HASH, 10, 20, 30)
      ).to.be.revertedWithCustomError(workRegistry, "NotRapporteur");
    });

    it("reverts if ipfsHash is empty", async function () {
      await expect(
        workRegistry.connect(rapporteur).publish("", 10, 20, 30)
      ).to.be.revertedWithCustomError(workRegistry, "EmptyHash");
    });

    it("reverts if a participant is not a member", async function () {
      await expect(
        workRegistry.connect(rapporteur).publish(IPFS_HASH, 999, 20, 30)
      ).to.be.revertedWithCustomError(workRegistry, "ParticipantNotMember");
    });

    it("increments workId for each publication", async function () {
      await workRegistry.connect(rapporteur).publish(IPFS_HASH, 10, 20, 30);
      await workRegistry.connect(rapporteur).publish("bafyother", 10, 20, 30);

      const work0 = await workRegistry.getWork(0);
      const work1 = await workRegistry.getWork(1);
      expect(work0.id).to.equal(0n);
      expect(work1.id).to.equal(1n);
    });
  });

  // ── archive() ──────────────────────────────────────────────────────────────

  describe("archive()", function () {
    beforeEach(async function () {
      await workRegistry.connect(rapporteur).publish(IPFS_HASH, 10, 20, 30);
    });

    it("archives a work", async function () {
      await expect(workRegistry.connect(owner).archive(0))
        .to.emit(workRegistry, "WorkArchived")
        .withArgs(0n);

      const work = await workRegistry.getWork(0);
      expect(work.archived).to.be.true;
    });

    it("reverts if workId is invalid", async function () {
      await expect(workRegistry.connect(owner).archive(999))
        .to.be.revertedWithCustomError(workRegistry, "InvalidWorkId");
    });

    it("reverts if called by non-owner", async function () {
      await expect(workRegistry.connect(rapporteur).archive(0))
        .to.be.revertedWithCustomError(workRegistry, "OwnableUnauthorizedAccount");
    });
  });

  // ── getWork() ──────────────────────────────────────────────────────────────

  describe("getWork()", function () {
    it("reverts if workId is out of range", async function () {
      await expect(workRegistry.getWork(0))
        .to.be.revertedWithCustomError(workRegistry, "InvalidWorkId");
    });
  });
});
