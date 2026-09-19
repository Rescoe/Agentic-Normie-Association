// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockAssociationCore
 * @notice Test-only stand-in for AssociationCore — settable getMemberOwner(),
 *         nothing else. Lets ANAMemorials tests exercise creator-address
 *         resolution (including the zero-address/relayer-fallback case)
 *         without depending on AssociationCore's own registration flow.
 */
contract MockAssociationCore {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 tokenId, address owner_) external {
        owners[tokenId] = owner_;
    }

    function getMemberOwner(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }

    function isMember(uint256 tokenId) external view returns (bool) {
        return owners[tokenId] != address(0);
    }
}
