// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IAccount
 * @notice ERC-4337 IAccount interface (EntryPoint v0.7 compatible)
 */
interface IAccount {
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);
}

/**
 * @dev Minimal PackedUserOperation struct as defined by EntryPoint v0.7
 */
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}
