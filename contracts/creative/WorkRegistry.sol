// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAssociationCore.sol";
import "../interfaces/IWorkRegistry.sol";
import "../lib/Roles.sol";

/**
 * @title WorkRegistry v2
 * @notice On-chain registry of ANA's published cultural works.
 *
 *  Storage: the full HTML/JS/CSS source is encoded as a base64 data URI and stored
 *  directly in `content`. No IPFS. The chain is the archive.
 *
 *  Automatic scheduling: a CreationSchedule can trigger permissionless sessions
 *  at a fixed period. Anyone calls initiateWorkSession() when time comes;
 *  the off-chain LLM pipeline listens for WorkSessionInitiated and runs the
 *  discussion. The elected Rapporteur then calls publish().
 *
 *  Access control:
 *   - publish()             : only the wallet holding the RAPPORTEUR role
 *   - archive()             : only owner (admin)
 *   - setSchedule()         : only owner
 *   - initiateWorkSession() : owner at any time, anyone when schedule is active + due
 */
contract WorkRegistry is IWorkRegistry, Ownable {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct Work {
        uint256 id;
        string  content;            // data:text/html;base64,<b64> — full source onchain
        uint256 authorTokenId;      // Normie holding AUTHOR role
        uint256 curatorTokenId;     // Normie holding CURATOR role
        uint256 rapporteurTokenId;  // Normie holding RAPPORTEUR role (publisher)
        uint256 publishedAt;        // block.timestamp
        bool    archived;
    }

    struct CreationSchedule {
        uint256 nextCreationAt;   // unix timestamp — earliest allowed initiation
        uint256 periodSeconds;    // 0 = manual only, >0 = recurring
        bool    active;           // false = owner-manual only, no permissionless trigger
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IAssociationCore public immutable core;
    Work[]           public works;
    CreationSchedule public schedule;
    uint256          public sessionCount;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event WorkPublished(
        uint256 indexed workId,
        string  content,
        uint256 indexed authorTokenId,
        uint256 indexed rapporteurTokenId,
        uint256 timestamp
    );
    event WorkArchived(uint256 indexed workId);

    // Emitted when a creation session is initiated — the LLM pipeline listens for this.
    event WorkSessionInitiated(
        uint256 indexed sessionId,
        uint256 initiatedAt,
        address indexed initiatedBy
    );
    event ScheduleSet(uint256 nextCreationAt, uint256 periodSeconds, bool active);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error EmptyContent();
    error NotRapporteur(address caller);
    error InvalidWorkId(uint256 id);
    error ParticipantNotMember(uint256 tokenId);
    error InvalidCore();
    error TooEarly(uint256 nextAt, uint256 current);
    error ScheduleNotActive();

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

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
    // Core actions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Publish a cultural work on-chain. Only callable by the RAPPORTEUR.
     * @param content           data URI: data:text/html;base64,<base64(html)>
     * @param authorTokenId     Normie ID of the work's Author
     * @param curatorTokenId    Normie ID of the Curator
     * @param rapporteurTokenId Normie ID of the Rapporteur (publisher)
     */
    function publish(
        string calldata content,
        uint256 authorTokenId,
        uint256 curatorTokenId,
        uint256 rapporteurTokenId
    ) external onlyRapporteur {
        if (bytes(content).length == 0)         revert EmptyContent();
        if (!core.isMember(authorTokenId))      revert ParticipantNotMember(authorTokenId);
        if (!core.isMember(curatorTokenId))     revert ParticipantNotMember(curatorTokenId);
        if (!core.isMember(rapporteurTokenId))  revert ParticipantNotMember(rapporteurTokenId);

        uint256 workId = works.length;
        works.push(Work({
            id:                workId,
            content:           content,
            authorTokenId:     authorTokenId,
            curatorTokenId:    curatorTokenId,
            rapporteurTokenId: rapporteurTokenId,
            publishedAt:       block.timestamp,
            archived:          false
        }));

        // Auto-advance the schedule after each publication
        if (schedule.active && schedule.periodSeconds > 0) {
            schedule.nextCreationAt = block.timestamp + schedule.periodSeconds;
            emit ScheduleSet(schedule.nextCreationAt, schedule.periodSeconds, true);
        }

        emit WorkPublished(workId, content, authorTokenId, rapporteurTokenId, block.timestamp);
    }

    /**
     * @notice Initiate a new creation session.
     *
     *  - Owner: can call at any time (admin override / manual trigger).
     *  - Anyone: can call when schedule.active == true and block.timestamp >= nextCreationAt.
     *
     *  Emits WorkSessionInitiated. The off-chain LLM pipeline listens for this event,
     *  runs the inter-Normie discussion, and the Rapporteur calls publish() with the result.
     */
    function initiateWorkSession() external {
        bool isOwner = msg.sender == owner();
        if (!isOwner) {
            if (!schedule.active) revert ScheduleNotActive();
            if (block.timestamp < schedule.nextCreationAt)
                revert TooEarly(schedule.nextCreationAt, block.timestamp);
        }

        sessionCount++;
        emit WorkSessionInitiated(sessionCount, block.timestamp, msg.sender);
    }

    /// @notice Admin-only: mark a work as archived (does not delete it)
    function archive(uint256 workId) external onlyOwner {
        if (workId >= works.length) revert InvalidWorkId(workId);
        works[workId].archived = true;
        emit WorkArchived(workId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Schedule configuration (owner only)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Configure the automatic creation schedule.
     * @param nextCreationAt  Unix timestamp for the next allowed initiation (0 = now)
     * @param periodSeconds   Interval between creations (e.g. 30d = 2592000). 0 = manual only.
     * @param active          true = permissionless trigger enabled when due
     */
    function setSchedule(
        uint256 nextCreationAt,
        uint256 periodSeconds,
        bool active
    ) external onlyOwner {
        schedule = CreationSchedule({
            nextCreationAt: nextCreationAt == 0 ? block.timestamp : nextCreationAt,
            periodSeconds:  periodSeconds,
            active:         active
        });
        emit ScheduleSet(schedule.nextCreationAt, periodSeconds, active);
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

    function getSchedule() external view returns (CreationSchedule memory) {
        return schedule;
    }
}
