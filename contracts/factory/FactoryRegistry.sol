// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IFactoryRegistry.sol";

/**
 * @title FactoryRegistry
 * @notice Master registry of all factories authorized to deploy ANA modules.
 *
 *  Purpose: act as the orchestration layer between AssociationCore and
 *  specialized sub-factories (CollectionFactory, CreativeModuleFactory, etc.).
 *  New factory types can be registered at any time without modifying the Core.
 *
 *  Factory types are identified by bytes32 keys, e.g.:
 *   - keccak256("CREATIVE")    → CreativeModuleFactory
 *   - keccak256("COLLECTION")  → CollectionFactory (future)
 *   - keccak256("GOVERNANCE")  → GovernanceModuleFactory (future)
 *   - keccak256("EVENT")       → EventFactory (future)
 */
contract FactoryRegistry is IFactoryRegistry, Ownable {

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    mapping(bytes32 => address) public factories;
    bytes32[]                   public registeredTypes;
    mapping(bytes32 => bool)    private _typeExists;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event FactoryRegistered(bytes32 indexed factoryType, address indexed factory);
    event FactoryUpdated(bytes32 indexed factoryType, address indexed oldFactory, address indexed newFactory);
    event FactoryRemoved(bytes32 indexed factoryType);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error InvalidFactory();
    error InvalidFactoryType();

    // ─────────────────────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Mutating
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Register or update a factory for a given type.
     * @dev Can be called multiple times to upgrade a factory (e.g. bug fix).
     */
    function registerFactory(bytes32 factoryType, address factory) external onlyOwner {
        if (factory == address(0)) revert InvalidFactory();
        if (factoryType == bytes32(0)) revert InvalidFactoryType();

        if (!_typeExists[factoryType]) {
            registeredTypes.push(factoryType);
            _typeExists[factoryType] = true;
            emit FactoryRegistered(factoryType, factory);
        } else {
            emit FactoryUpdated(factoryType, factories[factoryType], factory);
        }
        factories[factoryType] = factory;
    }

    /// @notice Remove a factory (sets to address(0) — type stays in registeredTypes)
    function removeFactory(bytes32 factoryType) external onlyOwner {
        emit FactoryRemoved(factoryType);
        factories[factoryType] = address(0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getFactory(bytes32 factoryType) external view returns (address) {
        return factories[factoryType];
    }

    function listFactories()
        external view
        returns (bytes32[] memory types, address[] memory addrs)
    {
        types = registeredTypes;
        addrs = new address[](registeredTypes.length);
        for (uint256 i = 0; i < registeredTypes.length; i++) {
            addrs[i] = factories[registeredTypes[i]];
        }
    }
}
