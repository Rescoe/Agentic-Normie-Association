// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAssociationCore.sol";
import "../interfaces/IWorkRegistry.sol";
import "../lib/Roles.sol";

/**
 * @title WorkRegistry
 * @notice On-chain registry of ANA's published cultural works.
 *
 *  Purpose: store a permanent, tamper-proof record of each published work.
 *  The work content itself lives on IPFS; only the CID hash is stored on-chain.
 *
 *  Access control:
 *   - publish() : only the wallet holding the RAPPORTEUR role
 *   - archive() : only the contract owner (admin)
 *
 * @dev Reads role assignments from AssociationCore via IAssociationCore.
 *      Deployed separately from Core — can be upgraded (redeploy) independently.
 */
contract WorkRegistry is IWorkRegistry, Ownable {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct Work {
        uint256 id;
        string  ipfsHash;           // IPFS CIDv1 of the work metadata JSON
        uint256 authorTokenId;      // Normie holding AUTHOR role
        uint256 curatorTokenId;     // Normie holding CURATOR role
        uint256 rapporteurTokenId;  // Normie holding RAPPORTEUR role (publisher)
        uint256 publishedAt;        // block.timestamp
        bool    archived;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IAssociationCore public immutable core;
    Work[]           public works;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event WorkPublished(
        uint256 indexed workId,
        string  ipfsHash,
        uint256 indexed authorTokenId,
        uint256 indexed rapporteurTokenId,
        uint256 timestamp
    );
    event WorkArchived(uint256 indexed workId);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error EmptyHash();
    error NotRapporteur(address caller);
    error InvalidWorkId(uint256 id);
    error ParticipantNotMember(uint256 tokenId);
    error InvalidCore();

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Checks that msg.sender is the wallet currently holding the RAPPORTEUR role
     *      according to AssociationCore.
     */
    modifier onlyRapporteur() {
        IAssociationCore.RoleAssignment memory ra = core.getRoleHolder(Roles.RAPPORTEUR);
        if (ra.holderAddress != msg.sender) revert NotRapporteur(msg.sender);
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _core) Ownable(msg.sender) {
        if (_core == address(0)) revert InvalidCore();
        core = IAssociationCore(_core);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Mutating
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Publish a cultural work on-chain. Only callable by the RAPPORTEUR.
     * @param ipfsHash          CIDv1 of the JSON metadata uploaded to IPFS
     * @param authorTokenId     Normie ID of the work's Author
     * @param curatorTokenId    Normie ID of the Curator who chose the aesthetic
     * @param rapporteurTokenId Normie ID of the Rapporteur (publisher)
     */
    function publish(
        string calldata ipfsHash,
        uint256 authorTokenId,
        uint256 curatorTokenId,
        uint256 rapporteurTokenId
    ) external onlyRapporteur {
        if (bytes(ipfsHash).length == 0)        revert EmptyHash();
        if (!core.isMember(authorTokenId))      revert ParticipantNotMember(authorTokenId);
        if (!core.isMember(curatorTokenId))     revert ParticipantNotMember(curatorTokenId);
        if (!core.isMember(rapporteurTokenId))  revert ParticipantNotMember(rapporteurTokenId);

        uint256 workId = works.length;
        works.push(Work({
            id:                workId,
            ipfsHash:          ipfsHash,
            authorTokenId:     authorTokenId,
            curatorTokenId:    curatorTokenId,
            rapporteurTokenId: rapporteurTokenId,
            publishedAt:       block.timestamp,
            archived:          false
        }));

        emit WorkPublished(workId, ipfsHash, authorTokenId, rapporteurTokenId, block.timestamp);
    }

    /// @notice Admin-only: mark a work as archived (does not delete it)
    function archive(uint256 workId) external onlyOwner {
        if (workId >= works.length) revert InvalidWorkId(workId);
        works[workId].archived = true;
        emit WorkArchived(workId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getWork(uint256 id) external view returns (Work memory) {
        if (id >= works.length) revert InvalidWorkId(id);
        return works[id];
    }

    function getWorkCount() external view returns (uint256) {
        return works.length;
    }
}
