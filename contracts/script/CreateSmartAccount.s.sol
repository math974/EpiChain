// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SmartAccountFactory} from "../src/SmartAccountFactory.sol";

contract CreateSmartAccountScript is Script {
    function run() external {
        address factoryAddr = vm.envAddress("FACTORY_ADDRESS");
        address owner = vm.envAddress("SMART_ACCOUNT_OWNER");
        uint256 salt = vm.envUint("SMART_ACCOUNT_SALT");

        SmartAccountFactory factory = SmartAccountFactory(factoryAddr);
        address predicted = factory.getAddress(owner, salt);

        vm.startBroadcast();
        address deployed = address(factory.createAccount(owner, salt));
        vm.stopBroadcast();

        console2.log("Factory:", factoryAddr);
        console2.log("Owner:", owner);
        console2.log("Salt:", salt);
        console2.log("Predicted SmartAccount:", predicted);
        console2.log("Deployed SmartAccount:", deployed);
    }
}
