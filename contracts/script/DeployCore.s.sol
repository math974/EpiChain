// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SmartAccountFactory} from "../src/SmartAccountFactory.sol";
import {Counter} from "../src/Counter.sol";

contract DeployCoreScript is Script {
    function run() external {
        address entryPoint = vm.envAddress("ENTRY_POINT_V07");
        vm.startBroadcast();

        SmartAccountFactory factory = new SmartAccountFactory(entryPoint);
        Counter counter = new Counter();

        vm.stopBroadcast();

        console2.log("SmartAccountFactory:", address(factory));
        console2.log("Counter:", address(counter));
    }
}
