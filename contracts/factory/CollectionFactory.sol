// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAssociationCore.sol";
import "../lib/Roles.sol";
import "./NormieCollection.sol";

/**
 * @title CollectionFactory
 * @notice Deploys NormieCollection instances for elected Normies.
 *
 *  Only Normies holding an active ANA role can create a collection.
 *  (Checked via AssociationCore — msg.sender must be the role holder's address.)
 *
 *  Registration: this factory must be registered in FactoryRegistry with
 *  type COLLECTION_TYPE. Collections are tracked per normieTokenId.
 */
contract CollectionFactory is Ownable {

    bytes32 public constant COLLECTION_TYPE = keccak256("NORMIE_COLLECTION");

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IAssociationCore public immutable core;

    // normieTokenId => list of collections created by that Normie
    mapping(uint256 => address[]) public normieCollections;

    // all deployed collection addresses
    address[] public allCollections;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event CollectionCreated(
        uint256 indexed normieTokenId,
        address indexed collection,
        string  name,
        string  symbol,
        address minter,
        uint256 timestamp
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error NotAMember(uint256 tokenId);
    error CallerNotHolder(uint256 tokenId, address caller, address holder);
    error InvalidCore();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _core) Ownable(msg.sender) {
        if (_core == address(0)) revert InvalidCore();
        core = IAssociationCore(_core);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Factory
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Create a new on-chain collection for a Normie member.
     * @param normieTokenId The Normie's token ID (must be a registered member)
     * @param name          ERC-721 name for the collection
     * @param symbol        ERC-721 symbol
     * @return collection   Address of the deployed NormieCollection
     */
    function createCollection(
        uint256 normieTokenId,
        string calldata name,
        string calldata symbol
    ) external returns (address collection) {
        if (!core.isMember(normieTokenId)) revert NotAMember(normieTokenId);

        // The association's relayer is authorized to deploy collections on behalf of any
        // elected member, enabling the autonomous pipeline to publish + mint in one tx sequence.
        address holder  = core.getMemberOwner(normieTokenId);
        address relayer = IAssociationCore(address(core)).relayerAddress();
        if (msg.sender != holder && msg.sender != relayer)
            revert CallerNotHolder(normieTokenId, msg.sender, holder);

        NormieCollection col = new NormieCollection(name, symbol, normieTokenId, msg.sender);
        collection = address(col);

        normieCollections[normieTokenId].push(collection);
        allCollections.push(collection);

        emit CollectionCreated(normieTokenId, collection, name, symbol, msg.sender, block.timestamp);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getCollectionsOf(uint256 normieTokenId) external view returns (address[] memory) {
        return normieCollections[normieTokenId];
    }

    function getAllCollections() external view returns (address[] memory) {
        return allCollections;
    }

    function getCollectionCount() external view returns (uint256) {
        return allCollections.length;
    }
}
