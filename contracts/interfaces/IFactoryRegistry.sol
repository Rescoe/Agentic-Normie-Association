// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFactoryRegistry {
    function registerFactory(bytes32 factoryType, address factory) external;
    function getFactory(bytes32 factoryType) external view returns (address);
    function listFactories() external view returns (bytes32[] memory types, address[] memory addrs);
}
