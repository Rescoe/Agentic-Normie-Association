// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../interfaces/IAssociationCore.sol";

/**
 * @title ANAEditions
 * @notice Open-edition ERC-721 for ANA published works.
 *
 * Lifecycle:
 *  1. ANACollectionFactory.createCollection() deploys this contract with governance
 *     params (supply, price, revenue splits). Artwork NOT yet stored — collection
 *     is dormant.
 *
 *  2. WorkRegistry.publish() stores the governance certificate (which includes
 *     this contract's address) and returns a workId.
 *
 *  3. Relayer calls initialize(artworkContent, artworkTitle, workId).
 *     Collection becomes active — mints are now possible.
 *
 *  4. Anyone calls buyAndMint() payable. Token minted directly to buyer.
 *     No pre-minting. Supply is hard-capped at maxSupply.
 *
 *  4b. A registered ANA member calls claimFree(memberTokenId) — ONE free edition
 *      per member per collection, no payment, no sponsorship pool. Gated by
 *      AssociationCore: the caller must be the registered owner of that Normie.
 *
 * Revenue split (first-come, shared rules for all editions):
 *   authorPct% → authorAddr
 *   curatorPct% → curatorAddr
 *   rapporteurPct% → rapporteurAddr
 *   remainder → associationAddr (vault)
 *
 * ERC-2981: 10% to associationAddr for secondary marketplace royalties (OpenSea etc).
 */
