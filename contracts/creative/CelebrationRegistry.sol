// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "../interfaces/IANAEditions.sol";

/**
 * @title CelebrationRegistry
 * @notice On-chain ledger of Normies life-events the ANA chooses to honor with a
 *         collectively-created work, plus a sponsored free claim for the wallet
 *         tied to that event. Touches no existing contract — WorkRegistry,
 *         ANACollectionFactory and ANAEditions are used exactly as they are today.
 *
 * Lore: a Normie's on-chain life has several rites of passage on Ethereum mainnet —
 *   BURN              — sacrificed for Canvas action points (death)
 *   CANVAS_TRANSFORM   — reshaped through the Canvas (transformation)
 *   ZOMBIE_CONVERSION  — converted into a Zombie (rebirth)
 *   LEGENDARY_CANVAS   — curated onto the Legendary Canvas (immortalized)
 *   AGENT_AWAKENING    — registered as an ERC-8004 autonomous agent (awakening)
 * ANA can choose to commemorate any of these with a work. This registry just
 * records which event is being honored, by whom, and whether that wallet has
 * claimed its free edition — never the underlying api.normies.art data itself.
 *
 * Sponsorship model: this contract holds a small ETH pool (funded by the relayer /
 * association treasury) used to pay ANAEditions.buyAndMint() on behalf of the
 * eligible wallet, then forwards the freshly minted token to them. The eligible
 * wallet pays nothing and signs nothing but the claim() call itself.
 */
