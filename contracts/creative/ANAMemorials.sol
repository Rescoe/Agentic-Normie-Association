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

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAuthorized() {
        if (!authorized[msg.sender]) revert NotAuthorized();
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
     *         initialize() call.
     * @param creatorProposerTokenId The ANA member (Normie) whose ERC-8004 persona
     *        made the piece.
     * @param creatorName Display name stored in the NFT metadata as the artist.
     */
    function registerMemorial(
        string  calldata title,
        string  calldata artworkContent,
        uint256 workId,
        uint256 creatorProposerTokenId,
        string  calldata creatorName,
        uint256 priceWei,
        uint256 publicSupply,
        uint256 requesterSupply,
        address requesterAddr,
        bool    openEnded,
        uint256 claimDurationSeconds
    ) external onlyAuthorized returns (uint256 memorialId) {
        require(bytes(artworkContent).length > 0, "Empty artwork");
        if (requesterSupply > 0 && requesterAddr == address(0)) revert ZeroAddress();

        address creatorAddr = core.getMemberOwner(creatorProposerTokenId);
        bool creatorUsesVault = creatorAddr == address(0);

        memorialId = series.length;
        series.push(MemorialSeries({
            title:            title,
            artworkContent:   artworkContent,
            creatorName:      creatorName,
            workId:           workId,
            creatorProposerTokenId: creatorProposerTokenId,
            creatorAddr:      creatorAddr,
            creatorUsesVault: creatorUsesVault,
            priceWei:         priceWei,
            publicSupply:     openEnded ? 0 : publicSupply,
            publicMinted:     0,
            requesterSupply:  requesterSupply,
            requesterMinted:  0,
            requesterAddr:    requesterAddr,
            openEnded:        openEnded,
            claimDeadline:    openEnded ? block.timestamp + claimDurationSeconds : 0,
            mintedInSeries:   0,
            initialized:      true
        }));

        emit MemorialRegistered(
            memorialId,
            title,
            workId,
            creatorProposerTokenId,
            creatorName,
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
        bytes memory attrs = abi.encodePacked(
            '[{"trait_type":"Memorial","value":', seriesOfToken[tokenId].toString(), '},',
            '{"trait_type":"Work ID","value":', s.workId.toString(), '},',
            '{"trait_type":"Artist","value":"', _escapeJson(artist), '"},',
            '{"trait_type":"Artist Agent ID","value":', s.creatorProposerTokenId.toString(), '},',
            '{"trait_type":"Agent Standard","value":"ERC-8004"}]'
        );

        string memory image = _buildImageDataUri(s.title, artist, s.artworkContent, isDataUri);

        bytes memory json = abi.encodePacked(
            '{"name":"', _escapeJson(s.title), '",',
            '"description":"ANA burn memorial created by ', _escapeJson(artist), ' (ERC-8004 agent).",',
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

    function _buildImageDataUri(
        string memory title,
        string memory artist,
        string memory artworkContent,
        bool isDataUri
    ) internal pure returns (string memory) {
        // A data URI (BMP) embeds via <image href>. A raw SVG <g> fragment
        // (pixelImage.ts's pixelsToRunLengthSvg()) is spliced directly into a
        // nested <svg> instead — its own viewBox maps the native
        // ARTWORK_CANVAS_W x ARTWORK_CANVAS_H pixel grid onto the 800x800
        // canvas, no base64/data-URI wrapping needed since it's already
        // markup, not an opaque binary resource.
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
                artworkContent,
                '</svg>'
            );

        bytes memory svg = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">',
            '<rect width="800" height="800" fill="#0A0A0A"/>',
            artwork,
            '<rect x="0" y="610" width="800" height="190" fill="#000" fill-opacity="0.82"/>',
            '<text x="400" y="670" font-family="monospace" font-size="28" font-weight="700" fill="#FFF" text-anchor="middle">', _escapeXml(title), '</text>',
            '<text x="400" y="715" font-family="monospace" font-size="17" fill="#E2E8F0" text-anchor="middle">by ', _escapeXml(artist), '</text>',
            '<text x="400" y="754" font-family="monospace" font-size="14" fill="#94A3B8" text-anchor="middle">ANA Memorial - ERC-8004</text>',
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
