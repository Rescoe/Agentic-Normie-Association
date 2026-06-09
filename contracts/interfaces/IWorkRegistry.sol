// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWorkRegistry {
    function publish(
        string calldata ipfsHash,
        uint256 authorTokenId,
        uint256 curatorTokenId,
        uint256 rapporteurTokenId
    ) external;

    function archive(uint256 workId) external;
    function getWorkCount() external view returns (uint256);
}
