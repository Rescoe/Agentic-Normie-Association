// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title ANAEditions
 * @notice ERC-721 for ANA published works.
 *
 * Each token = one purchasable edition of an ANA artwork.
 *
 * What is stored on-chain per token:
 *   content  — the artwork itself (poem UTF-8, or data:text/html;base64,... for HTML/code)
 *   title    — work title
 *   workId   — index in WorkRegistry where the full certificate lives
 *
 * The full governance certificate (proposal, votes, brief, team, logs) is NOT
 * duplicated here — it is already stored immutably in WorkRegistry. workId is
 * the permanent pointer to it.
 *
 * Revenue split on first sale (seller == minter):
 *   authorPct% → authorAddr
 *   curatorPct% → curatorAddr
 *   rapporteurPct% → rapporteurAddr
 *   remainder → associationAddr (vault)
 *
 * Revenue split on resale (seller != minter):
 *   90% → seller
 *   10% royalty pool → split among role addresses using same percentages
 */
contract ANAEditions is ERC721, ERC2981, Ownable, ReentrancyGuard {
    using Strings for uint256;

    // ─── Types ───────────────────────────────────────────────────────────────

    struct Edition {
        string  content;       // artwork only — poem text or data URI for HTML/code
        string  title;
        uint256 priceWei;      // 0 = not listed for sale
        uint256 workId;        // WorkRegistry index → full governance certificate
        uint256 editionGroup;  // groups editions of the same artwork
        uint256 createdAt;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    uint256 public immutable creatorNormieTokenId;
    address public minter;

    address public authorAddr;
    address public curatorAddr;
    address public rapporteurAddr;
    address public associationAddr;

    uint8  public authorPct;
    uint8  public curatorPct;
    uint8  public rapporteurPct;

    uint256 public nextTokenId;
    uint256 private _nextEditionGroup;

    mapping(uint256 => Edition) private _editions;
    mapping(uint256 => bool)    public  tokenForSale;
    mapping(uint256 => uint256) public  editionGroupSize;

    // ─── Events ──────────────────────────────────────────────────────────────

    event EditionMinted(uint256 indexed tokenId, uint256 indexed groupId, string title, uint256 priceWei, uint256 total);
    event EditionSold(uint256 indexed tokenId, address indexed buyer, uint256 priceWei);
    event EditionListedForResale(uint256 indexed tokenId, uint256 priceWei);
    event EditionRemovedFromSale(uint256 indexed tokenId);
    event MinterUpdated(address indexed newMinter);
    event RecipientUpdated(string role, address newAddr);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error OnlyMinter();
    error TokenNotForSale(uint256 tokenId);
    error InsufficientPayment(uint256 required, uint256 sent);
    error CannotBuyOwn();
    error TokenDoesNotExist(uint256 tokenId);
    error ZeroAddress();
    error PctOverflow();
    error NotTokenOwner();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        string  memory name_,
        string  memory symbol_,
        uint256 normieTokenId,
        address minter_,
        address authorAddr_,
        address curatorAddr_,
        address rapporteurAddr_,
        address associationAddr_,
        uint8   authorPct_,
        uint8   curatorPct_,
        uint8   rapporteurPct_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        if (minter_ == address(0) || associationAddr_ == address(0)) revert ZeroAddress();
        if (uint16(authorPct_) + uint16(curatorPct_) + uint16(rapporteurPct_) > 100) revert PctOverflow();

        creatorNormieTokenId = normieTokenId;
        minter         = minter_;
        authorAddr     = authorAddr_;
        curatorAddr    = curatorAddr_;
        rapporteurAddr = rapporteurAddr_;
        associationAddr = associationAddr_;
        authorPct      = authorPct_;
        curatorPct     = curatorPct_;
        rapporteurPct  = rapporteurPct_;

        _setDefaultRoyalty(associationAddr_, 1000); // 10% ERC-2981
    }

    // ─── Minting (relayer only) ───────────────────────────────────────────────

    /**
     * @notice Mint editions for a published ANA work.
     * @param totalEditions  Number of edition tokens (1 for 1/1, up to 250)
     * @param content        The artwork itself — poem UTF-8 text, or data:text/html;base64,...
     *                       NOT the full certificate. WorkRegistry.works(workId) holds that.
     * @param title          Work title
     * @param priceWei       Sale price in wei (0 = minted but not listed)
     * @param workId         Index of this work in WorkRegistry (permanent certificate reference)
     */
    function mint(
        uint256 totalEditions,
        string calldata content,
        string calldata title,
        uint256 priceWei,
        uint256 workId
    ) external {
        if (msg.sender != minter) revert OnlyMinter();
        require(totalEditions > 0 && totalEditions <= 250, "Invalid editions count");
        require(bytes(content).length > 0, "Empty content");

        uint256 groupId = _nextEditionGroup++;
        editionGroupSize[groupId] = totalEditions;

        for (uint256 i = 0; i < totalEditions; i++) {
            uint256 tokenId = nextTokenId++;
            _safeMint(msg.sender, tokenId);
            _editions[tokenId] = Edition({
                content:      content,
                title:        title,
                priceWei:     priceWei,
                workId:       workId,
                editionGroup: groupId,
                createdAt:    block.timestamp
            });
            if (priceWei > 0) tokenForSale[tokenId] = true;
            emit EditionMinted(tokenId, groupId, title, priceWei, totalEditions);
        }
    }

    // ─── Buying (public) ─────────────────────────────────────────────────────

    function buyEdition(uint256 tokenId) external payable nonReentrant {
        if (!_exists(tokenId)) revert TokenDoesNotExist(tokenId);
        if (!tokenForSale[tokenId]) revert TokenNotForSale(tokenId);

        uint256 price = _editions[tokenId].priceWei;
        if (msg.value < price) revert InsufficientPayment(price, msg.value);

        address seller = ownerOf(tokenId);
        if (seller == msg.sender) revert CannotBuyOwn();

        tokenForSale[tokenId] = false;
        _transfer(seller, msg.sender, tokenId);
        _distributeRevenue(price, seller);

        emit EditionSold(tokenId, msg.sender, price);

        uint256 excess = msg.value - price;
        if (excess > 0) {
            (bool ok, ) = payable(msg.sender).call{value: excess}("");
            require(ok, "Refund failed");
        }
    }

    // ─── Resale listing ──────────────────────────────────────────────────────

    function listForResale(uint256 tokenId, uint256 priceWei) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        require(priceWei > 0, "Price must be > 0");
        _editions[tokenId].priceWei = priceWei;
        tokenForSale[tokenId] = true;
        emit EditionListedForResale(tokenId, priceWei);
    }

    function removeFromSale(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        tokenForSale[tokenId] = false;
        emit EditionRemovedFromSale(tokenId);
    }

    // ─── tokenURI (fully on-chain) ────────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert TokenDoesNotExist(tokenId);
        Edition storage e = _editions[tokenId];
        uint256 groupId   = e.editionGroup;
        uint256 total     = editionGroupSize[groupId];

        uint256 editionNum = _editionNumberInGroup(tokenId, groupId, total);
        string memory editionLabel = total == 1
            ? "1/1"
            : string(abi.encodePacked(editionNum.toString(), "/", total.toString()));

        // Detect content type: if it starts with "data:" it's a media data URI (HTML/image)
        // otherwise it's raw text (poem, code snippet shown as description)
        bool isDataUri = bytes(e.content).length >= 5 &&
            bytes(e.content)[0] == 'd' &&
            bytes(e.content)[1] == 'a' &&
            bytes(e.content)[2] == 't' &&
            bytes(e.content)[3] == 'a' &&
            bytes(e.content)[4] == ':';

        bytes memory json;
        if (isDataUri) {
            json = abi.encodePacked(
                '{"name":"', _escapeJson(e.title), unicode" — ", editionLabel, '",',
                '"description":"ANA on-chain work, Normie #', creatorNormieTokenId.toString(), '",',
                '"animation_url":"', e.content, '",',
                '"external_url":"https://agentic-normie-association.vercel.app/works",',
                '"attributes":[',
                    '{"trait_type":"Edition","value":"', editionLabel, '"},',
                    '{"trait_type":"Normie","value":', creatorNormieTokenId.toString(), '},',
                    '{"trait_type":"Work ID","value":', e.workId.toString(), '},',
                    '{"trait_type":"Total editions","value":', total.toString(), '}',
                ']}'
            );
        } else {
            // Raw text artwork (poem, etc.) — store as description
            json = abi.encodePacked(
                '{"name":"', _escapeJson(e.title), unicode" — ", editionLabel, '",',
                '"description":"', _escapeJson(e.content), '",',
                '"external_url":"https://agentic-normie-association.vercel.app/works",',
                '"attributes":[',
                    '{"trait_type":"Edition","value":"', editionLabel, '"},',
                    '{"trait_type":"Normie","value":', creatorNormieTokenId.toString(), '},',
                    '{"trait_type":"Work ID","value":', e.workId.toString(), '},',
                    '{"trait_type":"Art form","value":"text"},',
                    '{"trait_type":"Total editions","value":', total.toString(), '}',
                ']}'
            );
        }

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(json)
        ));
    }

    // ─── ERC-165 ─────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function getEdition(uint256 tokenId) external view returns (Edition memory) {
        if (!_exists(tokenId)) revert TokenDoesNotExist(tokenId);
        return _editions[tokenId];
    }

    function getForSaleTokens() external view returns (uint256[] memory) {
        uint256 count;
        for (uint256 i = 0; i < nextTokenId; i++) {
            if (_exists(i) && tokenForSale[i]) count++;
        }
        uint256[] memory ids = new uint256[](count);
        uint256 idx;
        for (uint256 i = 0; i < nextTokenId && idx < count; i++) {
            if (_exists(i) && tokenForSale[i]) ids[idx++] = i;
        }
        return ids;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert ZeroAddress();
        minter = newMinter;
        emit MinterUpdated(newMinter);
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

    function _distributeRevenue(uint256 price, address seller) internal {
        bool isResale = (seller != minter);

        uint256 authorAmt;
        uint256 curatorAmt;
        uint256 rapporteurAmt;
        uint256 assocAmt;

        if (!isResale) {
            authorAmt     = (price * authorPct)     / 100;
            curatorAmt    = (price * curatorPct)    / 100;
            rapporteurAmt = (price * rapporteurPct) / 100;
            assocAmt      = price - authorAmt - curatorAmt - rapporteurAmt;
        } else {
            uint256 sellerCut   = (price * 90) / 100;
            uint256 royaltyPool = price - sellerCut;
            authorAmt     = (royaltyPool * authorPct)     / 100;
            curatorAmt    = (royaltyPool * curatorPct)    / 100;
            rapporteurAmt = (royaltyPool * rapporteurPct) / 100;
            assocAmt      = royaltyPool - authorAmt - curatorAmt - rapporteurAmt;
            _safeSend(seller, sellerCut);
        }

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

    function _exists(uint256 tokenId) internal view returns (bool) {
        return tokenId < nextTokenId && _ownerOf(tokenId) != address(0);
    }

    function _editionNumberInGroup(uint256 tokenId, uint256 groupId, uint256 total)
        internal view returns (uint256)
    {
        uint256 num = 1;
        uint256 seen = 0;
        for (uint256 i = 0; i < nextTokenId && seen < total; i++) {
            if (_exists(i) && _editions[i].editionGroup == groupId) {
                seen++;
                if (i == tokenId) return num;
                num++;
            }
        }
        return 1;
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
