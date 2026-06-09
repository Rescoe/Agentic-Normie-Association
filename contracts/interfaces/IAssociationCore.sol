// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAssociationCore
 * @notice Public interface of AssociationCore.
 *         All peripheral modules and future contracts interact via this interface.
 *         Never remove or rename entries — this is the stable surface of the Core.
 */
interface IAssociationCore {
    // ── Structs ──────────────────────────────────────────────────────────────

    struct Member {
        address ownerAddress; // wallet that registered (on Base, snapshot at inscription)
        uint256 registeredAt; // block.timestamp
        bool    active;
    }

    struct RoleAssignment {
        uint256 tokenId;       // Normie holding the role
        address holderAddress; // ownerAddress at assignment time
        uint256 assignedAt;    // block.timestamp
    }

    // ── Events ───────────────────────────────────────────────────────────────

    event MemberRegistered(uint256 indexed tokenId, address indexed ownerAddress, uint256 timestamp);
    event RoleGranted(bytes32 indexed role, uint256 indexed tokenId, address indexed holderAddress);
    event ModuleAuthorized(address indexed module);
    event ModuleRevoked(address indexed module);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event ConstitutionSet(bytes32 indexed ipfsHash);

    // ── Reads ─────────────────────────────────────────────────────────────────

    function isMember(uint256 tokenId) external view returns (bool);
    function getMemberOwner(uint256 tokenId) external view returns (address);
    function getMemberCount() external view returns (uint256);
    function getMemberTokenIds() external view returns (uint256[] memory);
    function getRoleHolder(bytes32 role) external view returns (RoleAssignment memory);
    function authorizedModules(address module) external view returns (bool);
    function relayerAddress() external view returns (address);

    // ── Writes (module-gated) ─────────────────────────────────────────────────

    function grantRole(bytes32 role, uint256 tokenId) external;
}
