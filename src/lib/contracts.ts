/**
 * Contract ABIs and address resolution.
 * ABIs are minimal (only functions used by the frontend).
 * Full ABIs come from typechain-types after compile, but we keep
 * these inline stubs so the frontend compiles before the first hardhat run.
 */

// ─── Addresses (from environment) ────────────────────────────────────────────

export const CONTRACT_ADDRESSES = {
  AssociationCore:     process.env.NEXT_PUBLIC_ASSOCIATION_CORE_ADDRESS     ?? "",
  ConstituentAssembly: process.env.NEXT_PUBLIC_CONSTITUENT_ASSEMBLY_ADDRESS ?? "",
  WorkRegistry:        process.env.NEXT_PUBLIC_WORK_REGISTRY_ADDRESS        ?? "",
  FactoryRegistry:     process.env.NEXT_PUBLIC_FACTORY_REGISTRY_ADDRESS     ?? "",
} as const;

// ─── Minimal ABIs (used by wagmi readContract / writeContract) ───────────────

export const ASSOCIATION_CORE_ABI = [
  // Views
  "function isMember(uint256 tokenId) external view returns (bool)",
  "function getMemberOwner(uint256 tokenId) external view returns (address)",
  "function getMemberCount() external view returns (uint256)",
  "function getMemberTokenIds() external view returns (uint256[])",
  "function getRoleHolder(bytes32 role) external view returns (tuple(uint256 tokenId, address holderAddress, uint256 assignedAt))",
  "function relayerAddress() external view returns (address)",
  "function associationName() external view returns (string)",
  "function foundedAt() external view returns (uint256)",
  "function domainSeparator() external view returns (bytes32)",
  // Writes
  "function register(tuple(uint256 tokenId, address ownerAddress, uint256 targetChainId, address targetAssociationCore, bytes32 action, uint256 nonce, uint256 deadline) attestation, bytes signature) external",
  // Events
  "event MemberRegistered(uint256 indexed tokenId, address indexed ownerAddress, uint256 timestamp)",
  "event RoleGranted(bytes32 indexed role, uint256 indexed tokenId, address indexed holderAddress)",
] as const;

export const CONSTITUENT_ASSEMBLY_ABI = [
  // Views
  "function currentSession() external view returns (uint256 id, uint256 openedAt, uint256 closedAt, bool active, bool resolved)",
  "function getElectableRoles() external view returns (bytes32[])",
  "function getVoteCount(bytes32 role, uint256 candidateTokenId) external view returns (uint256)",
  "function getLeader(bytes32 role) external view returns (uint256 tokenId, uint256 count)",
  "function getCandidates(bytes32 role) external view returns (uint256[])",
  "function hasVoted(uint256 voterTokenId, bytes32 role) external view returns (bool)",
  // Writes
  "function openSession() external",
  "function closeSession() external",
  "function castVote(uint256 voterTokenId, bytes32 role, uint256 candidateTokenId) external",
  // Events
  "event SessionOpened(uint256 indexed sessionId, uint256 timestamp)",
  "event VoteCast(uint256 indexed sessionId, uint256 indexed voterTokenId, bytes32 indexed role, uint256 candidateTokenId)",
  "event SessionClosed(uint256 indexed sessionId, uint256 timestamp)",
  "event RolesResolved(uint256 indexed sessionId)",
] as const;

export const WORK_REGISTRY_ABI = [
  // Views
  "function getWorkCount() external view returns (uint256)",
  "function getWork(uint256 id) external view returns (tuple(uint256 id, string ipfsHash, uint256 authorTokenId, uint256 curatorTokenId, uint256 rapporteurTokenId, uint256 publishedAt, bool archived))",
  // Writes
  "function publish(string ipfsHash, uint256 authorTokenId, uint256 curatorTokenId, uint256 rapporteurTokenId) external",
  // Events
  "event WorkPublished(uint256 indexed workId, string ipfsHash, uint256 indexed authorTokenId, uint256 indexed rapporteurTokenId, uint256 timestamp)",
] as const;

// ─── Role constants (mirrors Roles.sol) ───────────────────────────────────────

import { keccak256, stringToBytes } from "viem";

// Pre-computed at module load — mirrors Roles.sol constants exactly.
// keccak256(stringToBytes("X")) === keccak256(abi.encodePacked("X")) in Solidity.
export const ROLES = {
  PRESIDENT:      keccak256(stringToBytes("PRESIDENT")),
  VICE_PRESIDENT: keccak256(stringToBytes("VICE_PRESIDENT")),
  SECRETARY:      keccak256(stringToBytes("SECRETARY")),
  AUTHOR:         keccak256(stringToBytes("AUTHOR")),
  CURATOR:        keccak256(stringToBytes("CURATOR")),
  RAPPORTEUR:     keccak256(stringToBytes("RAPPORTEUR")),
} as const;

export const ROLE_LABELS: Record<string, string> = {
  [ROLES.PRESIDENT]:      "Président",
  [ROLES.VICE_PRESIDENT]: "Vice-Président / Trésorier",
  [ROLES.SECRETARY]:      "Secrétaire",
  [ROLES.AUTHOR]:         "Auteur",
  [ROLES.CURATOR]:        "Curateur",
  [ROLES.RAPPORTEUR]:     "Rapporteur",
};

export const ACTION_REGISTER = keccak256(stringToBytes("REGISTER"));
