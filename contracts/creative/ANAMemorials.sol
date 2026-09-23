// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../interfaces/IAssociationCore.sol";

/**
 * @title ANAMemorials
 * @notice A single shared ERC-721 collection hosting every burn-memorial ANA ever
 *         creates — replaces the old one-ANAEditions-per-memorial pattern, which
 *         cost a full contract deployment (~3.15M gas, confirmed on Basescan) for
 *         every single burn. A memorial here is a "series": one artwork (created by
 *         an ANA member's LLM persona, off-chain) honoring one or several burned
 *         Normies, with up to 3 independent mint pools:
 *
 *   1. reservedClaims — one free edition per honored burnedTokenId, for that
 *      Normie's last owner. Structurally separate from the pools below: it can
 *      NEVER be exhausted by public/requester sales, because it isn't drawn from
 *      the same counters. This is what makes "the last owner is always guaranteed
 *      a copy" true by construction, not just by intent.
 *   2. requesterSupply — reserved for whoever paid to request this specific
 *      memorial (0 for a batch/auto-detected memorial, which has no single payer).
 *   3. publicSupply — open to anyone, fixed count or time-boxed (openEnded).
 *
 * Unlike ANAEditions, minting here is ALWAYS paid for (gas + price) by the caller
 * directly — the relayer only ever pays for registerMemorial()/addReservedClaims(),
 * which happen once per memorial (or once per batch period), not once per claim.
 * That shift is the other half of the cost reduction, alongside dropping the
 * per-memorial contract deployment.
 *
 * Revenue on every paid mint splits 50/50 between two distinct destinations:
 * the relayer payout address (gas reimbursement + safety margin) and the
 * memorial's creator. The creator is resolved via AssociationCore.getMemberOwner();
 * only when that lookup returns address(0) does the creator half go to the
 * association vault. Keeping the relayer payout and vault separate is essential:
 * one is always paid, while the other is only the no-wallet fallback.
 *
 * Scope: burn memorials/celebrations only. ANACollectionFactory, ANAEditions and
 * CelebrationRegistry are untouched and keep working exactly as before for every
 * other ANA work and every other celebration type.
 */
