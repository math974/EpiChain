// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Counter} from "../src/Counter.sol";

contract CounterTest is Test {
    Counter internal counter;

    function setUp() public {
        counter = new Counter();
    }

    function test_IncrementTracksPerCaller() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        vm.prank(alice);
        counter.increment();

        vm.prank(alice);
        counter.increment();

        vm.prank(bob);
        counter.increment();

        assertEq(counter.getCount(alice), 2);
        assertEq(counter.getCount(bob), 1);
    }
}
