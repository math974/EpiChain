// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {SmartAccountFactory} from "../src/SmartAccountFactory.sol";
import {Counter} from "../src/Counter.sol";

/**
 * @title Deploy
 * @notice Deploys SmartAccountFactory and Counter to the configured network.
 *
 * Usage:
 *   forge script script/Deploy.s.sol \
 *     --rpc-url $SEPOLIA_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $ETHERSCAN_API_KEY
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deploying from:", deployer);

        vm.startBroadcast(deployerKey);

        SmartAccountFactory factory = new SmartAccountFactory();
        console.log("SmartAccountFactory deployed at:", address(factory));

        Counter counter = new Counter();
        console.log("Counter deployed at:", address(counter));

        vm.stopBroadcast();

        // Log counterfactual address for the deployer using salt=0.
        address smartAccountAddr = factory.getAddress(deployer, 0);
        console.log("Counterfactual SmartAccount address (owner=deployer, salt=0):", smartAccountAddr);
    }
}
