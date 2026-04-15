// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SmartAccount} from "../src/SmartAccount.sol";
import {SmartAccountFactory} from "../src/SmartAccountFactory.sol";

contract SmartAccountFactoryTest is Test {
    SmartAccountFactory internal factory;
    address internal entryPoint;

    function setUp() public {
        entryPoint = makeAddr("entryPoint");
        factory = new SmartAccountFactory(entryPoint);
    }

    function test_GetAddressMatchesCreate2Deployment() public {
        address owner = makeAddr("owner");
        uint256 salt = 7;

        address expected = factory.getAddress(owner, salt);
        SmartAccount deployed = factory.createAccount(owner, salt);

        assertEq(address(deployed), expected);
        assertEq(deployed.owner(), owner);
        assertEq(deployed.entryPoint(), entryPoint);
    }

    function test_CreateAccountIsIdempotentForSameSalt() public {
        address owner = makeAddr("owner");
        uint256 salt = 42;

        SmartAccount first = factory.createAccount(owner, salt);
        SmartAccount second = factory.createAccount(owner, salt);

        assertEq(address(first), address(second));
    }
}
