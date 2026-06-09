// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IConstituentAssembly {
    function openSession() external;
    function closeSession() external;
    function castVote(uint256 voterTokenId, bytes32 role, uint256 candidateTokenId) external;
    function getVoteCount(bytes32 role, uint256 candidateTokenId) external view returns (uint256);
    function getLeader(bytes32 role) external view returns (uint256 tokenId, uint256 count);
    function getCandidates(bytes32 role) external view returns (uint256[] memory);
    function hasVoted(uint256 voterTokenId, bytes32 role) external view returns (bool);
    function getElectableRoles() external view returns (bytes32[] memory);
}