contract CelebrationRegistry is Ownable, ReentrancyGuard, ERC721Holder {

    // ─── Types ────────────────────────────────────────────────────────────────

    enum CelebrationType {
        BURN,               // 0 — a Normie was burned for Canvas action points
        CANVAS_TRANSFORM,   // 1 — a Normie was significantly reshaped via the Canvas
        ZOMBIE_CONVERSION,  // 2 — a Normie was converted into a Zombie
        LEGENDARY_CANVAS,   // 3 — a Normie was curated onto the Legendary Canvas
        AGENT_AWAKENING     // 4 — a Normie was registered as an ERC-8004 agent
    }

    struct Celebration {
        CelebrationType eventType;
        uint256 normieTokenId;     // honored Normie's token ID (Ethereum mainnet collection)
        address eligibleRecipient; // wallet tied to the event — sponsored claim target
        bytes32 sourceRef;         // keccak256(api.normies.art reference: tx hash / commitId) — provenance, not a data copy
        uint256 workId;            // WorkRegistry workId once published (0 = not yet linked)
        address editionsAddr;      // ANAEditions deployed for that work (address(0) = not yet linked)
        bool    claimed;
        uint256 registeredAt;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(uint256 => Celebration) public celebrations;
    uint256 public celebrationCount;

    // One celebration per (eventType, normieTokenId) — prevents honoring the same
    // event twice. Keyed by keccak256(abi.encode(eventType, normieTokenId)).
    mapping(bytes32 => bool) public eventRegistered;

    mapping(address => bool) public authorized; // relayer(s) allowed to register/link

    // ─── Events ──────────────────────────────────────────────────────────────

    event CelebrationRegistered(
        uint256 indexed celebrationId,
        CelebrationType eventType,
        uint256 indexed normieTokenId,
        address indexed eligibleRecipient,
        bytes32 sourceRef
    );
    event CelebrationLinked(uint256 indexed celebrationId, uint256 indexed workId, address indexed editionsAddr);
    event CelebrationClaimed(uint256 indexed celebrationId, address indexed recipient, address indexed editionsAddr, uint256 tokenId);
    event SponsorshipFunded(address indexed from, uint256 amount);
    event SponsorshipWithdrawn(address indexed to, uint256 amount);
    event AuthorizationUpdated(address indexed addr, bool status);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotAuthorized();
    error ZeroAddress();
    error AlreadyRegistered();
    error UnknownCelebration();
    error AlreadyLinked();
    error NotLinkedYet();
    error AlreadyClaimed();
    error NotEligible();
    error InsufficientSponsorshipFunds(uint256 required, uint256 available);
    error EditionsNotInitialized();
    error EditionsSoldOut();

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param initialOwner Owner address (deployer / multisig)
     * @param relayerAddr  Relayer address — authorized immediately, same role as
     *                     in ANACollectionFactory
     */
    constructor(address initialOwner, address relayerAddr) Ownable(initialOwner) {
        if (relayerAddr == address(0)) revert ZeroAddress();
        authorized[relayerAddr] = true;
        emit AuthorizationUpdated(relayerAddr, true);
    }

    // ─── Registration (relayer only) ──────────────────────────────────────────

    /**
     * @notice Record that ANA is honoring a specific on-chain Normies event.
     *         Called once a Normie proposes the celebration — before any vote
     *         or creation happens. `sourceRef` is a hash of the api.normies.art
     *         reference (e.g. keccak256(txHash)) kept only as tamper-evident
     *         provenance, never a copy of the underlying data.
     */
    function registerCelebration(
        CelebrationType eventType,
        uint256 normieTokenId,
        address eligibleRecipient,
        bytes32 sourceRef
    ) external returns (uint256 celebrationId) {
        if (!authorized[msg.sender]) revert NotAuthorized();
        if (eligibleRecipient == address(0)) revert ZeroAddress();

        bytes32 key = keccak256(abi.encode(eventType, normieTokenId));
        if (eventRegistered[key]) revert AlreadyRegistered();
        eventRegistered[key] = true;

        celebrationId = celebrationCount++;
        celebrations[celebrationId] = Celebration({
            eventType:         eventType,
            normieTokenId:     normieTokenId,
            eligibleRecipient: eligibleRecipient,
            sourceRef:         sourceRef,
            workId:            0,
            editionsAddr:      address(0),
            claimed:           false,
            registeredAt:      block.timestamp
        });

        emit CelebrationRegistered(celebrationId, eventType, normieTokenId, eligibleRecipient, sourceRef);
    }

    /**
     * @notice Wire a registered celebration to the work published in its honor,
     *         once WorkRegistry.publish() + ANACollectionFactory.createCollection()
     *         have both run through the ordinary (unmodified) pipeline.
     */
    function linkWork(uint256 celebrationId, uint256 workId, address editionsAddr) external {
        if (!authorized[msg.sender]) revert NotAuthorized();
        Celebration storage c = celebrations[celebrationId];
        if (c.eligibleRecipient == address(0)) revert UnknownCelebration();
        if (c.editionsAddr != address(0)) revert AlreadyLinked();
        if (editionsAddr == address(0)) revert ZeroAddress();

        c.workId       = workId;
        c.editionsAddr = editionsAddr;

        emit CelebrationLinked(celebrationId, workId, editionsAddr);
    }

    // ─── Sponsored claim (public) ──────────────────────────────────────────────

    /**
     * @notice The wallet tied to the honored event claims its free edition.
     *         Pays nothing: this contract spends its own sponsorship pool to
     *         call the unmodified ANAEditions.buyAndMint(), then forwards the
     *         freshly minted token to the caller.
     */
    function claim(uint256 celebrationId) external nonReentrant {
        Celebration storage c = celebrations[celebrationId];
        if (c.eligibleRecipient == address(0)) revert UnknownCelebration();
        if (c.editionsAddr == address(0)) revert NotLinkedYet();
        if (msg.sender != c.eligibleRecipient) revert NotEligible();
        if (c.claimed) revert AlreadyClaimed();

        IANAEditions editions = IANAEditions(c.editionsAddr);
        if (!editions.initialized()) revert EditionsNotInitialized();
        if (editions.totalMinted() >= editions.maxSupply()) revert EditionsSoldOut();

        uint256 price = editions.priceWei();
        if (address(this).balance < price) revert InsufficientSponsorshipFunds(price, address(this).balance);

        c.claimed = true; // effects before interaction

        editions.buyAndMint{value: price}();
        uint256 tokenId = editions.totalMinted() - 1; // buyAndMint() assigns sequentially, then increments

        IERC721(c.editionsAddr).safeTransferFrom(address(this), msg.sender, tokenId);

        emit CelebrationClaimed(celebrationId, msg.sender, c.editionsAddr, tokenId);
    }

    // ─── Sponsorship pool ──────────────────────────────────────────────────────

    receive() external payable {
        emit SponsorshipFunded(msg.sender, msg.value);
    }

    function fundSponsorship() external payable {
        emit SponsorshipFunded(msg.sender, msg.value);
    }

    function withdrawSponsorship(uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit SponsorshipWithdrawn(to, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getCelebration(uint256 celebrationId) external view returns (Celebration memory) {
        return celebrations[celebrationId];
    }

    function isClaimable(uint256 celebrationId) external view returns (bool) {
        Celebration storage c = celebrations[celebrationId];
        if (c.eligibleRecipient == address(0) || c.editionsAddr == address(0) || c.claimed) return false;
        IANAEditions editions = IANAEditions(c.editionsAddr);
        if (!editions.initialized() || editions.totalMinted() >= editions.maxSupply()) return false;
        return address(this).balance >= editions.priceWei();
    }

    function sponsorshipBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function isEventRegistered(CelebrationType eventType, uint256 normieTokenId) external view returns (bool) {
        return eventRegistered[keccak256(abi.encode(eventType, normieTokenId))];
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setAuthorized(address addr, bool status) external onlyOwner {
        authorized[addr] = status;
        emit AuthorizationUpdated(addr, status);
    }
}
