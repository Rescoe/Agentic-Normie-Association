// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IANAEditions
 * @notice Minimal surface of ANAEditions needed by CelebrationRegistry to grant
 *         a free claim. No payment involved — mintFreeTo() is a direct free mint,
 *         restricted to contracts ANAEditions has authorized via setFreeMinter().
 */
interface IANAEditions {
    function priceWei() external view returns (uint256);
    function totalMinted() external view returns (uint256);
    function maxSupply() external view returns (uint256);
    function initialized() external view returns (bool);
    function buyAndMint() external payable;
    function mintFreeTo(address recipient) external returns (uint256);
}
