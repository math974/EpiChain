// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title Counter
 * @notice Demo target contract for the EpiChain smart account system.
 *
 * Each smart account (sender address) has its own independent counter.
 * Designed to be called via SmartAccount.execute() so that the counter
 * is incremented on behalf of the smart account address, not the EOA.
 */
contract Counter {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Per-account counters.  Key is the smart account address.
    mapping(address => uint256) private _counts;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event Incremented(address indexed account, uint256 newCount);

    // -------------------------------------------------------------------------
    // Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Increment the caller's counter by 1.
     * @dev When called via SmartAccount.execute(), msg.sender is the smart
     *      account contract address, so each smart account gets its own slot.
     */
    function increment() external {
        _counts[msg.sender] += 1;
        emit Incremented(msg.sender, _counts[msg.sender]);
    }

    /**
     * @notice Get the current counter value for `account`.
     * @param account The smart account address to query.
     */
    function getCount(address account) external view returns (uint256) {
        return _counts[account];
    }
}
