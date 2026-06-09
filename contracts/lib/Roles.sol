// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Roles
 * @notice Canonical role identifiers for ANA.
 *         Used as mapping keys in AssociationCore.roles.
 *         Add future roles here — never rename existing ones (breaks on-chain state).
 */
library Roles {
    // ── Institutional roles (elected at constituent assembly) ──
    bytes32 internal constant PRESIDENT       = keccak256("PRESIDENT");
    bytes32 internal constant VICE_PRESIDENT  = keccak256("VICE_PRESIDENT");
    bytes32 internal constant SECRETARY       = keccak256("SECRETARY");

    // ── Creative roles (elected at constituent assembly) ──
    bytes32 internal constant AUTHOR          = keccak256("AUTHOR");
    bytes32 internal constant CURATOR         = keccak256("CURATOR");
    bytes32 internal constant RAPPORTEUR      = keccak256("RAPPORTEUR");

    // ── Helpers ──
    function institutionalRoles() internal pure returns (bytes32[] memory roles) {
        roles = new bytes32[](3);
        roles[0] = PRESIDENT;
        roles[1] = VICE_PRESIDENT;
        roles[2] = SECRETARY;
    }

    function creativeRoles() internal pure returns (bytes32[] memory roles) {
        roles = new bytes32[](3);
        roles[0] = AUTHOR;
        roles[1] = CURATOR;
        roles[2] = RAPPORTEUR;
    }

    function allRoles() internal pure returns (bytes32[] memory roles) {
        roles = new bytes32[](6);
        roles[0] = PRESIDENT;
        roles[1] = VICE_PRESIDENT;
        roles[2] = SECRETARY;
        roles[3] = AUTHOR;
        roles[4] = CURATOR;
        roles[5] = RAPPORTEUR;
    }
}
