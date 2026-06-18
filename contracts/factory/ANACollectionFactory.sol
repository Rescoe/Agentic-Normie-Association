// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../editions/ANAEditions.sol";

/**
 * @title ANACollectionFactory
 * @notice Deploys ANAEditions contracts on behalf of Normies.
 *
 * A Normie can have multiple collections (by theme, by salon, etc.).
 * Collections are tracked by normieTokenId.
 *
 * Authorization model (evolves over time):
 *  - Now:    relayer is authorized, creates all collections automatically
 *  - Future: each Normie wallet is authorized to create their own collections
 *
 * The factory is registered in FactoryRegistry under keccak256("ANA_EDITIONS")
 * so the frontend can discover the factory address without hardcoding it.
 *
 * Default revenue split (if not specified):
 *  Author 60% — Curator 20% — Rapporteur 10% — Association 10%
 */
contract ANACollectionFactory is Ownable {

    // ─── State ───────────────────────────────────────────────────────────────

    address public associationAddr;

    mapping(address => bool)       public authorized;
    mapping(uint256 => address[])  public collectionsByNormie;
    address[]                      public allCollections;

    // Default percentages — overridable per collection
    uint8 public defaultAuthorPct     = 60;
    uint8 public defaultCuratorPct    = 20;
    uint8 public defaultRapporteurPct = 10;

    // ─── Events ──────────────────────────────────────────────────────────────

    event CollectionDeployed(
        uint256 indexed normieTokenId,
        address indexed collectionAddr,
        string  name,
        address minter
    );
    event AuthorizationUpdated(address indexed addr, bool status);
    event DefaultPctUpdated(uint8 authorPct, uint8 curatorPct, uint8 rapporteurPct);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotAuthorized();
    error ZeroAddress();
    error PctOverflow();

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param initialOwner   Owner address (deployer / multisig)
     * @param relayerAddr    Relayer address — authorized immediately
     * @param associationAddr_ ANA vault address (default revenue recipient for association share)
     */
    constructor(
        address initialOwner,
        address relayerAddr,
        address associationAddr_
    ) Ownable(initialOwner) {
        if (relayerAddr == address(0) || associationAddr_ == address(0)) revert ZeroAddress();
        associationAddr = associationAddr_;
        authorized[relayerAddr] = true;
        emit AuthorizationUpdated(relayerAddr, true);
    }

    // ─── Collection creation ─────────────────────────────────────────────────

    /**
     * @notice Deploy a new ANAEditions collection for a Normie.
     *
     * @param normieTokenId     Creator's Normie token ID
     * @param name              Collection name (e.g. "Salon d'automne 2025")
     * @param symbol            ERC-721 symbol (e.g. "SAUT")
     * @param minter_           Address that can call ANAEditions.mint() (= caller for now)
     * @param authorAddr_       Revenue address for AUTHOR role
     * @param curatorAddr_      Revenue address for CURATOR role
     * @param rapporteurAddr_   Revenue address for RAPPORTEUR role
     * @param authorPct_        Author %, 0 = use default
     * @param curatorPct_       Curator %, 0 = use default (only when authorPct_ > 0)
     * @param rapporteurPct_    Rapporteur %, 0 = use default (only when authorPct_ > 0)
     */
    function createCollection(
        uint256 normieTokenId,
        string  calldata name,
        string  calldata symbol,
        address minter_,
        address authorAddr_,
        address curatorAddr_,
        address rapporteurAddr_,
        uint8   authorPct_,
        uint8   curatorPct_,
        uint8   rapporteurPct_
    ) external returns (address) {
        if (!authorized[msg.sender]) revert NotAuthorized();
        if (minter_ == address(0)) revert ZeroAddress();

        uint8 aPct = authorPct_ > 0 ? authorPct_ : defaultAuthorPct;
        uint8 cPct = authorPct_ > 0 ? curatorPct_ : defaultCuratorPct;
        uint8 rPct = authorPct_ > 0 ? rapporteurPct_ : defaultRapporteurPct;

        if (uint16(aPct) + uint16(cPct) + uint16(rPct) > 100) revert PctOverflow();

        ANAEditions coll = new ANAEditions(
            name,
            symbol,
            normieTokenId,
            minter_,
            authorAddr_,
            curatorAddr_,
            rapporteurAddr_,
            associationAddr,
            aPct,
            cPct,
            rPct
        );

        // Transfer ownership of the collection to the factory owner (= multisig / owner)
        // so admin functions (setMinter, setAuthorAddr, etc.) are protected.
        coll.transferOwnership(owner());

        address collAddr = address(coll);
        collectionsByNormie[normieTokenId].push(collAddr);
        allCollections.push(collAddr);

        emit CollectionDeployed(normieTokenId, collAddr, name, minter_);
        return collAddr;
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function getCollectionsByNormie(uint256 normieTokenId)
        external view returns (address[] memory)
    {
        return collectionsByNormie[normieTokenId];
    }

    function getLastCollection(uint256 normieTokenId)
        external view returns (address)
    {
        address[] storage c = collectionsByNormie[normieTokenId];
        if (c.length == 0) return address(0);
        return c[c.length - 1];
    }

    function getAllCollections() external view returns (address[] memory) {
        return allCollections;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setAuthorized(address addr, bool status) external onlyOwner {
        authorized[addr] = status;
        emit AuthorizationUpdated(addr, status);
    }

    function setAssociationAddr(address addr) external onlyOwner {
        if (addr == address(0)) revert ZeroAddress();
        associationAddr = addr;
    }

    function setDefaultPct(uint8 authorPct_, uint8 curatorPct_, uint8 rapporteurPct_) external onlyOwner {
        if (uint16(authorPct_) + uint16(curatorPct_) + uint16(rapporteurPct_) > 100) revert PctOverflow();
        defaultAuthorPct     = authorPct_;
        defaultCuratorPct    = curatorPct_;
        defaultRapporteurPct = rapporteurPct_;
        emit DefaultPctUpdated(authorPct_, curatorPct_, rapporteurPct_);
    }
}
