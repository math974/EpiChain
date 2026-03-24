// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {SmartAccount} from "./SmartAccount.sol";

/**
 * @title SmartAccountFactory
 * @notice Deploys SmartAccount instances deterministically via CREATE2.
 *
 * The counterfactual address can be computed off-chain before deployment,
 * which is essential for the ERC-4337 initCode flow — the bundler funds the
 * not-yet-deployed account so it can pay for its own deployment UserOperation.
 */
contract SmartAccountFactory {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    // -------------------------------------------------------------------------
    // Core functions
    // -------------------------------------------------------------------------

    /**
     * @notice Deploy a new SmartAccount for `owner` using `salt`.
     * @dev If the account already exists at the computed address, returns it
     *      without reverting — this is intentional and matches the ERC-4337
     *      factory convention used in initCode.
     * @param _owner The owner EOA for the new smart account.
     * @param salt   An arbitrary value chosen by the caller to derive the
     *               counterfactual address.
     * @return account The address of the deployed (or already-existing) account.
     */
    function createAccount(address _owner, uint256 salt) external returns (address account) {
        bytes32 create2Salt = _saltFor(_owner, salt);
        bytes memory bytecode = _creationBytecode(_owner);

        address predicted = _predict(bytecode, create2Salt);

        // If already deployed, return existing address without reverting.
        if (predicted.code.length > 0) {
            return predicted;
        }

        assembly {
            account := create2(0, add(bytecode, 0x20), mload(bytecode), create2Salt)
        }

        require(account != address(0), "SmartAccountFactory: deployment failed");
        emit AccountCreated(account, _owner, salt);
    }

    /**
     * @notice Compute the counterfactual address of the SmartAccount that
     *         would be deployed for the given `owner` and `salt`.
     * @param _owner The owner EOA.
     * @param salt   The salt used when creating the account.
     * @return The deterministic address.
     */
    function getAddress(address _owner, uint256 salt) external view returns (address) {
        bytes32 create2Salt = _saltFor(_owner, salt);
        bytes memory bytecode = _creationBytecode(_owner);
        return _predict(bytecode, create2Salt);
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    /**
     * @dev Derive a CREATE2 salt that binds both the owner address and the
     *      user-supplied salt together so different owners can use the same
     *      numeric salt without collision.
     */
    function _saltFor(address _owner, uint256 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_owner, salt));
    }

    function _creationBytecode(address _owner) internal pure returns (bytes memory) {
        return abi.encodePacked(type(SmartAccount).creationCode, abi.encode(_owner));
    }

    function _predict(bytes memory bytecode, bytes32 salt) internal view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(bytecode))
        );
        return address(uint160(uint256(hash)));
    }
}