contract ANAEditions is ERC721, ERC2981, Ownable, ReentrancyGuard {
    using Strings for uint256;

    // ─── Fixed at deploy (from collective vote) ──────────────────────────────

    uint256 public immutable maxSupply;
    uint256 public immutable priceWei;
    uint256 public immutable creatorNormieTokenId;
    IAssociationCore public immutable core; // membership source of truth for claimFree()

    // 5% of every sale goes to the real human loi 1901 association that runs the platform.
    // This sustains the ANA infrastructure independently of on-chain revenue.
    uint256 public constant PLATFORM_FEE_PCT = 5;
    address public immutable platformAddr;

    // ─── Set via initialize() after WorkRegistry.publish() ──────────────────

    // The artwork itself — poem UTF-8 text, or data:text/html;base64,... for HTML/code.
    // NOT the full governance certificate; that lives in WorkRegistry at workId.
    string  public artworkContent;
    string  public artworkTitle;
    uint256 public workId;
    bool    public initialized;

    // ─── Revenue ─────────────────────────────────────────────────────────────

    address public minter;          // relayer — can call initialize()
    address public authorAddr;
    address public curatorAddr;
    address public rapporteurAddr;
    address public associationAddr; // ANA on-chain vault (TreasuryModule)

    uint8  public authorPct;
    uint8  public curatorPct;
    uint8  public rapporteurPct;

    uint256 public totalMinted;

    // One free claim per registered member per collection.
    mapping(uint256 => bool) public freeClaimed; // memberTokenId => claimed

    // Contracts authorized to mint a free edition directly to an arbitrary
    // recipient (e.g. CelebrationRegistry, after it verifies event eligibility
    // itself — independent of AssociationCore membership). No payment either way.
    mapping(address => bool) public freeMinters;

    // ─── Events ──────────────────────────────────────────────────────────────

    event CollectionInitialized(string artworkTitle, uint256 workId);
    event EditionMinted(uint256 indexed tokenId, address indexed buyer, uint256 priceWei);
    event FreeEditionClaimed(uint256 indexed memberTokenId, address indexed recipient, uint256 tokenId);
    event FreeEditionMinted(address indexed minter, address indexed recipient, uint256 tokenId);
    event MinterUpdated(address indexed newMinter);
    event FreeMinterUpdated(address indexed addr, bool status);
    event RecipientUpdated(string role, address newAddr);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotInitialized();
    error AlreadyInitialized();
    error SoldOut();
    error OnlyMinter();
    error OnlyFreeMinter();
    error InsufficientPayment(uint256 required, uint256 sent);
    error ZeroAddress();
    error PctOverflow();
    error TokenDoesNotExist(uint256 tokenId);
    error NotMember(uint256 tokenId);
    error NotMemberOwner(uint256 tokenId);
    error AlreadyClaimed(uint256 tokenId);

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param name_            ERC-721 collection name
     * @param symbol_          ERC-721 symbol
     * @param normieTokenId_   Creator's Normie token ID
     * @param maxSupply_       Hard cap on editions (from collective vote)
     * @param priceWei_        Price per edition in wei (from collective vote)
     * @param minter_          Address that can call initialize() (= relayer)
     * @param authorAddr_      Revenue recipient — AUTHOR role
     * @param curatorAddr_     Revenue recipient — CURATOR role
     * @param rapporteurAddr_  Revenue recipient — RAPPORTEUR role
     * @param associationAddr_ ANA on-chain vault (TreasuryModule) — remainder + ERC-2981 royalties
     * @param platformAddr_    Real human loi 1901 association — receives 5% platform fee
     * @param coreAddr_        AssociationCore — source of truth for claimFree() membership checks
     * @param authorPct_       Author revenue share (0-100, of the 95% remaining after platform fee)
     * @param curatorPct_      Curator revenue share
     * @param rapporteurPct_   Rapporteur revenue share
     */
    constructor(
        string  memory name_,
        string  memory symbol_,
        uint256 normieTokenId_,
        uint256 maxSupply_,
        uint256 priceWei_,
        address minter_,
        address authorAddr_,
        address curatorAddr_,
        address rapporteurAddr_,
        address associationAddr_,
        address platformAddr_,
        address coreAddr_,
        uint8   authorPct_,
        uint8   curatorPct_,
        uint8   rapporteurPct_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        if (minter_ == address(0) || associationAddr_ == address(0) || platformAddr_ == address(0) || coreAddr_ == address(0)) revert ZeroAddress();
        if (uint16(authorPct_) + uint16(curatorPct_) + uint16(rapporteurPct_) > 100) revert PctOverflow();
        require(maxSupply_ > 0 && maxSupply_ <= 10000, "Invalid supply");

        core = IAssociationCore(coreAddr_);
        creatorNormieTokenId = normieTokenId_;
        maxSupply       = maxSupply_;
        priceWei        = priceWei_;
        minter          = minter_;
        platformAddr    = platformAddr_;
        authorAddr      = authorAddr_;
        curatorAddr     = curatorAddr_;
        rapporteurAddr  = rapporteurAddr_;
        associationAddr = associationAddr_;
        authorPct       = authorPct_;
        curatorPct      = curatorPct_;
        rapporteurPct   = rapporteurPct_;

        _setDefaultRoyalty(associationAddr_, 1000); // 10% ERC-2981
    }

    // ─── Initialization (relayer only, once) ─────────────────────────────────

    /**
     * @notice Link the collection to its WorkRegistry certificate and activate mints.
     *         Called by the relayer after WorkRegistry.publish() returns a workId.
     *
     * @param artworkContent_  The artwork only — poem text or data URI for HTML/generative works.
     *                         NOT the full certificate. WorkRegistry.works(workId) holds that.
     * @param artworkTitle_    Work title
     * @param workId_          Index in WorkRegistry where the full governance certificate lives
     */
    function initialize(
        string calldata artworkContent_,
        string calldata artworkTitle_,
        uint256 workId_
    ) external {
        if (msg.sender != minter) revert OnlyMinter();
        if (initialized) revert AlreadyInitialized();
        require(bytes(artworkContent_).length > 0, "Empty artwork");

        artworkContent = artworkContent_;
        artworkTitle   = artworkTitle_;
        workId         = workId_;
        initialized    = true;

        emit CollectionInitialized(artworkTitle_, workId_);
    }

    // ─── Buying / minting (public) ────────────────────────────────────────────

    /**
     * @notice Buy and mint one edition directly to msg.sender.
     *         Requires the collection to be initialized (artwork set).
     *         Supply is hard-capped — reverts when sold out.
     */
    function buyAndMint() external payable nonReentrant {
        if (!initialized) revert NotInitialized();
        if (totalMinted >= maxSupply) revert SoldOut();
        if (msg.value < priceWei) revert InsufficientPayment(priceWei, msg.value);

        uint256 tokenId = totalMinted++;
        _safeMint(msg.sender, tokenId);
        _distributeRevenue(priceWei);

        emit EditionMinted(tokenId, msg.sender, priceWei);

        uint256 excess = msg.value - priceWei;
        if (excess > 0) {
            (bool ok, ) = payable(msg.sender).call{value: excess}("");
            require(ok, "Refund failed");
        }
    }

    // ─── Free claim for registered members (no payment, no sponsorship) ───────

    /**
     * @notice A registered ANA member claims one free edition of this collection.
     *         No ETH changes hands — this is a direct free mint, not a sponsored
     *         purchase. One claim per memberTokenId per collection, ever.
     * @param memberTokenId The caller's Normie tokenId, as registered in AssociationCore.
     */
    function claimFree(uint256 memberTokenId) external nonReentrant returns (uint256) {
        if (!initialized) revert NotInitialized();
        if (totalMinted >= maxSupply) revert SoldOut();
        if (!core.isMember(memberTokenId)) revert NotMember(memberTokenId);
        if (core.getMemberOwner(memberTokenId) != msg.sender) revert NotMemberOwner(memberTokenId);
        if (freeClaimed[memberTokenId]) revert AlreadyClaimed(memberTokenId);

        freeClaimed[memberTokenId] = true;
        uint256 tokenId = totalMinted++;
        _safeMint(msg.sender, tokenId);

        emit FreeEditionClaimed(memberTokenId, msg.sender, tokenId);
        return tokenId;
    }

    /**
     * @notice Mints one free edition directly to `recipient`, no payment. Restricted
     *         to authorized free-minter contracts (e.g. CelebrationRegistry), which
     *         verify eligibility themselves before calling this — independent of
     *         AssociationCore membership (a celebration's eligible wallet need not
     *         be a registered ANA member).
     */
    function mintFreeTo(address recipient) external nonReentrant returns (uint256) {
        if (!freeMinters[msg.sender]) revert OnlyFreeMinter();
        if (!initialized) revert NotInitialized();
        if (totalMinted >= maxSupply) revert SoldOut();

        uint256 tokenId = totalMinted++;
        _safeMint(recipient, tokenId);

        emit FreeEditionMinted(msg.sender, recipient, tokenId);
        return tokenId;
    }

    // ─── tokenURI (fully on-chain) ────────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (tokenId >= totalMinted) revert TokenDoesNotExist(tokenId);

        string memory editionLabel = maxSupply == 1
            ? "1/1"
            : string(abi.encodePacked((tokenId + 1).toString(), "/", maxSupply.toString()));

        bool isDataUri = bytes(artworkContent).length >= 5 &&
            bytes(artworkContent)[0] == 'd' &&
            bytes(artworkContent)[1] == 'a' &&
            bytes(artworkContent)[2] == 't' &&
            bytes(artworkContent)[3] == 'a' &&
            bytes(artworkContent)[4] == ':';

        bytes memory attrs = abi.encodePacked(
            '[',
            '{"trait_type":"Edition","value":"', editionLabel, '"},',
            '{"trait_type":"Normie","value":', creatorNormieTokenId.toString(), '},',
            '{"trait_type":"Work ID","value":', workId.toString(), '},',
            '{"trait_type":"Max supply","value":', maxSupply.toString(), '}',
            ']'
        );

        string memory image = _buildImageDataUri(artworkTitle, editionLabel);

        bytes memory json;
        if (isDataUri) {
            json = abi.encodePacked(
                '{"name":"', _escapeJson(artworkTitle), unicode" — ", editionLabel, '",',
                '"description":"ANA on-chain work, Normie #', creatorNormieTokenId.toString(), '",',
                '"image":"', image, '",',
                '"animation_url":"', artworkContent, '",',
                '"external_url":"https://agentic-normie-association.vercel.app/works",',
                '"attributes":', attrs, '}'
            );
        } else {
            json = abi.encodePacked(
                '{"name":"', _escapeJson(artworkTitle), unicode" — ", editionLabel, '",',
                '"description":"', _escapeJson(artworkContent), '",',
                '"image":"', image, '",',
                '"external_url":"https://agentic-normie-association.vercel.app/works",',
                '"attributes":', attrs, '}'
            );
        }

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(json)
        ));
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getAvailableEditions() external view returns (uint256) {
        return totalMinted >= maxSupply ? 0 : maxSupply - totalMinted;
    }

    function isSoldOut() external view returns (bool) {
        return totalMinted >= maxSupply;
    }

    // ─── ERC-165 ─────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ─── Admin (owner = ANACollectionFactory or multisig) ────────────────────

    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert ZeroAddress();
        minter = newMinter;
        emit MinterUpdated(newMinter);
    }

    function setFreeMinter(address addr, bool status) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        freeMinters[addr] = status;
        emit FreeMinterUpdated(addr, status);
    }

    function setAuthorAddr(address addr) external onlyOwner {
        authorAddr = addr;
        emit RecipientUpdated("author", addr);
    }

    function setCuratorAddr(address addr) external onlyOwner {
        curatorAddr = addr;
        emit RecipientUpdated("curator", addr);
    }

    function setRapporteurAddr(address addr) external onlyOwner {
        rapporteurAddr = addr;
        emit RecipientUpdated("rapporteur", addr);
    }

    function setAssociationAddr(address addr) external onlyOwner {
        associationAddr = addr;
        _setDefaultRoyalty(addr, 1000);
        emit RecipientUpdated("association", addr);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _distributeRevenue(uint256 price) internal {
        // 5% platform fee sustains the ANA infrastructure (human loi 1901 association)
        uint256 platformFee = (price * PLATFORM_FEE_PCT) / 100;
        uint256 remaining   = price - platformFee;

        // Remaining 95% split among role addresses per voted percentages
        uint256 authorAmt     = (remaining * authorPct)     / 100;
        uint256 curatorAmt    = (remaining * curatorPct)    / 100;
        uint256 rapporteurAmt = (remaining * rapporteurPct) / 100;
        uint256 assocAmt      = remaining - authorAmt - curatorAmt - rapporteurAmt;

        _safeSend(platformAddr,    platformFee);
        _safeSend(authorAddr,      authorAmt);
        _safeSend(curatorAddr,     curatorAmt);
        _safeSend(rapporteurAddr,  rapporteurAmt);
        _safeSend(associationAddr, assocAmt);
    }

    function _safeSend(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Payment failed");
    }

    // Generates a minimal fully on-chain SVG thumbnail (title + edition label, ANA
    // branding) as a base64 data URI for the "image" field. Marketplaces (OpenSea)
    // and on-chain-purity checkers require this to render a catalog preview and to
    // count the token as fully on-chain — animation_url alone only renders once a
    // collector opens the token's detail page, never in grid/list views.
    function _buildImageDataUri(string memory title, string memory editionLabel) internal pure returns (string memory) {
        bytes memory svg = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">',
            '<rect width="800" height="800" fill="#0A0A0A"/>',
            '<rect x="24" y="24" width="752" height="752" fill="none" stroke="#262626" stroke-width="2"/>',
            '<text x="400" y="370" font-family="monospace" font-size="34" fill="#E2E8F0" text-anchor="middle">', _escapeXml(title), '</text>',
            '<text x="400" y="416" font-family="monospace" font-size="18" fill="#94A3B8" text-anchor="middle">ANA ', unicode"—", ' ', editionLabel, '</text>',
            '<text x="400" y="760" font-family="monospace" font-size="12" fill="#52525B" text-anchor="middle">agentic-normie-association.vercel.app</text>',
            '</svg>'
        );
        return string(abi.encodePacked("data:image/svg+xml;base64,", Base64.encode(svg)));
    }

    // XML-escapes text inserted into the generated SVG — _escapeJson() only handles
    // JSON-unsafe characters (", \, \n), but &, < and > would break SVG markup.
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
