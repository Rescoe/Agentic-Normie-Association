// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAssociationCore.sol";
import "../lib/Roles.sol";

/**
 * @title ConstituentAssembly
 * @notice Governance module for the founding phase of ANA.
 *
 *  Purpose: registered Normie members vote to elect institutional roles.
 *  Once the session is closed, winners are written to AssociationCore via grantRole().
 *
 *  Invariants:
 *   - One active session at a time
 *   - 1 Normie = 1 vote per role (no delegation)
 *   - Only the registered owner of a Normie can vote with it (snapshot at inscription)
 *   - Both voter and candidate must be registered members
 *   - Role resolution is atomic (all roles resolved at closeSession)
 *   - Tie-breaking: lowest tokenId wins (deterministic, predictable, gas-cheap)
 *
 * @dev This is a peripheral module. It can be revoked from Core and replaced
 *      (e.g. for a post-constituent GovernanceAssembly) without touching AssociationCore.
 */
contract ConstituentAssembly is Ownable {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct Session {
        uint256 id;
        uint256 openedAt;
        uint256 closedAt;
        uint256 deadline;
        bool    active;
        bool    resolved;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IAssociationCore public immutable core;

    Session   public currentSession;
    uint256   public sessionCount;
    bytes32[] public electableRoles;

    // voterTokenId => role => has voted
    mapping(uint256 => mapping(bytes32 => bool))    public hasVoted;

    // role => candidateTokenId => vote count
    mapping(bytes32 => mapping(uint256 => uint256)) public voteCounts;

    // role => ordered list of candidates that received ≥1 vote
    mapping(bytes32 => uint256[])                   public candidates;

    // role => candidateTokenId => already in candidates[] (dedup guard)
    mapping(bytes32 => mapping(uint256 => bool))    private _candidateAdded;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event SessionOpened(uint256 indexed sessionId, uint256 timestamp);
    event VoteCast(
        uint256 indexed sessionId,
        uint256 indexed voterTokenId,
        bytes32 indexed role,
        uint256 candidateTokenId
    );
    event SessionClosed(uint256 indexed sessionId, uint256 timestamp);
    event RoleResolved(
        uint256 indexed sessionId,
        bytes32 indexed role,
        uint256 winnerTokenId,
        uint256 voteCount
    );
    event RolesResolved(uint256 indexed sessionId);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error SessionAlreadyActive();
    error NoActiveSession();
    error SessionNotExpired();
    error VoterNotMember(uint256 tokenId);
    error CandidateNotMember(uint256 tokenId);
    error CallerNotVoterOwner(address caller, address expected);
    error NotRelayer(address caller);
    error AlreadyVotedForRole(uint256 voterTokenId, bytes32 role);
    error RoleNotElectable(bytes32 role);
    error InvalidCore();
    error SessionActiveCannotChangeRoles();
    error UnauthorizedCaller(address caller);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param _core Address of AssociationCore (must have authorized this contract)
     * @dev  All 6 ANA roles are hardcoded from Roles.sol — no constructor args needed.
     */
    constructor(address _core) Ownable(msg.sender) {
        if (_core == address(0)) revert InvalidCore();
        core = IAssociationCore(_core);
        electableRoles = Roles.allRoles();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @dev Allows both the owner (governance authority) and the relayer (cron
     *      automation key) to open election sessions.  The owner retains full
     *      Ownable privileges; the relayer is a limited hot-wallet that can
     *      only do what individual functions explicitly grant it.
     */
    modifier onlyOwnerOrRelayer() {
        if (msg.sender != owner() && msg.sender != core.relayerAddress())
            revert UnauthorizedCaller(msg.sender);
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Configuration (owner only, before session opens)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Set or replace the list of electable roles.
     * @dev Can be called after deployment to configure roles without redeploying.
     *      Cannot be called while a session is active.
     */
    function setElectableRoles(bytes32[] memory roles) external onlyOwner {
        if (currentSession.active) revert SessionActiveCannotChangeRoles();
        electableRoles = roles;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session management (admin / owner)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Open the constituent assembly session with a duration.
     * @param durationSeconds  How long (in seconds) the session stays open.
     *                         After this delay anyone can call triggerClose().
     */
    function openSession(uint256 durationSeconds) external onlyOwnerOrRelayer {
        if (currentSession.active) revert SessionAlreadyActive();

        sessionCount++;
        currentSession = Session({
            id:       sessionCount,
            openedAt: block.timestamp,
            closedAt: 0,
            deadline: block.timestamp + durationSeconds,
            active:   true,
            resolved: false
        });

        emit SessionOpened(sessionCount, block.timestamp);
    }

    /**
     * @notice Close the session manually (owner) before deadline.
     */
    function closeSession() external onlyOwner {
        if (!currentSession.active) revert NoActiveSession();
        _resolveAndClose();
    }

    /**
     * @notice Permissionless close — anyone can trigger once deadline is passed.
     */
    function triggerClose() external {
        if (!currentSession.active) revert NoActiveSession();
        if (block.timestamp < currentSession.deadline) revert SessionNotExpired();
        _resolveAndClose();
    }

    function _resolveAndClose() internal {
        currentSession.active   = false;
        currentSession.closedAt = block.timestamp;
        currentSession.resolved = true;

        uint256 sid = currentSession.id;

        for (uint256 i = 0; i < electableRoles.length; i++) {
            bytes32 role = electableRoles[i];
            (uint256 winner, uint256 count) = _getLeader(role);
            if (count > 0) {
                core.grantRole(role, winner);
                emit RoleResolved(sid, role, winner, count);
            }
        }

        emit SessionClosed(sid, block.timestamp);
        emit RolesResolved(sid);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Voting
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Cast a vote directly (member's wallet pays gas).
     */
    function castVote(
        uint256 voterTokenId,
        bytes32 role,
        uint256 candidateTokenId
    ) external {
        if (!currentSession.active) revert NoActiveSession();
        if (!core.isMember(voterTokenId)) revert VoterNotMember(voterTokenId);
        if (!core.isMember(candidateTokenId)) revert CandidateNotMember(candidateTokenId);
        if (msg.sender != core.getMemberOwner(voterTokenId))
            revert CallerNotVoterOwner(msg.sender, core.getMemberOwner(voterTokenId));
        _recordVote(voterTokenId, role, candidateTokenId);
    }

    /**
     * @notice Cast a vote on behalf of a member — relayer pays gas.
     * @dev The relayer is trusted by Core (same key that signed attestations).
     *      No additional signature needed: the LLM agent decided the vote,
     *      the relayer submits it. Only one vote per member per role enforced.
     */
    function castVoteAsRelayer(
        uint256 voterTokenId,
        bytes32 role,
        uint256 candidateTokenId
    ) external {
        if (msg.sender != core.relayerAddress()) revert NotRelayer(msg.sender);
        if (!currentSession.active) revert NoActiveSession();
        if (!core.isMember(voterTokenId)) revert VoterNotMember(voterTokenId);
        if (!core.isMember(candidateTokenId)) revert CandidateNotMember(candidateTokenId);
        _recordVote(voterTokenId, role, candidateTokenId);
    }

    function _recordVote(
        uint256 voterTokenId,
        bytes32 role,
        uint256 candidateTokenId
    ) internal {
        if (hasVoted[voterTokenId][role]) revert AlreadyVotedForRole(voterTokenId, role);
        if (!_isElectable(role)) revert RoleNotElectable(role);

        hasVoted[voterTokenId][role] = true;

        if (!_candidateAdded[role][candidateTokenId]) {
            candidates[role].push(candidateTokenId);
            _candidateAdded[role][candidateTokenId] = true;
        }
        voteCounts[role][candidateTokenId]++;

        emit VoteCast(currentSession.id, voterTokenId, role, candidateTokenId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getVoteCount(bytes32 role, uint256 candidateTokenId)
        external view returns (uint256)
    {
        return voteCounts[role][candidateTokenId];
    }

    function getLeader(bytes32 role)
        external view returns (uint256 tokenId, uint256 count)
    {
        return _getLeader(role);
    }

    function getCandidates(bytes32 role) external view returns (uint256[] memory) {
        return candidates[role];
    }

    function getElectableRoles() external view returns (bytes32[] memory) {
        return electableRoles;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _isElectable(bytes32 role) internal view returns (bool) {
        for (uint256 i = 0; i < electableRoles.length; i++) {
            if (electableRoles[i] == role) return true;
        }
        return false;
    }

    /**
     * @dev Find the leading candidate for a role.
     *      Returns (0, 0) if no votes have been cast.
     *      Tie-breaking: lowest tokenId wins — deterministic and predictable.
     */
    function _getLeader(bytes32 role)
        internal view returns (uint256 winnerTokenId, uint256 maxVotes)
    {
        uint256[] storage cands = candidates[role];
        bool found = false;

        for (uint256 i = 0; i < cands.length; i++) {
            uint256 count = voteCounts[role][cands[i]];
            if (!found || count > maxVotes) {
                maxVotes      = count;
                winnerTokenId = cands[i];
                found         = true;
            } else if (count == maxVotes && cands[i] < winnerTokenId) {
                // Tie-breaking: lower tokenId wins
                winnerTokenId = cands[i];
            }
        }
    }
}
