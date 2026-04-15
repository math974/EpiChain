// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Demo target contract for the smart-account flow.
/// Each caller (smart account) has an independent counter.
contract Counter {
    mapping(address account => uint256 value) private _counts;

    function increment() external {
        unchecked {
            _counts[msg.sender] += 1;
        }
    }

    function getCount(address account) external view returns (uint256) {
        return _counts[account];
    }
}