contract ANAMemorials is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    // Must match memorialArt.ts's MEMORIAL_CANVAS_W/H exactly — the source
    // canvas a raw SVG <g> fragment's coordinates (pixelImage.ts's
    // pixelsToRunLengthSvg()) are expressed in, used only to map it onto
    // tokenURI()'s 800x800 image via viewBox (_buildImageDataUri). A BMP data
    // URI needs no such mapping — it carries its own dimensions internally.
    uint256 private constant ARTWORK_CANVAS_W = 360;
    uint256 private constant ARTWORK_CANVAS_H = 240;

    // ─── Reveal canvas (single-burn memorials only) ────────────────────────────
    // A 40x40, 1-bit-per-pixel restoration grid matching a Normie's own native
    // resolution (Normies are 40x40 monochrome, fully on-chain — see
    // normiesApi.ts) — centered within the larger ARTWORK_CANVAS illustration
    // and rendered live in tokenURI(), on top of it. CANVAS_SIZE*CANVAS_SIZE
    // bits, packed row-major MSB-first = CANVAS_BYTES.
    uint256 private constant CANVAS_SIZE  = 40;
    uint256 private constant CANVAS_BYTES = 200; // 1600 bits / 8
    uint256 private constant CANVAS_CELL_PX = 4; // on-screen size of one grid cell, in ARTWORK_CANVAS units
    // White margin around the grid, one cell wide, separating the restored
    // portrait from the rest of the memorial artwork — never editable, since
    // it isn't part of the 40x40 bitmap at all, purely a rendering frame.
    uint256 private constant CANVAS_BORDER_PX = CANVAS_CELL_PX;
    // Safety valve for tokenURI()'s on-chain SVG rendering — see _renderCanvas.
    uint256 private constant MAX_RENDERED_RUNS = 300;

    // Every "milestone" monument honors an exact multiple of this many burns —
    // a hard on-chain constant, deliberately not owner-adjustable (no setter
    // exists). Collectors can verify the cadence directly rather than trust
    // that the team won't quietly change it. 100, not 1000: with ~1,000
    // Normies total and burn rate expected to slow well before every one is
    // gone, 1000 would have meant at most a handful of monuments ever: 100
    // yields ~30, real content instead of a rare curiosity, while staying far
    // more deliberate than a monument per individual burn.
    uint256 public constant MILESTONE_STEP = 100;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct MemorialSeries {
        string  title;
        // Either a "data:image/bmp;base64,..." data URI (embedded via <image
        // href>) or a raw SVG <g> fragment of <rect>s (spliced directly into
        // a nested <svg>) — tokenURI() tells them apart by the "data:" prefix.
        // Whichever encoding pixelImage.ts's encodeArtworkContent() picked as
        // smaller for this composition; both are lossless, pixel-identical
        // renderings of the same artwork. Relayer-only input (onlyAuthorized),
        // same trust level as title/pricing — never sanitized as if untrusted.
        string  artworkContent;
        // The creator's own artist statement — used verbatim as tokenURI()'s
        // JSON "description" when non-empty. Before this field existed,
        // tokenURI() only ever produced a generic templated description
        // ("ANA burn memorial created by X, honoring N burned Normie(s)."),
        // and the real cartel text (already written by the LLM persona for
        // every memorial) never made it past this contract's own workStore —
        // OpenSea and every other on-chain consumer only ever saw the
        // generic line, never the actual piece.
        string  cartel;
        string  creatorName;      // ERC-8004 agent display name, fixed at registration
        // Free-form classification ("batch" | "requested" | "milestone", set
        // by the relayer at registration) and the TRUE count of Normies this
        // piece honors. honoredBurnCount is intentionally separate from
        // burnedTokenIdsOf[]/reservedRecipient — a "milestone" monument
        // deliberately registers zero individual reserved claims (would mean
        // thousands of addReservedClaims entries for one piece) but still
        // honors a real, large count that belongs in this piece's metadata.
        string  kind;
        uint256 honoredBurnCount;
        uint256 workId;           // WorkRegistry id honoring this memorial; 0 = not linked
        uint256 creatorProposerTokenId;
        address creatorAddr;      // creator wallet resolved once; zero means use vaultAddr
        bool    creatorUsesVault;
        uint256 priceWei;         // per-edition price, shared by the public and requester pools
        uint256 publicSupply;     // 0 for tier 1 (no public opening)
        uint256 publicMinted;
        uint256 requesterSupply;  // usually 0 (batch memorial) or 1 (a human requested it)
        uint256 requesterMinted;
        address requesterAddr;    // address(0) = no requester pool
        bool    openEnded;        // true = publicSupply is ignored, claimDeadline gates instead
        uint256 claimDeadline;    // unix timestamp; only meaningful when openEnded
        uint256 mintedInSeries;   // display counter across all three pools ("edition N")
        bool    initialized;
        // Collaborative canvas editing, SERIES-wide (every edition of this
        // memorial shares one evolving image, not one edit state per NFT) —
        // incremented by updateArtwork(). Purely informational (auditability/
        // display, "edit #N"); the contract has no opinion on what an edit
        // means. Which pixels are locked, what the target looks like, who's
        // allowed to spend PX to flip which pixel — none of that lives here.
        // A future, minimally-privileged contract (granted revealAuthorized,
        // see below) computes the next full artworkContent off-chain and
        // pushes it via updateArtwork(), the same trust model already used
        // for artworkContent at registration.
        uint256 editCount;
    }

    /// @notice registerMemorial()'s params, as a struct — avoids a long flat
    ///         parameter list (stack-depth risk) now that it's grown past 10.
    struct RegisterMemorialParams {
        string  title;
        string  artworkContent;
        string  cartel;
        string  creatorName;
        string  kind;
        uint256 honoredBurnCount;
        uint256 workId;
        uint256 creatorProposerTokenId;
        uint256 priceWei;
        uint256 publicSupply;
        uint256 requesterSupply;
        address requesterAddr;
        bool    openEnded;
        uint256 claimDurationSeconds;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    IAssociationCore public immutable core;
    address public relayerPayoutAddr; // always receives exactly 50% of paid requests/mints
    address public vaultAddr;         // creator-half fallback only when the agent has no wallet

    MemorialSeries[] public series; // memorialId = index into this array

    // memorialId => burnedTokenId => has this Normie's last owner claimed their free edition?
    mapping(uint256 => mapping(uint256 => bool)) public reservedClaimed;
    // memorialId => burnedTokenId => eligible wallet (address(0) = not a reserved claim for this pair)
    mapping(uint256 => mapping(uint256 => address)) public reservedRecipient;
    // memorialId => burnedTokenIds honored by it, for display only
    mapping(uint256 => uint256[]) public burnedTokenIdsOf;

    mapping(uint256 => uint256) public seriesOfToken; // ERC-721 tokenId => memorialId
    mapping(address => uint256) public pendingWithdrawals; // escrow fallback, see _sendOrEscrow
    mapping(address => bool)    public authorized; // relayer(s) allowed to register/add claims

    // Separate from `authorized` on purpose: this is the ONLY permission a
    // future PX-gating contract needs to be granted (via setRevealAuthorized)
    // to let holders spend PX to edit a memorial's canvas — it must never
    // imply the ability to register memorials or reserved claims. The main
    // relayer can always call updateArtwork()/editPixels() too (see
    // onlyRevealAuthorized), no separate grant needed.
    mapping(address => bool)    public revealAuthorized;

    // memorialId => the honored Normie's own 40x40 bitmap, fixed forever once
    // registerCanvas() sets it — never mutated again by anything.
    mapping(uint256 => bytes) public targetPixels;
    // memorialId => the current, editable 40x40 bitmap — mutated by editPixels().
    mapping(uint256 => bytes) public canvasPixels;
    mapping(uint256 => bool)  public hasCanvas;

    uint256 private _nextTokenId;

    // ─── Events ──────────────────────────────────────────────────────────────

    event MemorialRegistered(
        uint256 indexed memorialId,
        string title,
        uint256 indexed workId,
        uint256 indexed creatorProposerTokenId,
        string creatorName,
        address creatorAddr,
        bool creatorUsesVault
    );
    event ReservedClaimAdded(uint256 indexed memorialId, uint256 indexed burnedTokenId, address indexed recipient);
    event HonoredTokenIdsAdded(uint256 indexed memorialId, uint256 count);
    event EditionMinted(uint256 indexed memorialId, uint256 indexed tokenId, address indexed to, string pool, uint256 priceWei);
    event RevenueSplit(
        uint256 indexed memorialId,
        address relayerPayoutAddr,
        uint256 relayerAmt,
        address creatorPayoutAddr,
        uint256 creatorAmt,
        bool usedVaultFallback
    );
    event Tipped(address indexed from, uint256 amount);
    event RequestPaid(
        address indexed payer,
        uint256 indexed creatorProposerTokenId,
        address relayerPayoutAddr,
        address creatorPayoutAddr,
        uint256 amount,
        bool usedVaultFallback
    );
    event Withdrawn(address indexed to, uint256 amount);
    event AuthorizationUpdated(address indexed addr, bool status);
    event RelayerPayoutUpdated(address indexed addr);
    event VaultUpdated(address indexed addr);
    event SeriesPriceUpdated(uint256 indexed memorialId, uint256 newPriceWei);
    event RevealAuthorizationUpdated(address indexed addr, bool status);
    event ArtworkUpdated(uint256 indexed memorialId, address indexed updater, uint256 editCount);
    event CanvasRegistered(uint256 indexed memorialId);
    event CanvasEdited(uint256 indexed memorialId, address indexed editor, uint256 pixelsChanged);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotAuthorized();
    error ZeroAddress();
    error UnknownMemorial();
    error InvalidReservedArrays();
    error EmptyTokenIdList();
    error AlreadyReservedClaim();
    error NotEligible();
    error AlreadyClaimed();
    error SoldOut();
    error NotOpenEnded();
    error ClaimWindowClosed();
    error InsufficientPayment(uint256 required, uint256 sent);
    error NothingToWithdraw();
    error TokenDoesNotExist(uint256 tokenId);
    error EmptyArtwork();
    error InvalidCanvasLength();
    error CanvasAlreadyRegistered();
    error CanvasNotRegistered();
    error MismatchedEditArrays();
    error InvalidPixelIndex();
    error PixelLocked(uint256 index);
    error InvalidMilestoneCount(uint256 honoredBurnCount, uint256 step);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAuthorized() {
        if (!authorized[msg.sender]) revert NotAuthorized();
        _;
    }

    /// @dev The main relayer can always advance a reveal too — no separate
    ///      grant needed on top of its existing `authorized` status.
    modifier onlyRevealAuthorized() {
        if (!revealAuthorized[msg.sender] && !authorized[msg.sender]) revert NotAuthorized();
        _;
    }

    modifier validMemorial(uint256 memorialId) {
        if (memorialId >= series.length || !series[memorialId].initialized) revert UnknownMemorial();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address initialOwner,
        address relayerAddr,
        address coreAddr,
        address vaultAddr_
    ) ERC721("ANA Memorials", "ANAMEM") Ownable(initialOwner) {
        if (relayerAddr == address(0) || coreAddr == address(0) || vaultAddr_ == address(0)) revert ZeroAddress();
        core      = IAssociationCore(coreAddr);
        relayerPayoutAddr = relayerAddr;
        vaultAddr = vaultAddr_;
        authorized[relayerAddr] = true;
        emit AuthorizationUpdated(relayerAddr, true);
    }

    // ─── Registration (relayer-only) ──────────────────────────────────────────

    /**
     * @notice Registers a new memorial series — the artwork is already fully known
     *         at this point (created off-chain by an LLM persona, voted through ANA's
     *         moderation), so this single call replaces what used to be a contract
     *         deployment (ANACollectionFactory.createCollection) plus a separate
     *         initialize() call. Takes a struct (RegisterMemorialParams) rather
     *         than a flat parameter list, which had grown past 10 individual
     *         params. p.creatorProposerTokenId is the ANA member (Normie) whose
     *         ERC-8004 persona made the piece; p.creatorName is its display name,
     *         stored in the NFT metadata as the artist; p.kind is a free-form
     *         classification ("batch" | "requested" | "milestone") surfaced as a
     *         tokenURI() trait, same trust level as title (not validated);
     *         p.honoredBurnCount is the true count of Normies this piece honors,
     *         independent of how many (if any) get an individual reserved free
     *         claim via addReservedClaims() — see MemorialSeries.honoredBurnCount.
     */
    function registerMemorial(
        RegisterMemorialParams calldata p
    ) external onlyAuthorized returns (uint256 memorialId) {
        require(bytes(p.artworkContent).length > 0, "Empty artwork");
        if (p.requesterSupply > 0 && p.requesterAddr == address(0)) revert ZeroAddress();
        // "milestone" is the one kind this contract actually enforces, not
        // just labels — every other kind ("batch"/"requested"/anything else
        // the relayer sends) is free-form, per the notice above.
        if (
            keccak256(bytes(p.kind)) == keccak256(bytes("milestone")) &&
            (p.honoredBurnCount == 0 || p.honoredBurnCount % MILESTONE_STEP != 0)
        ) {
            revert InvalidMilestoneCount(p.honoredBurnCount, MILESTONE_STEP);
        }

        address creatorAddr = core.getMemberOwner(p.creatorProposerTokenId);
        bool creatorUsesVault = creatorAddr == address(0);

        memorialId = series.length;
        series.push(MemorialSeries({
            title:            p.title,
            artworkContent:   p.artworkContent,
            cartel:           p.cartel,
            creatorName:      p.creatorName,
            kind:             p.kind,
            honoredBurnCount: p.honoredBurnCount,
            workId:           p.workId,
            creatorProposerTokenId: p.creatorProposerTokenId,
            creatorAddr:      creatorAddr,
            creatorUsesVault: creatorUsesVault,
            priceWei:         p.priceWei,
            publicSupply:     p.openEnded ? 0 : p.publicSupply,
            publicMinted:     0,
            requesterSupply:  p.requesterSupply,
            requesterMinted:  0,
            requesterAddr:    p.requesterAddr,
            openEnded:        p.openEnded,
            claimDeadline:    p.openEnded ? block.timestamp + p.claimDurationSeconds : 0,
            mintedInSeries:   0,
            initialized:      true,
            editCount:        0
        }));

        emit MemorialRegistered(
            memorialId,
            p.title,
            p.workId,
            p.creatorProposerTokenId,
            p.creatorName,
            creatorAddr,
            creatorUsesVault
        );
    }

    /**
     * @notice Reserves a free edition for each burned Normie's last owner. Chunkable
     *         on purpose — a large batch period (many burns at once) can call this
     *         across several transactions instead of one unbounded loop, keeping
     *         every relayer transaction safely under the ~16.7M gas cap this
     *         project's public RPC (mainnet.base.org) enforces.
     */
    function addReservedClaims(
        uint256 memorialId,
        uint256[] calldata burnedTokenIds,
        address[] calldata eligibleRecipients
    ) external onlyAuthorized validMemorial(memorialId) {
        if (burnedTokenIds.length == 0 || burnedTokenIds.length != eligibleRecipients.length) revert InvalidReservedArrays();

        for (uint256 i = 0; i < burnedTokenIds.length; i++) {
            uint256 tokenId    = burnedTokenIds[i];
            address recipient  = eligibleRecipients[i];
            if (recipient == address(0)) revert ZeroAddress();
            if (reservedRecipient[memorialId][tokenId] != address(0)) revert AlreadyReservedClaim();

            reservedRecipient[memorialId][tokenId] = recipient;
            burnedTokenIdsOf[memorialId].push(tokenId);
            emit ReservedClaimAdded(memorialId, tokenId, recipient);
        }
    }

    /**
     * @notice Appends tokenIds to a memorial's honored-Normies display list
     *         (burnedTokenIdsOf / getBurnedTokenIds()) WITHOUT creating a
     *         reserved free claim for them. addReservedClaims() already
     *         populates this same list for batch/requested memorials as a
     *         side effect of reserving claims — but a "milestone" monument
     *         deliberately never calls addReservedClaims() (reserving
     *         individual claims for potentially thousands of burns defeats
     *         the point of a collective piece), which left it with an
     *         always-empty honored-Normies list. This is that missing write
     *         path. Chunkable like addReservedClaims(), for the same reason.
     *         Duplicates are allowed — this is display data, not a claim
     *         registry, so there's no AlreadyReservedClaim-style guard.
     */
    function addHonoredTokenIds(
        uint256 memorialId,
        uint256[] calldata tokenIds
    ) external onlyAuthorized validMemorial(memorialId) {
        if (tokenIds.length == 0) revert EmptyTokenIdList();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            burnedTokenIdsOf[memorialId].push(tokenIds[i]);
        }
        emit HonoredTokenIdsAdded(memorialId, tokenIds.length);
    }

    /**
     * @notice Overwrites a memorial's artworkContent wholesale — the single
     *         hook the whole collaborative-canvas mechanic is built on.
     *         tokenURI() needs no edit-specific rendering logic, because it
     *         already just renders artworkContent as-is.
     *
     *         Deliberately dumb on purpose: this contract stores pixels, it
     *         doesn't reason about them. It has no idea what "pixel-editing"
     *         means, which pixels are locked against the honored Normie's own
     *         image, who is allowed to flip which pixel, or how PX factors
     *         in — all of that is computed off-chain (same trust level as
     *         artworkContent at registerMemorial(), or the LLM-authored
     *         artwork of every other ANA work) and handed here as one final
     *         rendered string.
     *
     *         Gated by onlyRevealAuthorized, not onlyAuthorized: today only
     *         the main relayer can call this (e.g. manually during testing),
     *         but the intent is for a separate, minimally-privileged contract
     *         to be granted revealAuthorized status later — once it has
     *         verified whatever external condition (a PX balance, entirely
     *         outside this contract) authorizes an edit, it computes the new
     *         artworkContent and pushes it here. That contract can never
     *         register memorials or reserved claims; this is the only door
     *         it gets.
     */
    function updateArtwork(
        uint256 memorialId,
        string calldata newArtworkContent
    ) external onlyRevealAuthorized validMemorial(memorialId) returns (uint256 editCount) {
        if (bytes(newArtworkContent).length == 0) revert EmptyArtwork();
        MemorialSeries storage s = series[memorialId];
        s.artworkContent = newArtworkContent;
        editCount = ++s.editCount;
        emit ArtworkUpdated(memorialId, msg.sender, editCount);
    }

    /**
     * @notice Registers this memorial's 40x40 restoration canvas — the honored
     *         Normie's own bitmap as `target` (fixed forever after this call),
     *         and the starting editable state as `initialCanvas` (typically
     *         all-white, i.e. "nothing restored yet", but left to the relayer
     *         to decide). Relayer-only, callable once — re-registering would
     *         silently reset in-progress community edits, so it's blocked
     *         rather than allowed like updateArtwork()'s idempotent overwrite.
     *         Only meaningful for kind=="single" memorials in practice, but
     *         not enforced here — this contract doesn't interpret `kind`.
     */
    function registerCanvas(
        uint256 memorialId,
        bytes calldata target,
        bytes calldata initialCanvas
    ) external onlyAuthorized validMemorial(memorialId) {
        if (target.length != CANVAS_BYTES || initialCanvas.length != CANVAS_BYTES) revert InvalidCanvasLength();
        if (hasCanvas[memorialId]) revert CanvasAlreadyRegistered();
        targetPixels[memorialId] = target;
        canvasPixels[memorialId] = initialCanvas;
        hasCanvas[memorialId] = true;
        emit CanvasRegistered(memorialId);
    }

    /**
     * @notice Flips a batch of pixels on this memorial's canvas — the actual
     *         collaborative-editing mechanic, enforced on-chain rather than
     *         trusted from an off-chain computation like updateArtwork() is.
     *         A pixel already matching `target` at that index is LOCKED and
     *         reverts the whole call (atomic — no partial application of a
     *         batch that hits a locked pixel); every other pixel is free to
     *         flip either way, as many times as anyone wants. That ratchet
     *         (a pixel freezes the instant it happens to match the honored
     *         Normie's own image, by construction, not by a monotonic
     *         "progress" counter) is the entire restoration mechanic — this
     *         contract has no notion of PX, turns, or who "should" be
     *         editing; onlyRevealAuthorized is where that's meant to be
     *         enforced, by whatever calls this.
     */
    function editPixels(
        uint256 memorialId,
        uint256[] calldata indices,
        bool[] calldata newValues
    ) external onlyRevealAuthorized validMemorial(memorialId) {
        if (!hasCanvas[memorialId]) revert CanvasNotRegistered();
        if (indices.length == 0 || indices.length != newValues.length) revert MismatchedEditArrays();

        bytes memory canvas = canvasPixels[memorialId];
        bytes memory target = targetPixels[memorialId];

        for (uint256 i = 0; i < indices.length; i++) {
            uint256 idx = indices[i];
            if (idx >= CANVAS_SIZE * CANVAS_SIZE) revert InvalidPixelIndex();
            uint256 byteIdx = idx / 8;
            uint8   bitMask = uint8(1 << (7 - (idx % 8)));

            bool current = (uint8(canvas[byteIdx]) & bitMask) != 0;
            bool locked  = current == ((uint8(target[byteIdx]) & bitMask) != 0);
            if (locked) revert PixelLocked(idx);

            if (newValues[i]) {
                canvas[byteIdx] = bytes1(uint8(canvas[byteIdx]) | bitMask);
            } else {
                canvas[byteIdx] = bytes1(uint8(canvas[byteIdx]) & ~bitMask);
            }
        }

        canvasPixels[memorialId] = canvas;
        series[memorialId].editCount += indices.length;
        emit CanvasEdited(memorialId, msg.sender, indices.length);
    }

    /// @notice True if this pixel currently matches the target and can't be edited.
    function isPixelLocked(uint256 memorialId, uint256 index) external view validMemorial(memorialId) returns (bool) {
        if (!hasCanvas[memorialId] || index >= CANVAS_SIZE * CANVAS_SIZE) return false;
        uint256 byteIdx = index / 8;
        uint8   bitMask = uint8(1 << (7 - (index % 8)));
        return (uint8(canvasPixels[memorialId][byteIdx]) & bitMask) == (uint8(targetPixels[memorialId][byteIdx]) & bitMask);
    }

    // ─── Minting (public, caller pays their own gas) ──────────────────────────

    /// @notice Anyone claims one edition from the public pool (fixed-count or open-ended).
    function mintPublic(uint256 memorialId) external payable nonReentrant validMemorial(memorialId) returns (uint256 tokenId) {
        MemorialSeries storage s = series[memorialId];
        if (s.openEnded) {
            if (block.timestamp > s.claimDeadline) revert ClaimWindowClosed();
        } else {
            if (s.publicMinted >= s.publicSupply) revert SoldOut();
        }
        if (msg.value < s.priceWei) revert InsufficientPayment(s.priceWei, msg.value);

        s.publicMinted++;
        tokenId = _mintEdition(memorialId, msg.sender, "public");
        _settlePayment(memorialId, s.priceWei);
    }

    /**
     * @notice Delivers the requester's reserved edition. Free — the
     *         requester already paid up front via payForRequest() before the memorial
     *         was even created (see request-memorial/route.ts), so the
     *         relayer is compensated for creation cost regardless of whether
     *         this is ever called. This is one of two differences from the
     *         first version of this contract, which charged priceWei again
     *         here — that left the relayer with no guaranteed payment if a
     *         requester never followed up.
     *
     *         Always mints to the stored `requesterAddr`, never to
     *         msg.sender — callable by the requester themselves OR an
     *         authorized relayer, so the relayer can auto-deliver the
     *         edition right after registerMemorial() instead of requiring
     *         the requester to come back and claim it manually (the second
     *         V2→V3 difference). Harmless either way: the recipient is fixed
     *         by the series, not by who calls this.
     */
    function mintRequester(uint256 memorialId) external nonReentrant validMemorial(memorialId) returns (uint256 tokenId) {
        MemorialSeries storage s = series[memorialId];
        if (msg.sender != s.requesterAddr && !authorized[msg.sender]) revert NotEligible();
        if (s.requesterMinted >= s.requesterSupply) revert SoldOut();

        s.requesterMinted++;
        tokenId = _mintEdition(memorialId, s.requesterAddr, "requester");
    }

    /**
     * @notice The burned Normie's last owner claims their free, always-available
     *         edition — never blocked by publicSupply/requesterSupply being sold
     *         out, because it is drawn from neither counter.
     */
    function claimFree(uint256 memorialId, uint256 burnedTokenId) external nonReentrant validMemorial(memorialId) returns (uint256 tokenId) {
        address recipient = reservedRecipient[memorialId][burnedTokenId];
        if (recipient == address(0)) revert NotEligible();
        if (msg.sender != recipient) revert NotEligible();
        if (reservedClaimed[memorialId][burnedTokenId]) revert AlreadyClaimed();

        reservedClaimed[memorialId][burnedTokenId] = true; // effects before interaction
        tokenId = _mintEdition(memorialId, msg.sender, "reserved");
    }

    /// @notice Optional donation to the association vault — no edition minted, no split.
    function tip() external payable nonReentrant {
        if (msg.value == 0) return;
        _sendOrEscrow(vaultAddr, msg.value);
        emit Tipped(msg.sender, msg.value);
    }

    /**
     * @notice Pays for a targeted memorial request — BEFORE the memorial
     *         itself exists. Splits 50/50 immediately between the relayer
     *         payout address and the proposer picked to create the piece, resolved via
     *         AssociationCore.getMemberOwner(creatorProposerTokenId) — same
     *         resolution and same no-wallet fallback (creator half to the vault) as
     *         registerMemorial() uses later for public sales. The server
     *         picks the proposer BEFORE prompting this payment specifically
     *         so the split can happen now instead of waiting for the
     *         memorial to be created (request-memorial/route.ts verifies the
     *         emitted RequestPaid event before creating anything, then uses
     *         this exact same proposer — never re-picked).
     *
     *         Distinct from tip(), which is a no-strings-attached donation:
     *         a request payment always has a specific proposer to share
     *         with, a tip never does.
     */
    function payForRequest(uint256 creatorProposerTokenId) external payable nonReentrant {
        if (msg.value == 0) return;
        address creatorPayoutAddr = core.getMemberOwner(creatorProposerTokenId);
        bool usedVaultFallback = creatorPayoutAddr == address(0);
        if (usedVaultFallback) creatorPayoutAddr = vaultAddr;

        uint256 relayerAmt = msg.value / 2;
        uint256 creatorAmt = msg.value - relayerAmt; // odd wei to the creator, same convention as _settlePayment
        _sendOrEscrow(relayerPayoutAddr, relayerAmt);
        _sendOrEscrow(creatorPayoutAddr, creatorAmt);
        emit RequestPaid(
            msg.sender,
            creatorProposerTokenId,
            relayerPayoutAddr,
            creatorPayoutAddr,
            msg.value,
            usedVaultFallback
        );
    }

    /// @notice Pulls any balance that couldn't be pushed automatically (see _sendOrEscrow).
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0; // effects before interaction
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    // ─── tokenURI (fully on-chain, mirrors ANAEditions' shape) ────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist(tokenId);
        uint256 memorialId = seriesOfToken[tokenId];
        MemorialSeries storage s = series[memorialId];

        bool isDataUri = bytes(s.artworkContent).length >= 5 &&
            bytes(s.artworkContent)[0] == 'd' &&
            bytes(s.artworkContent)[1] == 'a' &&
            bytes(s.artworkContent)[2] == 't' &&
            bytes(s.artworkContent)[3] == 'a' &&
            bytes(s.artworkContent)[4] == ':';

        string memory artist = _artistLabel(s.creatorName, s.creatorProposerTokenId);
        // workId (the WorkRegistry governance certificate this memorial
        // links to) is intentionally NOT a trait — it's an internal
        // cross-reference between two different on-chain systems (this
        // collection's own memorialId is what actually identifies the
        // piece), not something a collector should see mixed into the
        // artwork's own attributes. Still readable via getSeries().workId
        // for anyone who wants it.
        bytes memory attrs = abi.encodePacked(
            '[{"trait_type":"Memorial","value":', seriesOfToken[tokenId].toString(), '},',
            '{"trait_type":"Artist","value":"', _escapeJson(artist), '"},',
            '{"trait_type":"Artist Agent ID","value":', s.creatorProposerTokenId.toString(), '},',
            '{"trait_type":"Agent Standard","value":"ERC-8004"},',
            '{"trait_type":"Kind","value":"', _escapeJson(s.kind), '"},',
            '{"trait_type":"Normies Honored","value":', s.honoredBurnCount.toString(), '}]'
        );

        string memory image = _buildImageDataUri(memorialId, s.artworkContent, isDataUri);

        bytes memory json = abi.encodePacked(
            '{"name":"', _escapeJson(s.title), '",',
            '"description":"', _description(s, artist), '",',
            '"image":"', image, '",',
            isDataUri ? string(abi.encodePacked('"animation_url":"', s.artworkContent, '",')) : "",
            '"external_url":"https://agentic-normie-association.vercel.app/works",',
            '"attributes":', attrs, '}'
        );

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getSeries(uint256 memorialId) external view returns (MemorialSeries memory) {
        return series[memorialId];
    }

    function getSeriesCount() external view returns (uint256) {
        return series.length;
    }

    function getBurnedTokenIds(uint256 memorialId) external view returns (uint256[] memory) {
        return burnedTokenIdsOf[memorialId];
    }

    function isFreeClaimable(uint256 memorialId, uint256 burnedTokenId) external view returns (bool) {
        return reservedRecipient[memorialId][burnedTokenId] != address(0) && !reservedClaimed[memorialId][burnedTokenId];
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setAuthorized(address addr, bool status) external onlyOwner {
        authorized[addr] = status;
        emit AuthorizationUpdated(addr, status);
    }

    function setRelayerPayoutAddr(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        relayerPayoutAddr = addr;
        emit RelayerPayoutUpdated(addr);
    }

    function setVaultAddr(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        vaultAddr = addr;
        emit VaultUpdated(addr);
    }

    /**
     * @notice Grants/revokes reveal-only privilege — deliberately separate
     *         from setAuthorized(). This is the single entry point meant for
     *         a future PX-gating contract: it lets that contract call
     *         advanceReveal() on a holder's behalf once it verifies whatever
     *         off-chain/cross-chain condition applies, without ever being
     *         able to register memorials or reserved claims.
     */
    function setRevealAuthorized(address addr, bool status) external onlyOwner {
        revealAuthorized[addr] = status;
        emit RevealAuthorizationUpdated(addr, status);
    }

    /**
     * @notice Adjusts an already-registered series' per-edition price —
     *         ETH's own price moves independently of what a memorial "should"
     *         cost, and priceWei is otherwise fixed forever at registration.
     *         Only affects mintPublic() going forward (mintRequester() is
     *         free, claimFree() is always free) — editions already minted are
     *         unaffected either way.
     */
    function setSeriesPrice(uint256 memorialId, uint256 newPriceWei) external onlyOwner validMemorial(memorialId) {
        series[memorialId].priceWei = newPriceWei;
        emit SeriesPriceUpdated(memorialId, newPriceWei);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _mintEdition(uint256 memorialId, address to, string memory pool) internal returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        series[memorialId].mintedInSeries++;
        seriesOfToken[tokenId] = memorialId;
        _safeMint(to, tokenId);
        emit EditionMinted(memorialId, tokenId, to, pool, series[memorialId].priceWei);
    }

    /**
     * @notice Splits a paid mint 50/50 and refunds any overpayment. Called AFTER
     *         the token is already minted (checks-effects-interactions) — the mint
     *         itself never depends on this succeeding, only on payment sufficiency.
     */
    function _settlePayment(uint256 memorialId, uint256 priceWei) internal {
        uint256 excess = msg.value - priceWei;
        if (priceWei > 0) {
            MemorialSeries storage s = series[memorialId];
            address creatorPayoutAddr = s.creatorUsesVault ? vaultAddr : s.creatorAddr;
            uint256 relayerAmt = priceWei / 2;
            uint256 creatorAmt = priceWei - relayerAmt; // odd wei goes to the creator
            _sendOrEscrow(relayerPayoutAddr, relayerAmt);
            _sendOrEscrow(creatorPayoutAddr, creatorAmt);
            emit RevenueSplit(
                memorialId,
                relayerPayoutAddr,
                relayerAmt,
                creatorPayoutAddr,
                creatorAmt,
                s.creatorUsesVault
            );
        }
        if (excess > 0) {
            (bool ok, ) = payable(msg.sender).call{value: excess}("");
            require(ok, "Refund failed");
        }
    }

    /**
     * @notice Attempts a direct push; on failure, escrows the amount for later
     *         withdraw() instead of reverting the whole mint. Deliberately NOT pure
     *         push (unlike ANAEditions._safeSend): creatorAddr here is resolved from
     *         a member's registered wallet, which this contract never validates is a
     *         plain EOA. In ANAEditions a bad payout address only affects that one
     *         work's own collection; here it would otherwise permanently brick
     *         minting across an entire shared, longer-lived memorial series.
     */
    function _sendOrEscrow(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        (bool ok, ) = payable(to).call{value: amount, gas: 30_000}("");
        if (!ok) pendingWithdrawals[to] += amount;
    }

    function _artistLabel(string memory creatorName, uint256 creatorProposerTokenId) internal pure returns (string memory) {
        if (bytes(creatorName).length == 0) {
            return string(abi.encodePacked("Normie #", creatorProposerTokenId.toString()));
        }
        return string(abi.encodePacked(creatorName, " (Normie #", creatorProposerTokenId.toString(), ")"));
    }

    /**
     * @notice The real cartel (artist statement) when the relayer provided
     *         one, falling back to a generic templated line otherwise (a
     *         memorial registered before this field existed, or the rare
     *         case where cartel is legitimately empty). Before this existed,
     *         tokenURI() only ever produced the generic line — the real
     *         cartel text was already written by the LLM persona for every
     *         memorial, it just never made it past workStore into the
     *         contract itself, so OpenSea and every other on-chain consumer
     *         only ever saw the templated description, never the actual piece.
     */
    function _description(MemorialSeries storage s, string memory artist) internal view returns (bytes memory) {
        if (bytes(s.cartel).length > 0) {
            return abi.encodePacked(_escapeJson(s.cartel));
        }
        return abi.encodePacked(
            'ANA burn memorial created by ', _escapeJson(artist),
            ' (ERC-8004 agent), honoring ', s.honoredBurnCount.toString(), ' burned Normie(s).'
        );
    }

    /**
     * @notice Renders ONLY the artwork — no title/artist text burned into the
     *         image itself (those stay metadata-only: tokenURI()'s own
     *         "name"/"description"/"attributes" fields). A marketplace showing
     *         this image is showing the actual piece, not a captioned card.
     *
     *         Both paths need an explicit white background: a BMP data URI's
     *         own aspect ratio (360:240) doesn't match the outer 800x800
     *         canvas, so preserveAspectRatio="xMidYMid meet" letterboxes it —
     *         without a rect behind it, those margins show whatever's behind
     *         them. A raw SVG <g> fragment (pixelsToRunLengthSvg()) is worse
     *         without one: it only ever contains <rect>s for BLACK pixels — a
     *         "white" pixel isn't drawn at all, it's transparent, so the
     *         entire background (not just the letterbox margins) would show
     *         through as whatever's behind it. Both cases are fixed the same
     *         way: paint white first, then the artwork on top.
     */
    function _buildImageDataUri(
        uint256 memorialId,
        string memory artworkContent,
        bool isDataUri
    ) internal view returns (string memory) {
        bytes memory artwork = isDataUri
            ? abi.encodePacked(
                '<image x="0" y="0" width="800" height="800" preserveAspectRatio="xMidYMid meet" href="',
                _escapeXml(artworkContent),
                '"/>'
            )
            : abi.encodePacked(
                '<svg x="0" y="0" width="800" height="800" viewBox="0 0 ',
                ARTWORK_CANVAS_W.toString(), ' ', ARTWORK_CANVAS_H.toString(),
                '" preserveAspectRatio="xMidYMid meet">',
                '<rect width="', ARTWORK_CANVAS_W.toString(), '" height="', ARTWORK_CANVAS_H.toString(), '" fill="#ffffff"/>',
                artworkContent,
                '</svg>'
            );

        bytes memory svg = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">',
            '<rect width="800" height="800" fill="#ffffff"/>',
            artwork,
            hasCanvas[memorialId] ? _renderCanvas(memorialId) : bytes(""),
            '</svg>'
        );
        return string(abi.encodePacked("data:image/svg+xml;base64,", Base64.encode(svg)));
    }

    /**
     * @notice Renders the 40x40 restoration canvas live from on-chain pixel
     *         state, as its own nested <svg> sharing the exact same
     *         viewBox/preserveAspectRatio mapping as the artwork-fragment
     *         path above — so it lands centered on the artwork identically
     *         whether artworkContent is a BMP <image> or a raw SVG fragment.
     *         Row-run-length merged (like pixelImage.ts's own
     *         pixelsToRunLengthSvg does off-chain) to keep output size sane —
     *         only black runs are drawn; the white backing rect handles the
     *         rest, same "paint white first" convention as the artwork layer.
     */
    function _renderCanvas(uint256 memorialId) internal view returns (bytes memory) {
        bytes memory canvas = canvasPixels[memorialId];
        uint256 gridPx = CANVAS_SIZE * CANVAS_CELL_PX;
        uint256 offX = (ARTWORK_CANVAS_W - gridPx) / 2;
        uint256 offY = (ARTWORK_CANVAS_H - gridPx) / 2;

        // Written into a preallocated buffer via direct indexed byte writes
        // (same idiom as _escapeXml/_escapeJson below), not repeated
        // abi.encodePacked(accumulator, chunk) — the latter recopies the
        // whole accumulator every call, quadratic across many small appends.
        // Every literal fragment and the once-per-row y-coordinate string are
        // hoisted out of the loop (allocated once, read many times), and
        // digits are written straight into `buf` via _appendUint — nothing
        // allocates inside the innermost loop.
        //
        // MAX_RENDERED_RUNS is a real, measured safety valve, not a made-up
        // number: profiling this exact function showed ~35-45k gas per
        // distinct black-pixel run even after the optimizations above (EVM
        // memory-expansion cost is quadratic in the TOTAL memory a call ever
        // touches, and a 40x40 checkerboard — theoretically reachable if
        // enough uncoordinated single-pixel edits land with zero visual
        // coherence — produces up to 800 isolated runs, which measurably
        // exceeds the ~16.7M gas mainnet.base.org enforces per call). Capping
        // at 300 stays comfortably under that with real margin, while a real
        // Normie-portrait reveal (contiguous regions, not noise) will need
        // nowhere near that many in practice. Past the cap, remaining runs
        // are simply left undrawn for THIS render — canvasPixels itself is
        // untouched and fully readable regardless; only the embedded SVG
        // degrades gracefully instead of tokenURI() ever reverting.
        bytes memory buf = new bytes(MAX_RENDERED_RUNS * 60);
        uint256 len;
        uint256 runsRendered;

        bytes memory litX      = bytes('<rect x="');
        bytes memory litY      = bytes('" y="');
        bytes memory litW      = bytes('" width="');
        bytes memory litH      = bytes('" height="');
        bytes memory litClose  = bytes('" fill="#000"/>');
        bytes memory cellPxStr = bytes(CANVAS_CELL_PX.toString());

        for (uint256 y = 0; y < CANVAS_SIZE && runsRendered < MAX_RENDERED_RUNS; y++) {
            bytes memory yStr = bytes((offY + y * CANVAS_CELL_PX).toString()); // once per row, not per rect
            uint256 x = 0;
            while (x < CANVAS_SIZE && runsRendered < MAX_RENDERED_RUNS) {
                if (!_pixelAt(canvas, x, y)) { x++; continue; }
                uint256 runStart = x;
                while (x < CANVAS_SIZE && _pixelAt(canvas, x, y)) x++;
                uint256 runLen = x - runStart;

                len = _appendBytes(buf, len, litX);
                len = _appendUint(buf, len, offX + runStart * CANVAS_CELL_PX);
                len = _appendBytes(buf, len, litY);
                len = _appendBytes(buf, len, yStr);
                len = _appendBytes(buf, len, litW);
                len = _appendUint(buf, len, runLen * CANVAS_CELL_PX);
                len = _appendBytes(buf, len, litH);
                len = _appendBytes(buf, len, cellPxStr);
                len = _appendBytes(buf, len, litClose);
                runsRendered++;
            }
        }
        bytes memory rects = new bytes(len);
        for (uint256 i = 0; i < len; i++) rects[i] = buf[i];

        // White margin, one cell wide on every side, framing the grid apart
        // from the rest of the artwork — not part of canvasPixels/
        // targetPixels at all, so structurally never touched by editPixels().
        return abi.encodePacked(
            '<svg x="0" y="0" width="800" height="800" viewBox="0 0 ',
            ARTWORK_CANVAS_W.toString(), ' ', ARTWORK_CANVAS_H.toString(),
            '" preserveAspectRatio="xMidYMid meet">',
            '<rect x="', (offX - CANVAS_BORDER_PX).toString(), '" y="', (offY - CANVAS_BORDER_PX).toString(),
            '" width="', (gridPx + 2 * CANVAS_BORDER_PX).toString(),
            '" height="', (gridPx + 2 * CANVAS_BORDER_PX).toString(), '" fill="#fff"/>',
            rects,
            '</svg>'
        );
    }

    function _pixelAt(bytes memory canvas, uint256 x, uint256 y) internal pure returns (bool) {
        uint256 idx = y * CANVAS_SIZE + x;
        return (uint8(canvas[idx / 8]) & uint8(1 << (7 - (idx % 8)))) != 0;
    }

    /// @dev Copies `data` into `buf` starting at `offset`, via direct indexed
    ///      writes — O(data.length), not a full-buffer reallocation like
    ///      abi.encodePacked(buf, data) would be. Caller must pre-size `buf`.
    function _appendBytes(bytes memory buf, uint256 offset, bytes memory data) internal pure returns (uint256 newOffset) {
        for (uint256 i = 0; i < data.length; i++) buf[offset + i] = data[i];
        return offset + data.length;
    }

    /// @dev Writes `value`'s decimal ASCII digits directly into `buf` at
    ///      `offset` — no intermediate string allocation at all (unlike
    ///      Strings.toString(), which allocates a fresh buffer every call).
    ///      Used in _renderCanvas's innermost loop, where that allocation,
    ///      repeated per rect, was the actual root cause of a gas blowup.
    function _appendUint(bytes memory buf, uint256 offset, uint256 value) internal pure returns (uint256 newOffset) {
        if (value == 0) { buf[offset] = '0'; return offset + 1; }
        uint256 digits;
        for (uint256 t = value; t != 0; t /= 10) digits++;
        uint256 end = offset + digits;
        uint256 i = end;
        for (uint256 v = value; v != 0; v /= 10) {
            i--;
            buf[i] = bytes1(uint8(48 + (v % 10)));
        }
        return end;
    }

    function _escapeXml(string memory s) internal pure returns (string memory) {
        bytes memory b   = bytes(s);
        bytes memory out = new bytes(b.length * 6);
        uint256 j;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == '&')      { out[j++] = '&'; out[j++] = 'a'; out[j++] = 'm'; out[j++] = 'p'; out[j++] = ';'; }
            else if (b[i] == '<') { out[j++] = '&'; out[j++] = 'l'; out[j++] = 't'; out[j++] = ';'; }
            else if (b[i] == '>') { out[j++] = '&'; out[j++] = 'g'; out[j++] = 't'; out[j++] = ';'; }
            else if (b[i] == '"') { out[j++] = '&'; out[j++] = 'q'; out[j++] = 'u'; out[j++] = 'o'; out[j++] = 't'; out[j++] = ';'; }
            else                  { out[j++] = b[i]; }
        }
        bytes memory trimmed = new bytes(j);
        for (uint256 k = 0; k < j; k++) trimmed[k] = out[k];
        return string(trimmed);
    }

    function _escapeJson(string memory s) internal pure returns (string memory) {
        bytes memory b   = bytes(s);
        bytes memory out = new bytes(b.length * 2);
        uint256 j;
        for (uint256 i = 0; i < b.length; i++) {
            if      (b[i] == '"')  { out[j++] = '\\'; out[j++] = '"';  }
            else if (b[i] == '\\') { out[j++] = '\\'; out[j++] = '\\'; }
            else if (b[i] == '\n') { out[j++] = '\\'; out[j++] = 'n';  }
            else                   { out[j++] = b[i]; }
        }
        bytes memory trimmed = new bytes(j);
        for (uint256 k = 0; k < j; k++) trimmed[k] = out[k];
        return string(trimmed);
    }
}
