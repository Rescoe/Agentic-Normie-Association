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
    uint256 private constant ARTWORK_CANVAS_W = 528;
    uint256 private constant ARTWORK_CANVAS_H = 352;

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
        // Staged-reveal progressive restoration, SERIES-wide (every edition of
        // this memorial shares one evolving image — not one reveal state per
        // NFT). 0/0 means this memorial has no reveal stages registered (the
        // default for every memorial today, including all existing ones).
        // revealStage indexes into revealStages[memorialId]; artworkContent
        // above is kept in sync with revealStages[memorialId][revealStage] by
        // advanceReveal() — tokenURI() needs no reveal-specific logic at all
        // because of that.
        uint256 revealStage;
        uint256 revealStageCount;
    }

    /// @notice registerMemorial()'s params, as a struct — avoids a long flat
    ///         parameter list (stack-depth risk) now that it's grown past 10.
    struct RegisterMemorialParams {
        string  title;
        string  artworkContent;
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

    // memorialId => ordered precomputed artworkContent strings, stage 0 first.
    // Populated once by registerRevealStages(), never resized after — a
    // memorial's number of stages is fixed at the moment the relayer computes
    // them off-chain from the burned Normie's own image.
    mapping(uint256 => string[]) public revealStages;
    // Separate from `authorized` on purpose: this is the ONLY permission a
    // future PX-gating contract needs to be granted (via setRevealAuthorized)
    // to let holders spend PX to advance a reveal — it must never imply the
    // ability to register memorials or reserved claims. The main relayer can
    // always advance too (see onlyRevealAuthorized), no separate grant needed.
    mapping(address => bool)    public revealAuthorized;

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
    event RevealStagesRegistered(uint256 indexed memorialId, uint256 stageCount);
    event RevealAdvanced(uint256 indexed memorialId, uint256 newStage, uint256 stageCount);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotAuthorized();
    error ZeroAddress();
    error UnknownMemorial();
    error InvalidReservedArrays();
    error AlreadyReservedClaim();
    error NotEligible();
    error AlreadyClaimed();
    error SoldOut();
    error NotOpenEnded();
    error ClaimWindowClosed();
    error InsufficientPayment(uint256 required, uint256 sent);
    error NothingToWithdraw();
    error TokenDoesNotExist(uint256 tokenId);
    error InvalidRevealStages();
    error NoRevealStages();
    error RevealAlreadyComplete();

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

        address creatorAddr = core.getMemberOwner(p.creatorProposerTokenId);
        bool creatorUsesVault = creatorAddr == address(0);

        memorialId = series.length;
        series.push(MemorialSeries({
            title:            p.title,
            artworkContent:   p.artworkContent,
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
            revealStage:      0,
            revealStageCount: 0
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
     * @notice Registers the precomputed reveal stages for a memorial — stage 0
     *         should be identical to (or a reasonable starting point matching)
     *         artworkContent as already registered, and each subsequent stage
     *         is a full, standalone artworkContent string closer to a rendering
     *         derived from the honored Normie's own pre-burn image. All stages
     *         are computed off-chain, once, at registration time — this
     *         contract never fetches or renders anything itself, it only
     *         stores and swaps between already-finished strings. Relayer-only
     *         and callable once per memorial in practice (re-registering
     *         replaces the stage list and resets progress to 0, which is
     *         intentionally allowed for correcting a bad off-chain batch
     *         before any advanceReveal() has been paid for/triggered).
     */
    function registerRevealStages(
        uint256 memorialId,
        string[] calldata stages
    ) external onlyAuthorized validMemorial(memorialId) {
        if (stages.length == 0) revert InvalidRevealStages();
        delete revealStages[memorialId];
        for (uint256 i = 0; i < stages.length; i++) {
            revealStages[memorialId].push(stages[i]);
        }
        series[memorialId].revealStage = 0;
        series[memorialId].revealStageCount = stages.length;
        emit RevealStagesRegistered(memorialId, stages.length);
    }

    /**
     * @notice Advances a memorial to its next precomputed reveal stage —
     *         swaps artworkContent wholesale, so tokenURI() needs no
     *         reveal-specific rendering logic. Gated by onlyRevealAuthorized,
     *         not onlyAuthorized: today only the main relayer can call this
     *         (manually, e.g. during testing), but the intent is for a
     *         separate, minimally-privileged contract to be granted
     *         revealAuthorized status later and call this once it has
     *         verified whatever external condition (a PX balance, today
     *         hosted entirely outside this contract) should unlock the next
     *         stage. This contract deliberately has no opinion on what that
     *         condition is.
     */
    function advanceReveal(uint256 memorialId) external onlyRevealAuthorized validMemorial(memorialId) returns (uint256 newStage) {
        MemorialSeries storage s = series[memorialId];
        if (s.revealStageCount == 0) revert NoRevealStages();
        if (s.revealStage + 1 >= s.revealStageCount) revert RevealAlreadyComplete();
        newStage = s.revealStage + 1;
        s.revealStage = newStage;
        s.artworkContent = revealStages[memorialId][newStage];
        emit RevealAdvanced(memorialId, newStage, s.revealStageCount);
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
        MemorialSeries storage s = series[seriesOfToken[tokenId]];

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

        string memory image = _buildImageDataUri(s.artworkContent, isDataUri);

        bytes memory json = abi.encodePacked(
            '{"name":"', _escapeJson(s.title), '",',
            '"description":"ANA burn memorial created by ', _escapeJson(artist),
            ' (ERC-8004 agent), honoring ', s.honoredBurnCount.toString(), ' burned Normie(s).",',
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

    function getRevealStages(uint256 memorialId) external view returns (string[] memory) {
        return revealStages[memorialId];
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
     * @notice Renders ONLY the artwork — no title/artist text burned into the
     *         image itself (those stay metadata-only: tokenURI()'s own
     *         "name"/"description"/"attributes" fields). A marketplace showing
     *         this image is showing the actual piece, not a captioned card.
     *
     *         Both paths need an explicit white background: a BMP data URI's
     *         own aspect ratio (528:352) doesn't match the outer 800x800
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
        string memory artworkContent,
        bool isDataUri
    ) internal pure returns (string memory) {
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
            '</svg>'
        );
        return string(abi.encodePacked("data:image/svg+xml;base64,", Base64.encode(svg)));
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
