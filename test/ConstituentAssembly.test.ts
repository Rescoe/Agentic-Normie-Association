import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { AssociationCore, ConstituentAssembly } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_REGISTER    = ethers.keccak256(ethers.toUtf8Bytes("REGISTER"));
const ROLE_PRESIDENT     = ethers.keccak256(ethers.toUtf8Bytes("PRESIDENT"));
const ROLE_VICE_PRESIDENT = ethers.keccak256(ethers.toUtf8Bytes("VICE_PRESIDENT"));
const ROLE_SECRETARY     = ethers.keccak256(ethers.toUtf8Bytes("SECRETARY"));
const ROLE_AUTHOR        = ethers.keccak256(ethers.toUtf8Bytes("AUTHOR"));
const ROLE_CURATOR       = ethers.keccak256(ethers.toUtf8Bytes("CURATOR"));
const ROLE_RAPPORTEUR    = ethers.keccak256(ethers.toUtf8Bytes("RAPPORTEUR"));
const ALL_ROLES = [ROLE_PRESIDENT, ROLE_VICE_PRESIDENT, ROLE_SECRETARY, ROLE_AUTHOR, ROLE_CURATOR, ROLE_RAPPORTEUR];

const VOTE_WINDOW = 7 * 24 * 60 * 60; // matches ELECTION_VOTE_WINDOW_SECONDS

