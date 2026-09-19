// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../creative/ANAMemorials.sol";

/**
 * @title ANAMemorialsAttacker
 * @notice Test-only mock. Two behaviors, controlled by `mode`:
 *  - "revert": always reverts on receive() — used to prove a bad creator/vault
 *    payout address gets escrowed (pendingWithdrawals) instead of bricking the mint.
 *  - "reenter": attempts to call back into ANAMemorials.mintPublic() from receive()
 *    — used to prove ReentrancyGuard blocks it.
 * Never deployed outside the test suite.
 */
contract ANAMemorialsAttacker {
    ANAMemorials public target;
    string public mode;
    uint256 public reenterMemorialId;

    constructor(address target_) {
        target = ANAMemorials(target_);
    }

    function setMode(string calldata mode_) external {
        mode = mode_;
    }

    function setReenterMemorialId(uint256 id) external {
        reenterMemorialId = id;
    }

    function callMintPublic(uint256 memorialId) external payable {
        target.mintPublic{value: msg.value}(memorialId);
    }

    function callWithdraw() external {
        target.withdraw();
    }

    receive() external payable {
        if (keccak256(bytes(mode)) == keccak256(bytes("revert"))) {
            revert("ANAMemorialsAttacker: refusing payment");
        }
        if (keccak256(bytes(mode)) == keccak256(bytes("reenter"))) {
            // Deliberately ignores return value — this is expected to revert
            // (ReentrancyGuard), which must NOT bubble up and break the outer
            // call's own accounting.
            try target.mintPublic{value: 0}(reenterMemorialId) {} catch {}
        }
    }
}
