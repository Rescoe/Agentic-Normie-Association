// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IANAEditions
 * @notice Minimal surface of ANAEditions needed by CelebrationRegistry to sponsor
 *         a free claim without modifying ANAEditions itself.
 */
interface IANAEditions {
    function priceWei() external view returns (uint256);
    function totalMinted() external view returns (uint256);
    function maxSupply() external view returns (uint256);
    function initialized() external view returns (bool);
    function buyAndMint() external payable;
}
