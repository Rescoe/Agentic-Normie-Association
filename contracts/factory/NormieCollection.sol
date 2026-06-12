// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NormieCollection
 * @notice On-chain ERC-721 collection created by an elected Normie.
 *
 *  Each token stores its full HTML/JS content as a data URI (same model as WorkRegistry).
 *  Metadata is entirely on-chain — no IPFS, no external server.
 *
 *  Minting is restricted to the designated minter (the Normie's holder address at creation).
 *  The collection owner can update the minter (e.g. after NFT transfer).
 */
contract NormieCollection is ERC721, Ownable {

    // ─────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────

    struct TokenData {
        string content;      // data:text/html;base64,<b64> — full source
        string title;
        uint256 createdAt;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public immutable creatorNormieTokenId;
    address public minter;
    uint256 public nextTokenId;

    mapping(uint256 => TokenData) private _tokenData;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event TokenMinted(uint256 indexed tokenId, string title, uint256 timestamp);
    event MinterUpdated(address indexed newMinter);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error OnlyMinter();
    error EmptyContent();
    error TokenDoesNotExist(uint256 tokenId);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 normieTokenId,
        address minter_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        creatorNormieTokenId = normieTokenId;
        minter = minter_;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Minting
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Mint a new token with on-chain HTML content.
     * @param to      Recipient address
     * @param content data URI: data:text/html;base64,<b64>
     * @param title   Display title for the token
     */
    function mint(
        address to,
        string calldata content,
        string calldata title
    ) external returns (uint256) {
        if (msg.sender != minter) revert OnlyMinter();
        if (bytes(content).length == 0) revert EmptyContent();

        uint256 tokenId = nextTokenId++;
        _safeMint(to, tokenId);
        _tokenData[tokenId] = TokenData({
            content:   content,
            title:     title,
            createdAt: block.timestamp
        });
        emit TokenMinted(tokenId, title, block.timestamp);
        return tokenId;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Metadata — fully on-chain
    // ─────────────────────────────────────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert TokenDoesNotExist(tokenId);
        TokenData memory td = _tokenData[tokenId];
        // Return a data URI containing a JSON metadata with the content embedded
        string memory json = string(abi.encodePacked(
            '{"name":"', td.title, ' #', _toString(tokenId), '",',
            '"description":"ANA on-chain work by Normie #', _toString(creatorNormieTokenId), '",',
            '"animation_url":"', td.content, '",',
            '"created_at":', _toString(td.createdAt), '}'
        ));
        string memory b64 = _base64Encode(bytes(json));
        return string(abi.encodePacked("data:application/json;base64,", b64));
    }

    function getTokenData(uint256 tokenId) external view returns (TokenData memory) {
        if (!_exists(tokenId)) revert TokenDoesNotExist(tokenId);
        return _tokenData[tokenId];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setMinter(address newMinter) external onlyOwner {
        minter = newMinter;
        emit MinterUpdated(newMinter);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _exists(uint256 tokenId) internal view returns (bool) {
        return tokenId < nextTokenId;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    bytes internal constant _TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    function _base64Encode(bytes memory data) internal pure returns (string memory) {
        uint256 len = data.length;
        if (len == 0) return "";
        uint256 encodedLen = 4 * ((len + 2) / 3);
        bytes memory result = new bytes(encodedLen);
        uint256 i = 0;
        uint256 j = 0;
        while (i < len) {
            uint256 a = uint8(data[i]);
            uint256 b = i + 1 < len ? uint8(data[i + 1]) : 0;
            uint256 c = i + 2 < len ? uint8(data[i + 2]) : 0;
            result[j    ] = _TABLE[(a >> 2) & 63];
            result[j + 1] = _TABLE[((a << 4) | (b >> 4)) & 63];
            result[j + 2] = _TABLE[((b << 2) | (c >> 6)) & 63];
            result[j + 3] = _TABLE[c & 63];
            i += 3; j += 4;
        }
        if (len % 3 == 1) { result[encodedLen - 1] = 0x3d; result[encodedLen - 2] = 0x3d; }
        else if (len % 3 == 2) { result[encodedLen - 1] = 0x3d; }
        return string(result);
    }
}
