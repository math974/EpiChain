// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccount, PackedUserOperation} from "./interfaces/IAccount.sol";

contract SmartAccount is IAccount {
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
    uint8 internal constant OWNER_AUTH_MODE = 0;
    uint8 internal constant SESSION_AUTH_MODE = 1;

    address public immutable owner;
    address public immutable entryPoint;

    struct SessionConfig {
        uint48 expiry;
        bool active;
        bool allowAllSelectors;
        uint64 selectorSetId;
    }

    mapping(address sessionKey => SessionConfig config) public sessionConfigs;
    mapping(address sessionKey => mapping(uint64 setId => mapping(bytes4 selector => bool allowed)))
        private _selectorPermissions;

    event SessionKeyAdded(address indexed key, uint256 expiry);
    event SessionKeyRevoked(address indexed key);
    event Executed(address indexed target, uint256 value, bytes data);

    error NotEntryPoint();
    error NotOwnerOrSelf();
    error ZeroAddress();
    error InvalidSessionExpiry();
    error InvalidSignatureEncoding();
    error CallFailed(bytes revertData);

    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) revert NotEntryPoint();
        _;
    }

    modifier onlyOwnerOrSelf() {
        if (msg.sender != owner && msg.sender != address(this)) revert NotOwnerOrSelf();
        _;
    }

    constructor(address owner_, address entryPoint_) {
        if (owner_ == address(0) || entryPoint_ == address(0)) revert ZeroAddress();
        owner = owner_;
        entryPoint = entryPoint_;
    }

    function addSessionKey(
        address key,
        uint48 expiry,
        bytes4[] calldata allowedSelectors
    ) external onlyOwnerOrSelf {
        if (key == address(0)) revert ZeroAddress();
        if (expiry <= block.timestamp) revert InvalidSessionExpiry();

        SessionConfig storage config = sessionConfigs[key];
        config.selectorSetId += 1;
        config.expiry = expiry;
        config.active = true;
        config.allowAllSelectors = allowedSelectors.length == 0;

        if (!config.allowAllSelectors) {
            uint64 setId = config.selectorSetId;
            uint256 selectorCount = allowedSelectors.length;
            for (uint256 i = 0; i < selectorCount; i++) {
                _selectorPermissions[key][setId][allowedSelectors[i]] = true;
            }
        }

        emit SessionKeyAdded(key, expiry);
    }

    function revokeSessionKey(address key) external onlyOwnerOrSelf {
        SessionConfig storage config = sessionConfigs[key];
        config.active = false;
        config.expiry = 0;
        config.allowAllSelectors = false;
        config.selectorSetId += 1;

        emit SessionKeyRevoked(key);
    }

    function execute(address target, uint256 value, bytes calldata data) external onlyEntryPoint {
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        if (!success) revert CallFailed(returndata);
        emit Executed(target, value, data);
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        (uint8 authMode, bytes memory authSignature) = _decodeAuthSignature(userOp.signature);

        if (authMode == OWNER_AUTH_MODE) {
            bool signatureOk = _isValidSignature(owner, userOpHash, authSignature);
            validationData = signatureOk ? 0 : SIG_VALIDATION_FAILED;
        } else if (authMode == SESSION_AUTH_MODE) {
            address sessionSigner = _recoverSigner(userOpHash, authSignature);
            SessionConfig memory config = sessionConfigs[sessionSigner];

            // ERC-4337: no block.timestamp in validateUserOp (banned TIMESTAMP opcode). Use validUntil below.
            bool signatureOk = sessionSigner != address(0);
            bool sessionActive = config.active;
            bool callAllowed = _isSessionCallAllowed(userOp.callData, sessionSigner, config);

            if (!(signatureOk && sessionActive && callAllowed)) {
                validationData = SIG_VALIDATION_FAILED;
            } else {
                validationData = _packValidationData(false, config.expiry, 0);
            }
        } else {
            validationData = SIG_VALIDATION_FAILED;
        }

        _payPrefund(missingAccountFunds);
    }

    function isSelectorAllowed(
        address sessionKey,
        bytes4 selector
    ) external view returns (bool allowed) {
        SessionConfig memory config = sessionConfigs[sessionKey];
        if (!config.active || block.timestamp > config.expiry) return false;
        if (config.allowAllSelectors) return true;
        return _selectorPermissions[sessionKey][config.selectorSetId][selector];
    }

    receive() external payable {}

    function _decodeAuthSignature(
        bytes calldata encoded
    ) private pure returns (uint8 authMode, bytes memory authSignature) {
        if (encoded.length == 0) revert InvalidSignatureEncoding();
        (authMode, authSignature) = abi.decode(encoded, (uint8, bytes));
        if (authSignature.length != 65) revert InvalidSignatureEncoding();
    }

    function _isSessionCallAllowed(
        bytes calldata callData,
        address sessionKey,
        SessionConfig memory config
    ) private view returns (bool) {
        if (sessionKey == address(0)) return false;
        if (!config.active) return false;
        if (callData.length < 4) return false;

        bytes4 outerSelector = bytes4(callData[:4]);
        if (outerSelector != this.execute.selector) return false;

        (address target, uint256 value, bytes memory innerData) = abi.decode(
            callData[4:],
            (address, uint256, bytes)
        );
        target;
        if (value != 0) return false;
        if (innerData.length < 4) return false;

        bytes4 innerSelector;
        assembly {
            innerSelector := mload(add(innerData, 0x20))
        }

        if (config.allowAllSelectors) return true;
        return _selectorPermissions[sessionKey][config.selectorSetId][innerSelector];
    }

    function _payPrefund(uint256 missingAccountFunds) private {
        if (missingAccountFunds == 0) return;
        (bool ok, ) = payable(msg.sender).call{value: missingAccountFunds}("");
        ok;
    }

    function _isValidSignature(
        address signer,
        bytes32 userOpHash,
        bytes memory signature
    ) private pure returns (bool) {
        return
            _recoverSigner(userOpHash, signature) == signer ||
            _recoverSigner(_toEthSignedMessageHash(userOpHash), signature) == signer;
    }

    function _recoverSigner(
        bytes32 digest,
        bytes memory signature
    ) private pure returns (address recovered) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);

        recovered = ecrecover(digest, v, r, s);
    }

    function _toEthSignedMessageHash(bytes32 hash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _packValidationData(
        bool sigFailed,
        uint48 validUntil,
        uint48 validAfter
    ) private pure returns (uint256) {
        return
            (sigFailed ? SIG_VALIDATION_FAILED : 0) |
            (uint256(validUntil) << 160) |
            (uint256(validAfter) << 208);
    }
}
