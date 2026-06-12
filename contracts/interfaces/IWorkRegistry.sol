// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWorkRegistry {
    function publish(
        string calldata content,
        uint256 authorTokenId,
        uint256 curatorTokenId,
        uint256 rapporteurTokenId
    ) external;

    function archive(uint256 workId) external;
    function initiateWorkSession() external;
    function setSchedule(uint256 nextCreationAt, uint256 periodSeconds, bool active) external;
    function getWorkCount() external view returns (uint256);
}