// ─── Helper: register a member in AssociationCore ─────────────────────────────

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

  const domain = {
    name: "ANACore", version: "1", chainId,
    verifyingContract: coreAddress,
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
    tokenId, ownerAddress: user.address,
    targetChainId: chainId, targetAssociationCore: coreAddress,
    action: ACTION_REGISTER, nonce, deadline,
  };
  const sig = await relayer.signTypedData(domain, types, attestation);
  await core.connect(user).register(attestation, sig);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ConstituentAssembly", function () {
  let core:     AssociationCore;
  let assembly: ConstituentAssembly;
  let owner:    SignerWithAddress;
  let relayer:  SignerWithAddress;
  let user1:    SignerWithAddress; // tokenId 1
  let user2:    SignerWithAddress; // tokenId 2
  let user3:    SignerWithAddress; // tokenId 3

  beforeEach(async function () {
    [owner, relayer, user1, user2, user3] = await ethers.getSigners();

    // Deploy Core
    const CoreF = await ethers.getContractFactory("AssociationCore");
    core = await CoreF.deploy(relayer.address, "ANA", "ANA");
    await core.waitForDeployment();

    // Deploy Assembly — real constructor takes (core, owner, relayer)
    const AsmF = await ethers.getContractFactory("ConstituentAssembly");
    assembly = await AsmF.deploy(await core.getAddress(), owner.address, relayer.address);
    await assembly.waitForDeployment();

    // Authorize assembly in Core
    await core.connect(owner).authorizeModule(await assembly.getAddress());

    // Register 3 members (tokenId 1,2,3)
    await registerMember(core, relayer, user1, 1, 1);
    await registerMember(core, relayer, user2, 2, 2);
    await registerMember(core, relayer, user3, 3, 3);
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("points to the correct core", async function () {
      expect(await assembly.core()).to.equal(await core.getAddress());
    });

    it("sets owner and relayerAddress from constructor args", async function () {
      expect(await assembly.owner()).to.equal(owner.address);
      expect(await assembly.relayerAddress()).to.equal(relayer.address);
    });

    it("exposes the electable roles", async function () {
      const roles = await assembly.getElectableRoles();
      expect(roles).to.deep.equal(ALL_ROLES);
    });
  });

  // ── openSession() ──────────────────────────────────────────────────────────

  describe("openSession()", function () {
    it("opens a session and emits event", async function () {
      await expect(assembly.connect(owner).openSession(VOTE_WINDOW))
        .to.emit(assembly, "SessionOpened")
        .withArgs(1n, anyValue);

      const s = await assembly.currentSession();
      expect(s.active).to.be.true;
      expect(s.id).to.equal(1n);
    });

    it("allows the relayer to open a session too (onlyOwnerOrRelayer)", async function () {
      await expect(assembly.connect(relayer).openSession(VOTE_WINDOW)).to.not.be.reverted;
    });

    it("reverts if session already active", async function () {
      await assembly.connect(owner).openSession(VOTE_WINDOW);
      await expect(assembly.connect(owner).openSession(VOTE_WINDOW))
        .to.be.revertedWithCustomError(assembly, "SessionAlreadyActive");
    });

    it("reverts if called by neither owner nor relayer", async function () {
      await expect(assembly.connect(user1).openSession(VOTE_WINDOW))
        .to.be.revertedWithCustomError(assembly, "UnauthorizedCaller");
    });
  });

  // ── castVote() ─────────────────────────────────────────────────────────────

  describe("castVote()", function () {
    beforeEach(async function () {
      await assembly.connect(owner).openSession(VOTE_WINDOW);
    });

    it("accepts a valid vote", async function () {
      await expect(assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2))
        .to.emit(assembly, "VoteCast")
        .withArgs(1n, 1n, ROLE_PRESIDENT, 2n);

      expect(await assembly.getVoteCount(ROLE_PRESIDENT, 2)).to.equal(1n);
      expect(await assembly.hasVoted(1, 1, ROLE_PRESIDENT)).to.be.true;
    });

    it("prevents double vote on the same role", async function () {
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2);
      await expect(assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 3))
        .to.be.revertedWithCustomError(assembly, "AlreadyVotedForRole");
    });

    it("allows the same voter to vote for different roles", async function () {
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2);
      await assembly.connect(user1).castVote(1, ROLE_VICE_PRESIDENT, 3);
      expect(await assembly.hasVoted(1, 1, ROLE_PRESIDENT)).to.be.true;
      expect(await assembly.hasVoted(1, 1, ROLE_VICE_PRESIDENT)).to.be.true;
    });

    it("reverts if voter is not a member", async function () {
      await expect(assembly.connect(owner).castVote(999, ROLE_PRESIDENT, 1))
        .to.be.revertedWithCustomError(assembly, "VoterNotMember");
    });

    it("reverts if caller is not the voter's registered owner", async function () {
      // user2 tries to vote with tokenId 1 (owned by user1)
      await expect(assembly.connect(user2).castVote(1, ROLE_PRESIDENT, 2))
        .to.be.revertedWithCustomError(assembly, "CallerNotVoterOwner");
    });

    it("reverts if candidate is not a member", async function () {
      await expect(assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 999))
        .to.be.revertedWithCustomError(assembly, "CandidateNotMember");
    });

    it("reverts if role is not electable", async function () {
      const fakeRole = ethers.keccak256(ethers.toUtf8Bytes("FAKE"));
      await expect(assembly.connect(user1).castVote(1, fakeRole, 2))
        .to.be.revertedWithCustomError(assembly, "RoleNotElectable");
    });

    it("reverts if no active session", async function () {
      await assembly.connect(owner).closeSession();
      await expect(assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2))
        .to.be.revertedWithCustomError(assembly, "NoActiveSession");
    });
  });

  // ── castVoteAsRelayer() ────────────────────────────────────────────────────

  describe("castVoteAsRelayer()", function () {
    beforeEach(async function () {
      await assembly.connect(owner).openSession(VOTE_WINDOW);
    });

    it("accepts a vote submitted by the relayer on behalf of a member", async function () {
      await expect(assembly.connect(relayer).castVoteAsRelayer(1, ROLE_PRESIDENT, 2))
        .to.emit(assembly, "VoteCast")
        .withArgs(1n, 1n, ROLE_PRESIDENT, 2n);
    });

    it("reverts if caller is not the configured relayer", async function () {
      await expect(assembly.connect(user1).castVoteAsRelayer(1, ROLE_PRESIDENT, 2))
        .to.be.revertedWithCustomError(assembly, "NotRelayer");
    });
  });

  // ── closeSession() + role resolution ────────────────────────────────────────

  describe("closeSession() — role resolution", function () {
    beforeEach(async function () {
      await assembly.connect(owner).openSession(VOTE_WINDOW);
    });

    it("resolves the winner correctly (clear majority)", async function () {
      // tokenId 2 gets 2 votes for President; tokenId 3 gets 1 vote
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2);
      await assembly.connect(user2).castVote(2, ROLE_PRESIDENT, 2);
      await assembly.connect(user3).castVote(3, ROLE_PRESIDENT, 3);

      await assembly.connect(owner).closeSession();

      const president = await core.getRoleHolder(ROLE_PRESIDENT);
      expect(president.tokenId).to.equal(2n);
      expect(president.holderAddress).to.equal(user2.address);
    });

    it("resolves a tie with lowest tokenId wins", async function () {
      // tokenId 1 gets 1 vote, tokenId 2 gets 1 vote → tokenId 1 should win
      await assembly.connect(user2).castVote(2, ROLE_SECRETARY, 1); // vote for tokenId 1
      await assembly.connect(user3).castVote(3, ROLE_SECRETARY, 2); // vote for tokenId 2

      await assembly.connect(owner).closeSession();

      const secretary = await core.getRoleHolder(ROLE_SECRETARY);
      expect(secretary.tokenId).to.equal(1n); // lower tokenId wins tie
    });

    it("skips roles with no votes (no assignment)", async function () {
      // Only President gets a vote
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2);
      await assembly.connect(owner).closeSession();

      const president  = await core.getRoleHolder(ROLE_PRESIDENT);
      const vp         = await core.getRoleHolder(ROLE_VICE_PRESIDENT);

      expect(president.tokenId).to.equal(2n);
      expect(vp.tokenId).to.equal(0n); // no assignment
    });

    it("emits RolesResolved event", async function () {
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 1);
      await expect(assembly.connect(owner).closeSession())
        .to.emit(assembly, "RolesResolved")
        .withArgs(1n);
    });

    it("emits RoleResolved for each resolved role", async function () {
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 1);
      await expect(assembly.connect(owner).closeSession())
        .to.emit(assembly, "RoleResolved")
        .withArgs(1n, ROLE_PRESIDENT, 1n, 1n);
    });

    it("writes roles to AssociationCore via grantRole", async function () {
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2);
      await expect(assembly.connect(owner).closeSession())
        .to.emit(core, "RoleGranted")
        .withArgs(ROLE_PRESIDENT, 2n, user2.address);
    });

    it("reverts closeSession if no active session", async function () {
      await assembly.connect(owner).closeSession(); // close it
      await expect(assembly.connect(owner).closeSession())
        .to.be.revertedWithCustomError(assembly, "NoActiveSession");
    });

    it("reverts closeSession if called by non-owner", async function () {
      await expect(assembly.connect(user1).closeSession())
        .to.be.revertedWithCustomError(assembly, "OwnableUnauthorizedAccount");
    });
  });

  // ── triggerClose() — permissionless after deadline ──────────────────────────

  describe("triggerClose()", function () {
    beforeEach(async function () {
      await assembly.connect(owner).openSession(VOTE_WINDOW);
    });

    it("reverts before the deadline, from anyone", async function () {
      await expect(assembly.connect(user1).triggerClose())
        .to.be.revertedWithCustomError(assembly, "SessionNotExpired");
    });

    it("resolves roles once the deadline has passed, callable by anyone", async function () {
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2);
      await time.increase(VOTE_WINDOW + 1);
      await expect(assembly.connect(user1).triggerClose())
        .to.emit(assembly, "RolesResolved");

      const president = await core.getRoleHolder(ROLE_PRESIDENT);
      expect(president.tokenId).to.equal(2n);
    });
  });

  // ── getLeader() ────────────────────────────────────────────────────────────

  describe("getLeader()", function () {
    beforeEach(async function () {
      await assembly.connect(owner).openSession(VOTE_WINDOW);
    });

    it("returns (0, 0) when no votes cast", async function () {
      const [, count] = await assembly.getLeader(ROLE_PRESIDENT);
      expect(count).to.equal(0n);
    });

    it("returns the current leader mid-session", async function () {
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 3);
      await assembly.connect(user2).castVote(2, ROLE_PRESIDENT, 3);

      const [tokenId, count] = await assembly.getLeader(ROLE_PRESIDENT);
      expect(tokenId).to.equal(3n);
      expect(count).to.equal(2n);
    });
  });

  // ── Session-scoped state (regression: votes/tallies must not leak or carry
  //    over between sessions — a member's session-1 vote must not permanently
  //    block or contaminate session 2, since elections recur every term) ──────

  describe("session-scoped voting (regression)", function () {
    it("lets a member vote again for the same role in a later session", async function () {
      await assembly.connect(owner).openSession(VOTE_WINDOW);
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2);
      await assembly.connect(owner).closeSession();

      await assembly.connect(owner).openSession(VOTE_WINDOW);
      // Would revert with AlreadyVotedForRole if hasVoted were not session-scoped.
      await expect(assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 3))
        .to.emit(assembly, "VoteCast")
        .withArgs(2n, 1n, ROLE_PRESIDENT, 3n);
    });

    it("starts a new session's tally at zero instead of inheriting the previous session's votes", async function () {
      await assembly.connect(owner).openSession(VOTE_WINDOW);
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2);
      await assembly.connect(user2).castVote(2, ROLE_PRESIDENT, 2);
      await assembly.connect(owner).closeSession();

      const firstPresident = await core.getRoleHolder(ROLE_PRESIDENT);
      expect(firstPresident.tokenId).to.equal(2n);

      await assembly.connect(owner).openSession(VOTE_WINDOW);
      const [, freshCount] = await assembly.getLeader(ROLE_PRESIDENT);
      expect(freshCount).to.equal(0n); // not 2 — session 2 starts clean

      // A different winner in session 2 must actually take the role, proving
      // session 1's votes are not silently added on top.
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 3);
      await assembly.connect(user2).castVote(2, ROLE_PRESIDENT, 3);
      await assembly.connect(user3).castVote(3, ROLE_PRESIDENT, 3);
      await assembly.connect(owner).closeSession();

      const secondPresident = await core.getRoleHolder(ROLE_PRESIDENT);
      expect(secondPresident.tokenId).to.equal(3n);
    });

    it("getCandidates() only reflects the current session", async function () {
      await assembly.connect(owner).openSession(VOTE_WINDOW);
      await assembly.connect(user1).castVote(1, ROLE_PRESIDENT, 2);
      await assembly.connect(owner).closeSession();

      await assembly.connect(owner).openSession(VOTE_WINDOW);
      expect(await assembly.getCandidates(ROLE_PRESIDENT)).to.deep.equal([]);
    });
  });
});
