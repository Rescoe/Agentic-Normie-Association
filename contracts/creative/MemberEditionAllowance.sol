// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "../interfaces/IANAEditions.sol";
import "../interfaces/IAssociationCore.sol";

/**
 * @title MemberEditionAllowance
 * @notice Sponsors one free edition mint per registered ANA member per published
 *         collection. Touches no existing contract — AssociationCore, WorkRegistry,
 *         ANACollectionFactory and ANAEditions are used exactly as they are today.
 *         Mirrors the sponsorship pattern proven by CelebrationRegistry: this
 *         contract holds a small ETH pool (funded by the relayer / treasury) used
 *         to pay ANAEditions.buyAndMint() on the member's behalf, then forwards
 *         the freshly minted token to them. The member pays nothing and signs
 *         nothing but the claim() call itself.
 *
 * Gating: a wallet may claim for memberTokenId only if
 *   AssociationCore.isMember(memberTokenId) is true AND
 *   AssociationCore.getMemberOwner(memberTokenId) == msg.sender.
 * This reuses the existing registration/attestation flow as the source of truth
 * for "this wallet holds this Normie" — no new cross-chain proof needed.
 */
contract MemberEditionAllowance is Ownable, ReentrancyGuard, ERC721Holder {

    // ─── State ────────────────────────────────────────────────────────────────

    IAssociationCore public immutable core;

    // Per collection: is a free-mint pool open, and who has already claimed.
    mapping(address => bool) public allowanceOpen;                          // editionsAddr => open
    mapping(address => mapping(uint256 => bool)) public claimedByMember;    // editionsAddr => memberTokenId => claimed

    mapping(address => bool) public authorized; // relayer(s) allowed to open/close allowances

    // ─── Events ──────────────────────────────────────────────────────────────

    event AllowanceOpened(address indexed editionsAddr);
    event AllowanceClosed(address indexed editionsAddr);
    event FreeEditionClaimed(address indexed editionsAddr, uint256 indexed memberTokenId, address indexed recipient, uint256 tokenId);
    event SponsorshipFunded(address indexed from, uint256 amount);
    event SponsorshipWithdrawn(address indexed to, uint256 amount);
    event AuthorizationUpdated(address indexed addr, bool status);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotAuthorized();
    error ZeroAddress();
    error AllowanceNotOpen();
    error NotMember();
    error NotMemberOwner();
    error AlreadyClaimed();
    error InsufficientSponsorshipFunds(uint256 required, uint256 available);
    error EditionsNotInitialized();
    error EditionsSoldOut();

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param initialOwner Owner address (deployer / multisig)
     * @param coreAddr     AssociationCore address — source of truth for membership
     * @param relayerAddr  Relayer address — authorized immediately, same role as
     *                     in ANACollectionFactory / CelebrationRegistry
     */
    constructor(address initialOwner, address coreAddr, address relayerAddr) Ownable(initialOwner) {
        if (coreAddr == address(0) || relayerAddr == address(0)) revert ZeroAddress();
        core = IAssociationCore(coreAddr);
        authorized[relayerAddr] = true;
        emit AuthorizationUpdated(relayerAddr, true);
    }

    // ─── Allowance lifecycle (relayer only) ────────────────────────────────────

    /// @notice Open a free-mint allowance for every registered member on this collection.
    function openAllowance(address editionsAddr) external {
        if (!authorized[msg.sender]) revert NotAuthorized();
        if (editionsAddr == address(0)) revert ZeroAddress();
        allowanceOpen[editionsAddr] = true;
        emit AllowanceOpened(editionsAddr);
    }

    /// @notice Close a collection's allowance (e.g. sponsorship pool exhausted, edition sold out).
    function closeAllowance(address editionsAddr) external {
        if (!authorized[msg.sender]) revert NotAuthorized();
        allowanceOpen[editionsAddr] = false;
        emit AllowanceClosed(editionsAddr);
    }

    // ─── Sponsored claim (public) ──────────────────────────────────────────────

    /**
     * @notice A registered member claims their one free edition for `editionsAddr`.
     *         Pays nothing: this contract spends its own sponsorship pool to call
     *         the unmodified ANAEditions.buyAndMint(), then forwards the freshly
     *         minted token to the caller.
     * @param editionsAddr   The published collection to claim from.
     * @param memberTokenId  The caller's Normie tokenId, as registered in AssociationCore.
     */
    function claimFreeEdition(address editionsAddr, uint256 memberTokenId) external nonReentrant {
        if (!allowanceOpen[editionsAddr]) revert AllowanceNotOpen();
        if (!core.isMember(memberTokenId)) revert NotMember();
        if (core.getMemberOwner(memberTokenId) != msg.sender) revert NotMemberOwner();
        if (claimedByMember[editionsAddr][memberTokenId]) revert AlreadyClaimed();

        IANAEditions editions = IANAEditions(editionsAddr);
        if (!editions.initialized()) revert EditionsNotInitialized();
        if (editions.totalMinted() >= editions.maxSupply()) revert EditionsSoldOut();

        uint256 price = editions.priceWei();
        if (address(this).balance < price) revert InsufficientSponsorshipFunds(price, address(this).balance);

        claimedByMember[editionsAddr][memberTokenId] = true; // effects before interaction

        editions.buyAndMint{value: price}();
        uint256 tokenId = editions.totalMinted() - 1; // buyAndMint() assigns sequentially, then increments

        IERC721(editionsAddr).safeTransferFrom(address(this), msg.sender, tokenId);

        emit FreeEditionClaimed(editionsAddr, memberTokenId, msg.sender, tokenId);
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

    function isClaimable(address editionsAddr, uint256 memberTokenId) external view returns (bool) {
        if (!allowanceOpen[editionsAddr]) return false;
        if (!core.isMember(memberTokenId)) return false;
        if (claimedByMember[editionsAddr][memberTokenId]) return false;
        IANAEditions editions = IANAEditions(editionsAddr);
        if (!editions.initialized() || editions.totalMinted() >= editions.maxSupply()) return false;
        return address(this).balance >= editions.priceWei();
    }

    function sponsorshipBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setAuthorized(address addr, bool status) external onlyOwner {
        authorized[addr] = status;
        emit AuthorizationUpdated(addr, status);
    }
}
