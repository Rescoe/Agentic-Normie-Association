// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAssociationCore.sol";
import "../lib/Roles.sol";

/**
 * @title TreasuryModule
 * @notice ANA's on-chain treasury. Receives ETH from work sales and
 *         distributes it to role holders according to defined allocations.
 *
 *  Allocation model (basis points, total = 10000 = 100%):
 *   - RAPPORTEUR : 2500 (25%) — primary creative publisher
 *   - AUTHOR     : 2000 (20%) — work creator
 *   - CURATOR    : 1500 (15%) — aesthetic direction
 *   - PRESIDENT  : 1000 (10%) — institutional
 *   - VICE_PRESIDENT: 500 (5%) — treasury steward
 *   - SECRETARY  : 500  (5%)  — institutional
 *   - Association reserve: 2000 (20%) — stays in treasury
 *
 *  Pull pattern: role holders call withdraw() to claim their share.
 *  Revenue is split atomically at receiveRevenue() call time.
 *
 *  Access: linked to AssociationCore to resolve current role holders.
 *          Can be redeployed without touching Core.
 */
contract TreasuryModule is Ownable {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant BPS_TOTAL = 10_000;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    IAssociationCore public immutable core;

    // role → allocation in basis points
    mapping(bytes32 => uint256) public roleAllocations;

    // address → claimable ETH balance (pending withdrawal)
    mapping(address => uint256) public pendingWithdrawals;

    // Association reserve — stays in contract, owner-governed
    uint256 public reserveBalance;

    uint256 public totalReceived;
    uint256 public totalDistributed;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event RevenueReceived(uint256 amount, uint256 timestamp);
    event RevenueDistributed(uint256 amount, uint256 toRoles, uint256 toReserve);
    event Withdrawal(address indexed recipient, uint256 amount);
    event AllocationUpdated(bytes32 indexed role, uint256 bps);
    event ReserveWithdrawn(address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error InvalidCore();
    error NothingToWithdraw();
    error TransferFailed();
    error InvalidAllocation();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _core) Ownable(msg.sender) {
        if (_core == address(0)) revert InvalidCore();
        core = IAssociationCore(_core);

        // Default allocations
        roleAllocations[Roles.RAPPORTEUR]     = 2500;
        roleAllocations[Roles.AUTHOR]         = 2000;
        roleAllocations[Roles.CURATOR]        = 1500;
        roleAllocations[Roles.PRESIDENT]      = 1000;
        roleAllocations[Roles.VICE_PRESIDENT] =  500;
        roleAllocations[Roles.SECRETARY]      =  500;
        // Remaining 2000 bps → reserve
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Revenue reception
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Receive ETH revenue (e.g. from work sales).
     *         Splits immediately to role holders + reserve.
     */
    receive() external payable {
        _distribute(msg.value);
    }

    function receiveRevenue() external payable {
        _distribute(msg.value);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Withdrawal (pull pattern)
    // ─────────────────────────────────────────────────────────────────────────

    /** @notice Role holder claims their accumulated share. */
    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawal(msg.sender, amount);
    }

    /** @notice Owner can withdraw the association reserve. */
    function withdrawReserve(address to, uint256 amount) external onlyOwner {
        if (amount > reserveBalance) revert NothingToWithdraw();
        reserveBalance -= amount;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit ReserveWithdrawn(to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Configuration (owner only)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Update role allocation. Total of all role allocations must not exceed 8000 bps
     *         (remaining 2000 bps minimum goes to reserve).
     */
    function setAllocation(bytes32 role, uint256 bps) external onlyOwner {
        roleAllocations[role] = bps;
        uint256 total = _totalRoleBps();
        if (total > 8000) revert InvalidAllocation(); // min 20% to reserve
        emit AllocationUpdated(role, bps);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getAllRoleAllocations() external view returns (
        bytes32[] memory roles_,
        uint256[] memory bps_
    ) {
        roles_ = new bytes32[](6);
        bps_   = new uint256[](6);
        roles_[0] = Roles.PRESIDENT;      bps_[0] = roleAllocations[Roles.PRESIDENT];
        roles_[1] = Roles.VICE_PRESIDENT; bps_[1] = roleAllocations[Roles.VICE_PRESIDENT];
        roles_[2] = Roles.SECRETARY;      bps_[2] = roleAllocations[Roles.SECRETARY];
        roles_[3] = Roles.AUTHOR;         bps_[3] = roleAllocations[Roles.AUTHOR];
        roles_[4] = Roles.CURATOR;        bps_[4] = roleAllocations[Roles.CURATOR];
        roles_[5] = Roles.RAPPORTEUR;     bps_[5] = roleAllocations[Roles.RAPPORTEUR];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _distribute(uint256 amount) internal {
        if (amount == 0) return;
        totalReceived += amount;

        bytes32[6] memory roles = [
            Roles.PRESIDENT, Roles.VICE_PRESIDENT, Roles.SECRETARY,
            Roles.AUTHOR, Roles.CURATOR, Roles.RAPPORTEUR
        ];

        uint256 distributed = 0;
        for (uint256 i = 0; i < roles.length; i++) {
            bytes32 role = roles[i];
            uint256 bps  = roleAllocations[role];
            if (bps == 0) continue;

            IAssociationCore.RoleAssignment memory ra = core.getRoleHolder(role);
            if (ra.holderAddress == address(0)) continue;

            uint256 share = (amount * bps) / BPS_TOTAL;
            pendingWithdrawals[ra.holderAddress] += share;
            distributed += share;
        }

        uint256 toReserve = amount - distributed;
        reserveBalance += toReserve;
        totalDistributed += distributed;

        emit RevenueReceived(amount, block.timestamp);
        emit RevenueDistributed(amount, distributed, toReserve);
    }

    function _totalRoleBps() internal view returns (uint256 total) {
        total = roleAllocations[Roles.PRESIDENT]
              + roleAllocations[Roles.VICE_PRESIDENT]
              + roleAllocations[Roles.SECRETARY]
              + roleAllocations[Roles.AUTHOR]
              + roleAllocations[Roles.CURATOR]
              + roleAllocations[Roles.RAPPORTEUR];
    }
}
