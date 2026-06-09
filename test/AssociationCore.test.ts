import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { AssociationCore } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_REGISTER = ethers.keccak256(ethers.toUtf8Bytes("REGISTER"));
const ROLE_PRESIDENT  = ethers.keccak256(ethers.toUtf8Bytes("PRESIDENT"));

async function buildAttestation(params: {
  tokenId:   number;
  owner:     string;
  nonce:     number;
  deadline:  number;
  relayer:   SignerWithAddress;
  core:      string;
  chainId?:  number;
  wrongAction?: boolean;
}) {
  const chainId = params.chainId ?? 31337;

  const domain = {
    name:              "ANACore",
    version:           "1",
    chainId,
    verifyingContract: params.core,
  };

  const types = {
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
    tokenId:               params.tokenId,
    ownerAddress:          params.owner,
    targetChainId:         chainId,
    targetAssociationCore: params.core,
    action:                params.wrongAction
      ? ethers.keccak256(ethers.toUtf8Bytes("WRONG"))
      : ACTION_REGISTER,
    nonce:    params.nonce,
    deadline: params.deadline,
  };

  const signature = await params.relayer.signTypedData(domain, types, attestation);
  return { attestation, signature };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AssociationCore", function () {
  let core:    AssociationCore;
  let owner:   SignerWithAddress;
  let relayer: SignerWithAddress;
  let user1:   SignerWithAddress;
  let user2:   SignerWithAddress;
  let moduleA: SignerWithAddress;

  beforeEach(async function () {
    [owner, relayer, user1, user2, moduleA] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("AssociationCore");
    core = await Factory.deploy(relayer.address, "Agentic Normie Association", "ANA");
    await core.waitForDeployment();
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("stores relayer address", async function () {
      expect(await core.relayerAddress()).to.equal(relayer.address);
    });

    it("stores association name", async function () {
      expect(await core.associationName()).to.equal("Agentic Normie Association");
    });

    it("starts with 0 members", async function () {
      expect(await core.getMemberCount()).to.equal(0);
    });

    it("reverts with zero relayer address", async function () {
      const F = await ethers.getContractFactory("AssociationCore");
      await expect(
        F.deploy(ethers.ZeroAddress, "ANA", "ANA")
      ).to.be.revertedWithCustomError(core, "InvalidAddress");
    });
  });

  // ── register() ─────────────────────────────────────────────────────────────

  describe("register()", function () {
    it("registers a member with a valid attestation", async function () {
      const tokenId  = 42;
      const deadline = (await time.latest()) + 600;
      const { attestation, signature } = await buildAttestation({
        tokenId, owner: user1.address, nonce: 1, deadline, relayer,
        core: await core.getAddress(),
      });

      await expect(core.connect(user1).register(attestation, signature))
        .to.emit(core, "MemberRegistered")
        .withArgs(tokenId, user1.address, anyValue);

      expect(await core.isMember(tokenId)).to.be.true;
      expect(await core.getMemberOwner(tokenId)).to.equal(user1.address);
      expect(await core.getMemberCount()).to.equal(1);
      expect(await core.getMemberTokenIds()).to.deep.equal([BigInt(tokenId)]);
    });

    it("reverts if tokenId already registered", async function () {
      const deadline = (await time.latest()) + 600;
      const { attestation: a1, signature: s1 } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 1, deadline, relayer,
        core: await core.getAddress(),
      });
      await core.connect(user1).register(a1, s1);

      const { attestation: a2, signature: s2 } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 2, deadline, relayer,
        core: await core.getAddress(),
      });
      await expect(core.connect(user1).register(a2, s2))
        .to.be.revertedWithCustomError(core, "AlreadyRegistered");
    });

    it("reverts if attestation is expired", async function () {
      const deadline = (await time.latest()) - 1;
      const { attestation, signature } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 1, deadline, relayer,
        core: await core.getAddress(),
      });
      await expect(core.connect(user1).register(attestation, signature))
        .to.be.revertedWithCustomError(core, "AttestationExpired");
    });

    it("reverts if nonce is reused", async function () {
      const deadline = (await time.latest()) + 600;
      const { attestation: a1, signature: s1 } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 1, deadline, relayer,
        core: await core.getAddress(),
      });
      await core.connect(user1).register(a1, s1);

      // Different tokenId, same nonce
      const { attestation: a2, signature: s2 } = await buildAttestation({
        tokenId: 43, owner: user2.address, nonce: 1, deadline, relayer,
        core: await core.getAddress(),
      });
      await expect(core.connect(user2).register(a2, s2))
        .to.be.revertedWithCustomError(core, "NonceAlreadyUsed");
    });

    it("reverts if caller is not the attested owner", async function () {
      const deadline = (await time.latest()) + 600;
      const { attestation, signature } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 1, deadline, relayer,
        core: await core.getAddress(),
      });
      // user2 tries to use user1's attestation
      await expect(core.connect(user2).register(attestation, signature))
        .to.be.revertedWithCustomError(core, "CallerNotAttestedOwner");
    });

    it("reverts if signature is from wrong signer", async function () {
      const deadline = (await time.latest()) + 600;
      const { attestation, signature } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 1, deadline,
        relayer: user2, // not the real relayer
        core: await core.getAddress(),
      });
      await expect(core.connect(user1).register(attestation, signature))
        .to.be.revertedWithCustomError(core, "InvalidRelayerSignature");
    });

    it("reverts if wrong targetChainId", async function () {
      const deadline = (await time.latest()) + 600;
      const { attestation, signature } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 1, deadline, relayer,
        core: await core.getAddress(),
        chainId: 999, // wrong chain
      });
      // signature is valid for chainId=999, but contract is on chainId=31337
      // The attestation.targetChainId=999 ≠ block.chainid=31337 → WrongChain
      await expect(core.connect(user1).register(attestation, signature))
        .to.be.revertedWithCustomError(core, "WrongChain");
    });

    it("reverts if wrong targetAssociationCore", async function () {
      const deadline = (await time.latest()) + 600;
      const { attestation, signature } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 1, deadline, relayer,
        core: user2.address, // wrong contract address in attestation
      });
      await expect(core.connect(user1).register(attestation, signature))
        .to.be.revertedWithCustomError(core, "WrongContract");
    });

    it("reverts if wrong action", async function () {
      const deadline = (await time.latest()) + 600;
      const { attestation, signature } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 1, deadline, relayer,
        core: await core.getAddress(),
        wrongAction: true,
      });
      await expect(core.connect(user1).register(attestation, signature))
        .to.be.revertedWithCustomError(core, "WrongAction");
    });

    it("marks the nonce as used after registration", async function () {
      const deadline = (await time.latest()) + 600;
      const { attestation, signature } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 7, deadline, relayer,
        core: await core.getAddress(),
      });
      await core.connect(user1).register(attestation, signature);
      expect(await core.usedNonces(7)).to.be.true;
    });
  });

  // ── grantRole() ────────────────────────────────────────────────────────────

  describe("grantRole()", function () {
    beforeEach(async function () {
      const deadline = (await time.latest()) + 600;
      const { attestation, signature } = await buildAttestation({
        tokenId: 42, owner: user1.address, nonce: 1, deadline, relayer,
        core: await core.getAddress(),
      });
      await core.connect(user1).register(attestation, signature);
    });

    it("grants a role when called by an authorized module", async function () {
      await core.connect(owner).authorizeModule(moduleA.address);
      await expect(core.connect(moduleA).grantRole(ROLE_PRESIDENT, 42))
        .to.emit(core, "RoleGranted")
        .withArgs(ROLE_PRESIDENT, 42, user1.address);

      const ra = await core.getRoleHolder(ROLE_PRESIDENT);
      expect(ra.tokenId).to.equal(42n);
      expect(ra.holderAddress).to.equal(user1.address);
    });

    it("reverts if caller is not an authorized module", async function () {
      await expect(core.connect(user2).grantRole(ROLE_PRESIDENT, 42))
        .to.be.revertedWithCustomError(core, "NotAuthorizedModule");
    });

    it("reverts if tokenId is not a registered member", async function () {
      await core.connect(owner).authorizeModule(moduleA.address);
      await expect(core.connect(moduleA).grantRole(ROLE_PRESIDENT, 999))
        .to.be.revertedWithCustomError(core, "TokenIdNotMember");
    });
  });

  // ── Admin ──────────────────────────────────────────────────────────────────

  describe("Admin", function () {
    it("authorizes and revokes modules", async function () {
      await core.connect(owner).authorizeModule(moduleA.address);
      expect(await core.authorizedModules(moduleA.address)).to.be.true;

      await core.connect(owner).revokeModule(moduleA.address);
      expect(await core.authorizedModules(moduleA.address)).to.be.false;
    });

    it("emits RelayerUpdated when setRelayer is called", async function () {
      await expect(core.connect(owner).setRelayer(user2.address))
        .to.emit(core, "RelayerUpdated")
        .withArgs(relayer.address, user2.address);
      expect(await core.relayerAddress()).to.equal(user2.address);
    });

    it("reverts setRelayer with zero address", async function () {
      await expect(core.connect(owner).setRelayer(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(core, "InvalidAddress");
    });

    it("only owner can authorizeModule", async function () {
      await expect(core.connect(user1).authorizeModule(moduleA.address))
        .to.be.revertedWithCustomError(core, "OwnableUnauthorizedAccount");
    });
  });
});
