// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Counter} from "../src/Counter.sol";
import {SmartAccount} from "../src/SmartAccount.sol";
import {PackedUserOperation} from "../src/interfaces/IAccount.sol";

contract SmartAccountTest is Test {
    uint256 internal constant OWNER_PRIVATE_KEY = 0xA11CE;
    uint256 internal constant SESSION_PRIVATE_KEY = 0xB0B;

    address internal owner;
    address internal entryPoint;
    address internal sessionKey;

    SmartAccount internal account;
    Counter internal counter;

    function setUp() public {
        owner = vm.addr(OWNER_PRIVATE_KEY);
        entryPoint = makeAddr("entryPoint");
        sessionKey = vm.addr(SESSION_PRIVATE_KEY);

        account = new SmartAccount(owner, entryPoint);
        counter = new Counter();
    }

    function test_OwnerValidationSucceeds() public {
        bytes memory callData = _buildExecuteCall(
            address(counter),
            abi.encodeCall(Counter.increment, ())
        );
        bytes32 userOpHash = keccak256("owner-op");

        PackedUserOperation memory userOp = _buildUserOp(
            callData,
            _buildEncodedSignature(0, OWNER_PRIVATE_KEY, userOpHash)
        );

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        assertEq(validationData, 0);
    }

    function test_SessionValidationSucceedsForAllowedSelector() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = Counter.increment.selector;

        vm.prank(owner);
        account.addSessionKey(sessionKey, expiry, selectors);

        bytes memory callData = _buildExecuteCall(
            address(counter),
            abi.encodeCall(Counter.increment, ())
        );
        bytes32 userOpHash = keccak256("session-op");

        PackedUserOperation memory userOp = _buildUserOp(
            callData,
            _buildEncodedSignature(1, SESSION_PRIVATE_KEY, userOpHash)
        );

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        assertTrue(validationData != 1, "session signature should be valid");
        uint48 validUntil = uint48(validationData >> 160);
        assertEq(validUntil, expiry);
    }

    function test_SessionValidationFailsForDisallowedSelector() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = Counter.increment.selector;

        vm.prank(owner);
        account.addSessionKey(sessionKey, expiry, selectors);

        bytes memory callData = _buildExecuteCall(
            address(account),
            abi.encodeCall(SmartAccount.revokeSessionKey, (sessionKey))
        );
        bytes32 userOpHash = keccak256("session-disallowed");

        PackedUserOperation memory userOp = _buildUserOp(
            callData,
            _buildEncodedSignature(1, SESSION_PRIVATE_KEY, userOpHash)
        );

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        assertEq(validationData, 1);
    }

    function test_SessionValidationAfterExpiryStillReturnsValidUntilPacked() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = Counter.increment.selector;

        vm.prank(owner);
        account.addSessionKey(sessionKey, expiry, selectors);

        vm.warp(expiry + 1);

        bytes memory callData = _buildExecuteCall(
            address(counter),
            abi.encodeCall(Counter.increment, ())
        );
        bytes32 userOpHash = keccak256("session-expired");

        PackedUserOperation memory userOp = _buildUserOp(
            callData,
            _buildEncodedSignature(1, SESSION_PRIVATE_KEY, userOpHash)
        );

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        assertTrue(validationData != 1, "account packs validUntil; EntryPoint rejects if too late");
        uint48 validUntil = uint48(validationData >> 160);
        assertEq(validUntil, expiry);
    }

    function test_SessionValidationFailsWhenRevoked() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = Counter.increment.selector;

        vm.startPrank(owner);
        account.addSessionKey(sessionKey, expiry, selectors);
        account.revokeSessionKey(sessionKey);
        vm.stopPrank();

        bytes memory callData = _buildExecuteCall(
            address(counter),
            abi.encodeCall(Counter.increment, ())
        );
        bytes32 userOpHash = keccak256("session-revoked");

        PackedUserOperation memory userOp = _buildUserOp(
            callData,
            _buildEncodedSignature(1, SESSION_PRIVATE_KEY, userOpHash)
        );

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        assertEq(validationData, 1);
    }

    function test_ExecuteOnlyEntryPoint() public {
        vm.expectRevert(SmartAccount.NotEntryPoint.selector);
        account.execute(address(counter), 0, abi.encodeCall(Counter.increment, ()));
    }

    function test_ExecuteIncrementsCounterForAccount() public {
        vm.prank(entryPoint);
        account.execute(address(counter), 0, abi.encodeCall(Counter.increment, ()));

        assertEq(counter.getCount(address(account)), 1);
    }

    function _buildUserOp(
        bytes memory callData,
        bytes memory encodedSignature
    ) private pure returns (PackedUserOperation memory op) {
        op.sender = address(0x1234);
        op.nonce = 0;
        op.callData = callData;
        op.signature = encodedSignature;
    }

    function _buildExecuteCall(
        address target,
        bytes memory data
    ) private pure returns (bytes memory) {
        return abi.encodeCall(SmartAccount.execute, (target, 0, data));
    }

    function _buildEncodedSignature(
        uint8 mode,
        uint256 privateKey,
        bytes32 digest
    ) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        return abi.encode(mode, signature);
    }
}
