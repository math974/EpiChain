// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IAccount, PackedUserOperation} from "./interfaces/IAccount.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SmartAccount
 * @notice ERC-4337 compliant smart account with ECDSA and session key authentication.
 *
 * Authentication methods:
 *   1. ECDSA — the account owner signs UserOperations with their EOA private key.
 *   2. Session keys — secondary addresses granted temporary, scoped execution rights.
 *
 * Session key scoping:
 *   - Allowed function selectors (empty set = allow all)
 *   - Time-based expiry
 *   - Revokable by owner at any time
 */
contract SmartAccount is IAccount {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @dev EntryPoint v0.7 address on all networks.
    address public constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    /// @dev ERC-4337 validation success sentinel.
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;

    /// @dev ERC-4337 validation failure sentinel.
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice The owner EOA that controls this account.
    address public owner;

    /// @notice Nonce used to prevent UserOperation replay.
    uint256 public nonce;

    struct SessionKey {
        /// Whether the key has been registered by the owner.
        bool active;
        /// Unix timestamp after which the key is invalid (0 = no expiry).
        uint256 expiry;
        /// Allowed function selectors. Empty means all selectors are allowed.
        bytes4[] allowedSelectors;
        /// Whether the key has been explicitly revoked.
        bool revoked;
    }

    /// @notice Registered session keys.
    mapping(address => SessionKey) public sessionKeys;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event SessionKeyAdded(address indexed key, uint256 expiry);
    event SessionKeyRevoked(address indexed key);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address _owner) {
        require(_owner != address(0), "SmartAccount: zero owner");
        owner = _owner;
    }

    // -------------------------------------------------------------------------
    // ERC-4337 — IAccount
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc IAccount
     * @dev Validates a UserOperation. Called exclusively by the EntryPoint.
     *
     * The signature field encodes who is signing:
     *   - If the first byte is 0x00, the remaining bytes are an ECDSA signature
     *     from the owner.
     *   - If the first byte is 0x01, the next 20 bytes are the session key
     *     address and the remaining bytes are the ECDSA signature from that
     *     session key.
     *
     * Returns SIG_VALIDATION_SUCCESS (0) on success, SIG_VALIDATION_FAILED (1)
     * on failure, or a packed (validAfter, validUntil) if time-bounds apply.
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override returns (uint256 validationData) {
        require(msg.sender == ENTRY_POINT, "SmartAccount: not EntryPoint");

        // Repay missing funds to the EntryPoint.
        if (missingAccountFunds > 0) {
            (bool ok, ) = payable(ENTRY_POINT).call{value: missingAccountFunds}("");
            require(ok, "SmartAccount: prefund failed");
        }

        bytes calldata sig = userOp.signature;
        require(sig.length > 0, "SmartAccount: empty signature");

        uint8 authMode = uint8(sig[0]);

        if (authMode == 0x00) {
            // --- ECDSA owner validation ---
            bytes memory ecdsaSig = sig[1:];
            address recovered = userOpHash.toEthSignedMessageHash().recover(ecdsaSig);
            if (recovered != owner) {
                return SIG_VALIDATION_FAILED;
            }
            return SIG_VALIDATION_SUCCESS;
        } else if (authMode == 0x01) {
            // --- Session key validation ---
            require(sig.length >= 21, "SmartAccount: short session sig");
            address sessionKeyAddr = address(bytes20(sig[1:21]));
            bytes memory ecdsaSig = sig[21:];

            // Verify the session key actually signed the hash.
            address recovered = userOpHash.toEthSignedMessageHash().recover(ecdsaSig);
            if (recovered != sessionKeyAddr) {
                return SIG_VALIDATION_FAILED;
            }

            SessionKey storage sk = sessionKeys[sessionKeyAddr];

            // Key must be registered and not revoked.
            if (!sk.active || sk.revoked) {
                return SIG_VALIDATION_FAILED;
            }

            // Check selector restriction (only for non-empty call data).
            if (sk.allowedSelectors.length > 0 && userOp.callData.length >= 4) {
                bytes4 selector = bytes4(userOp.callData[0:4]);
                if (!_isSelectorAllowed(sk.allowedSelectors, selector)) {
                    return SIG_VALIDATION_FAILED;
                }
            }

            // Pack time-bounds into validationData if expiry is set.
            if (sk.expiry != 0) {
                // validationData = (validUntil << 160) | (validAfter << 208)
                // validAfter = 0, validUntil = sk.expiry
                uint256 validUntil = sk.expiry;
                return (validUntil << 160);
            }

            return SIG_VALIDATION_SUCCESS;
        }

        return SIG_VALIDATION_FAILED;
    }

    // -------------------------------------------------------------------------
    // Execution
    // -------------------------------------------------------------------------

    /**
     * @notice Execute a call on behalf of this smart account.
     * @dev Can only be called by the EntryPoint (after validation) or the owner
     *      directly (for convenience during testing).
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external {
        require(
            msg.sender == ENTRY_POINT || msg.sender == owner,
            "SmartAccount: unauthorized"
        );
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    // -------------------------------------------------------------------------
    // Session key management
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new session key.
     * @param key          The session key address.
     * @param expiry       Unix timestamp of expiry (0 = no expiry).
     * @param selectors    Allowed function selectors (empty = allow all).
     */
    function addSessionKey(
        address key,
        uint256 expiry,
        bytes4[] calldata selectors
    ) external {
        require(msg.sender == owner, "SmartAccount: not owner");
        require(key != address(0), "SmartAccount: zero key");

        sessionKeys[key] = SessionKey({
            active: true,
            expiry: expiry,
            allowedSelectors: selectors,
            revoked: false
        });

        emit SessionKeyAdded(key, expiry);
    }

    /**
     * @notice Revoke a previously registered session key.
     * @param key The session key address to revoke.
     */
    function revokeSessionKey(address key) external {
        require(msg.sender == owner, "SmartAccount: not owner");
        sessionKeys[key].revoked = true;
        emit SessionKeyRevoked(key);
    }

    /**
     * @notice Check if a selector is in the allowed list.
     */
    function isSessionKeyAllowed(address key, bytes4 selector) external view returns (bool) {
        SessionKey storage sk = sessionKeys[key];
        if (!sk.active || sk.revoked) return false;
        if (sk.expiry != 0 && block.timestamp > sk.expiry) return false;
        if (sk.allowedSelectors.length == 0) return true;
        return _isSelectorAllowed(sk.allowedSelectors, selector);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _isSelectorAllowed(
        bytes4[] storage allowed,
        bytes4 selector
    ) internal view returns (bool) {
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == selector) return true;
        }
        return false;
    }

    /// @dev Allow receiving ETH (e.g. prefund from bundler).
    receive() external payable {}
}
