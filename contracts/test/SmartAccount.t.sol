// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test, console} from "forge-std/Test.sol";
import {SmartAccount} from "../src/SmartAccount.sol";
import {SmartAccountFactory} from "../src/SmartAccountFactory.sol";
import {Counter} from "../src/Counter.sol";
import {PackedUserOperation} from "../src/interfaces/IAccount.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract SmartAccountTest is Test {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // -------------------------------------------------------------------------
    // Test fixtures
    // -------------------------------------------------------------------------

    SmartAccountFactory factory;
    Counter counter;

    uint256 ownerKey = 0xA11CE;
    address owner;

    uint256 sessionKey = 0x5E5510;
    address sessionKeyAddr;

    SmartAccount account;

    function setUp() public {
        owner = vm.addr(ownerKey);
        sessionKeyAddr = vm.addr(sessionKey);

        factory = new SmartAccountFactory();
        counter = new Counter();

        // Deploy smart account via factory.
        account = SmartAccount(payable(factory.createAccount(owner, 0)));

        // Fund the account.
        vm.deal(address(account), 10 ether);
    }

    // -------------------------------------------------------------------------
    // Factory tests
    // -------------------------------------------------------------------------

    function test_factoryDeterministic() public view {
        address predicted = factory.getAddress(owner, 0);
        assertEq(predicted, address(account));
    }

    function test_factoryIdempotent() public {
        // Second call with same params should return existing account.
        address second = factory.createAccount(owner, 0);
        assertEq(second, address(account));
    }

    function test_factoryDifferentSalts() public {
        address a1 = factory.getAddress(owner, 0);
        address a2 = factory.getAddress(owner, 1);
        assertTrue(a1 != a2);
    }

    // -------------------------------------------------------------------------
    // SmartAccount owner tests
    // -------------------------------------------------------------------------

    function test_ownerSetCorrectly() public view {
        assertEq(account.owner(), owner);
    }

    function test_executeAsOwner() public {
        bytes memory data = abi.encodeCall(Counter.increment, ());

        vm.prank(owner);
        account.execute(address(counter), 0, data);

        assertEq(counter.getCount(address(account)), 1);
    }

    function test_executeRevertsForNonOwner() public {
        bytes memory data = abi.encodeCall(Counter.increment, ());
        vm.expectRevert("SmartAccount: unauthorized");
        account.execute(address(counter), 0, data);
    }

    // -------------------------------------------------------------------------
    // validateUserOp — ECDSA owner
    // -------------------------------------------------------------------------

    function test_validateUserOp_ownerECDSA() public {
        bytes32 userOpHash = keccak256("test-userop-hash");
        bytes memory sig = _signOwner(userOpHash);
        // Prepend auth mode 0x00.
        sig = abi.encodePacked(uint8(0x00), sig);

        PackedUserOperation memory userOp = _makeUserOp(sig);

        vm.prank(account.ENTRY_POINT());
        uint256 result = account.validateUserOp(userOp, userOpHash, 0);
        assertEq(result, 0); // SIG_VALIDATION_SUCCESS
    }

    function test_validateUserOp_wrongSigner_fails() public {
        bytes32 userOpHash = keccak256("test-userop-hash");
        // Sign with a different key.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, userOpHash.toEthSignedMessageHash());
        bytes memory sig = abi.encodePacked(uint8(0x00), r, s, v);

        PackedUserOperation memory userOp = _makeUserOp(sig);

        vm.prank(account.ENTRY_POINT());
        uint256 result = account.validateUserOp(userOp, userOpHash, 0);
        assertEq(result, 1); // SIG_VALIDATION_FAILED
    }

    // -------------------------------------------------------------------------
    // validateUserOp — session key
    // -------------------------------------------------------------------------

    function test_addSessionKey_and_validate() public {
        // Owner adds session key with no expiry and no selector restriction.
        vm.prank(owner);
        account.addSessionKey(sessionKeyAddr, 0, new bytes4[](0));

        bytes32 userOpHash = keccak256("session-op-hash");
        bytes memory skSig = _signSessionKey(userOpHash);
        bytes memory sig = abi.encodePacked(uint8(0x01), sessionKeyAddr, skSig);

        PackedUserOperation memory userOp = _makeUserOp(sig);

        vm.prank(account.ENTRY_POINT());
        uint256 result = account.validateUserOp(userOp, userOpHash, 0);
        assertEq(result, 0); // SIG_VALIDATION_SUCCESS
    }

    function test_sessionKey_expiry() public {
        uint256 expiry = block.timestamp + 1 hours;
        vm.prank(owner);
        account.addSessionKey(sessionKeyAddr, expiry, new bytes4[](0));

        bytes32 userOpHash = keccak256("expiry-op-hash");
        bytes memory skSig = _signSessionKey(userOpHash);
        bytes memory sig = abi.encodePacked(uint8(0x01), sessionKeyAddr, skSig);

        PackedUserOperation memory userOp = _makeUserOp(sig);

        // Before expiry — validation data should encode the expiry.
        vm.prank(account.ENTRY_POINT());
        uint256 result = account.validateUserOp(userOp, userOpHash, 0);
        // validationData = validUntil << 160; non-zero means time-bounded success.
        assertEq(result, expiry << 160);
    }

    function test_sessionKey_revokedKey_fails() public {
        vm.prank(owner);
        account.addSessionKey(sessionKeyAddr, 0, new bytes4[](0));

        vm.prank(owner);
        account.revokeSessionKey(sessionKeyAddr);

        bytes32 userOpHash = keccak256("revoked-op-hash");
        bytes memory skSig = _signSessionKey(userOpHash);
        bytes memory sig = abi.encodePacked(uint8(0x01), sessionKeyAddr, skSig);

        PackedUserOperation memory userOp = _makeUserOp(sig);

        vm.prank(account.ENTRY_POINT());
        uint256 result = account.validateUserOp(userOp, userOpHash, 0);
        assertEq(result, 1); // SIG_VALIDATION_FAILED
    }

    function test_sessionKey_unregisteredKey_fails() public {
        // A key that was never added must NOT be able to validate.
        bytes32 userOpHash = keccak256("unregistered-op-hash");
        bytes memory skSig = _signSessionKey(userOpHash);
        bytes memory sig = abi.encodePacked(uint8(0x01), sessionKeyAddr, skSig);

        PackedUserOperation memory userOp = _makeUserOp(sig);

        vm.prank(account.ENTRY_POINT());
        uint256 result = account.validateUserOp(userOp, userOpHash, 0);
        assertEq(result, 1); // SIG_VALIDATION_FAILED — key never registered
    }

    function test_sessionKey_selectorRestriction() public {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = Counter.increment.selector;

        vm.prank(owner);
        account.addSessionKey(sessionKeyAddr, 0, selectors);

        // Build a UserOperation calling increment().
        bytes memory callData = abi.encodeCall(Counter.increment, ());
        bytes32 userOpHash = keccak256("selector-op-hash");
        bytes memory skSig = _signSessionKey(userOpHash);
        bytes memory sig = abi.encodePacked(uint8(0x01), sessionKeyAddr, skSig);

        PackedUserOperation memory userOp = _makeUserOpWithCallData(sig, callData);

        vm.prank(account.ENTRY_POINT());
        uint256 result = account.validateUserOp(userOp, userOpHash, 0);
        assertEq(result, 0); // SIG_VALIDATION_SUCCESS — selector is allowed

        // Now try with a disallowed selector.
        bytes memory disallowedCall = abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), address(0), 0);
        PackedUserOperation memory userOp2 = _makeUserOpWithCallData(sig, disallowedCall);

        vm.prank(account.ENTRY_POINT());
        uint256 result2 = account.validateUserOp(userOp2, userOpHash, 0);
        assertEq(result2, 1); // SIG_VALIDATION_FAILED — selector not allowed
    }

    function test_revokeSessionKey_emitsEvent() public {
        vm.prank(owner);
        account.addSessionKey(sessionKeyAddr, 0, new bytes4[](0));

        vm.expectEmit(true, false, false, false);
        emit SmartAccount.SessionKeyRevoked(sessionKeyAddr);

        vm.prank(owner);
        account.revokeSessionKey(sessionKeyAddr);
    }

    // -------------------------------------------------------------------------
    // Counter tests
    // -------------------------------------------------------------------------

    function test_counter_increment() public {
        vm.prank(address(account));
        counter.increment();
        assertEq(counter.getCount(address(account)), 1);
    }

    function test_counter_perAccount() public {
        address other = makeAddr("other");
        vm.prank(address(account));
        counter.increment();

        vm.prank(other);
        counter.increment();

        assertEq(counter.getCount(address(account)), 1);
        assertEq(counter.getCount(other), 1);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _signOwner(bytes32 hash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, hash.toEthSignedMessageHash());
        return abi.encodePacked(r, s, v);
    }

    function _signSessionKey(bytes32 hash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionKey, hash.toEthSignedMessageHash());
        return abi.encodePacked(r, s, v);
    }

    function _makeUserOp(bytes memory sig) internal view returns (PackedUserOperation memory) {
        return _makeUserOpWithCallData(sig, "");
    }

    function _makeUserOpWithCallData(
        bytes memory sig,
        bytes memory callData
    ) internal view returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: address(account),
            nonce: 0,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: sig
        });
    }
}
