// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GovernanceCalendar
 * @notice Central schedule for all ANA governance events.
 *
 *  Stores scheduled events (inscription, elections, general assemblies,
 *  work sessions) with optional recurrence.
 *
 *  Trigger model:
 *   - Owner can schedule/cancel events at any time.
 *   - Anyone can trigger a due event (permissionless) — this emits EventTriggered.
 *   - Off-chain keepers (relayer, LLM agent) listen for EventTriggered to act.
 *   - For recurring events, triggerEvent() automatically schedules the next occurrence.
 *
 *  Founding schedule (initialized once via initializeFoundingSchedule()):
 *   - 2026-06-15: Inscription opens
 *   - 2026-07-15: Inscription closes / Election session opens (48h window)
 *   - 2026-07-17: Election closes — results on-chain
 *   - 2026-08-01: First general assembly (monthly, 24h)
 *   - 2026-10-01: First election assembly (quarterly, 48h)
 *   - 2026-08-01: First work session (monthly, recurring)
 */
contract GovernanceCalendar is Ownable {

    // ─────────────────────────────────────────────────────────────────────────
    // Event type constants
    // ─────────────────────────────────────────────────────────────────────────

    bytes32 public constant INSCRIPTION_OPEN  = keccak256("INSCRIPTION_OPEN");
    bytes32 public constant INSCRIPTION_CLOSE = keccak256("INSCRIPTION_CLOSE");
    bytes32 public constant ELECTION          = keccak256("ELECTION");
    bytes32 public constant GENERAL_ASSEMBLY  = keccak256("GENERAL_ASSEMBLY");
    bytes32 public constant WORK_SESSION      = keccak256("WORK_SESSION");
    bytes32 public constant BURN_CREATION     = keccak256("BURN_CREATION");

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct CalendarEvent {
        uint256 id;
        bytes32 eventType;
        string  description;
        uint256 scheduledAt;    // unix timestamp — when this event starts
        uint256 durationSeconds;// how long the event window lasts (0 = instantaneous)
        bool    executed;       // has it been triggered at least once
        bool    recurring;
        uint256 periodSeconds;  // recurrence interval (0 if not recurring)
        bool    cancelled;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    CalendarEvent[] public events;
    bool            public foundingScheduleInitialized;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event EventScheduled(
        uint256 indexed eventId,
        bytes32 indexed eventType,
        uint256 scheduledAt,
        bool    recurring,
        uint256 periodSeconds
    );
    event EventTriggered(
        uint256 indexed eventId,
        bytes32 indexed eventType,
        address indexed triggeredBy,
        uint256 timestamp
    );
    event EventCancelled(uint256 indexed eventId);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error EventNotFound(uint256 id);
    error EventAlreadyCancelled(uint256 id);
    error EventNotDueYet(uint256 scheduledAt, uint256 current);
    error FoundingScheduleAlreadyInitialized();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Founding schedule — call once after deployment
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Initialize ANA's founding governance schedule.
     * @dev Hardcoded dates for the 2026 launch:
     *   - 2026-06-15 00:00 UTC = 1781913600
     *   - 2026-07-15 00:00 UTC = 1784505600  (inscription closes / election opens)
     *   - 2026-07-17 00:00 UTC = 1784678400  (election closes, 48h)
     *   - 2026-08-01 00:00 UTC = 1785528000  (first general assembly + work session)
     *   - 2026-10-01 00:00 UTC = 1790985600  (first quarterly election)
     */
    function initializeFoundingSchedule() external onlyOwner {
        if (foundingScheduleInitialized) revert FoundingScheduleAlreadyInitialized();
        foundingScheduleInitialized = true;

        // ── Phase 1: Inscription ──────────────────────────────────────────────
        _schedule(INSCRIPTION_OPEN,  "Ouverture des inscriptions Normies",
            1781913600, 30 days, false, 0);

        _schedule(INSCRIPTION_CLOSE, unicode"Clôture des inscriptions",
            1784505600, 0,      false, 0);

        _schedule(ELECTION, unicode"Assemblée constituante",
            1784505600, 48 hours, false, 0);

        _schedule(GENERAL_ASSEMBLY, unicode"Assemblée générale mensuelle",
            1785528000, 24 hours, true, 30 days);

        _schedule(WORK_SESSION, unicode"Session de création collective",
            1785528000, 7 days, true, 30 days);

        _schedule(ELECTION, unicode"Assemblée d'élection trimestrielle",
            1790985600, 48 hours, true, 90 days);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Schedule management (owner only)
    // ─────────────────────────────────────────────────────────────────────────

    function scheduleEvent(
        bytes32 eventType,
        string calldata description,
        uint256 scheduledAt,
        uint256 durationSeconds,
        bool    recurring,
        uint256 periodSeconds
    ) external onlyOwner returns (uint256) {
        return _schedule(eventType, description, scheduledAt, durationSeconds, recurring, periodSeconds);
    }

    function cancelEvent(uint256 eventId) external onlyOwner {
        if (eventId >= events.length)      revert EventNotFound(eventId);
        if (events[eventId].cancelled)     revert EventAlreadyCancelled(eventId);
        events[eventId].cancelled = true;
        emit EventCancelled(eventId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Trigger (permissionless when due, or owner anytime)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Trigger a scheduled event.
     * @dev Anyone can call when block.timestamp >= scheduledAt.
     *      Owner can call at any time (override/test mode).
     *      For recurring events, automatically schedules the next occurrence.
     */
    function triggerEvent(uint256 eventId) external {
        if (eventId >= events.length) revert EventNotFound(eventId);
        CalendarEvent storage ev = events[eventId];
        if (ev.cancelled) revert EventAlreadyCancelled(eventId);

        bool isOwner = msg.sender == owner();
        if (!isOwner && block.timestamp < ev.scheduledAt) {
            revert EventNotDueYet(ev.scheduledAt, block.timestamp);
        }

        ev.executed = true;
        emit EventTriggered(eventId, ev.eventType, msg.sender, block.timestamp);

        // Auto-schedule next occurrence for recurring events
        if (ev.recurring && ev.periodSeconds > 0) {
            uint256 nextAt = ev.scheduledAt + ev.periodSeconds;
            // If we're far behind, skip to next future occurrence
            while (nextAt < block.timestamp) nextAt += ev.periodSeconds;
            _schedule(ev.eventType, ev.description, nextAt, ev.durationSeconds, true, ev.periodSeconds);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getEvent(uint256 id) external view returns (CalendarEvent memory) {
        if (id >= events.length) revert EventNotFound(id);
        return events[id];
    }

    function getEventCount() external view returns (uint256) {
        return events.length;
    }

    /** Returns upcoming events (not executed, not cancelled, scheduled in the future). */
    function getUpcomingEvents() external view returns (CalendarEvent[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < events.length; i++) {
            if (!events[i].executed && !events[i].cancelled) count++;
        }
        CalendarEvent[] memory result = new CalendarEvent[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < events.length; i++) {
            if (!events[i].executed && !events[i].cancelled) result[idx++] = events[i];
        }
        return result;
    }

    /** Returns events due now (triggerable by anyone). */
    function getDueEvents() external view returns (CalendarEvent[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < events.length; i++) {
            CalendarEvent storage ev = events[i];
            if (!ev.executed && !ev.cancelled && block.timestamp >= ev.scheduledAt) count++;
        }
        CalendarEvent[] memory result = new CalendarEvent[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < events.length; i++) {
            CalendarEvent storage ev = events[i];
            if (!ev.executed && !ev.cancelled && block.timestamp >= ev.scheduledAt) result[idx++] = ev;
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _schedule(
        bytes32 eventType,
        string memory description,
        uint256 scheduledAt,
        uint256 durationSeconds,
        bool    recurring,
        uint256 periodSeconds
    ) internal returns (uint256) {
        uint256 id = events.length;
        events.push(CalendarEvent({
            id:              id,
            eventType:       eventType,
            description:     description,
            scheduledAt:     scheduledAt,
            durationSeconds: durationSeconds,
            executed:        false,
            recurring:       recurring,
            periodSeconds:   periodSeconds,
            cancelled:       false
        }));
        emit EventScheduled(id, eventType, scheduledAt, recurring, periodSeconds);
        return id;
    }
}
