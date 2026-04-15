// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SmartAccount} from "../src/SmartAccount.sol";

contract AddSessionKeyScript is Script {
    function run() external {
        address smartAccountAddr = vm.envAddress("SMART_ACCOUNT_ADDRESS");
        address sessionKey = vm.envAddress("SESSION_KEY_ADDRESS");
        uint48 expiry = uint48(vm.envUint("SESSION_EXPIRY"));
        bytes4 incrementSelector = bytes4(keccak256("increment()"));

        SmartAccount smartAccount = SmartAccount(payable(smartAccountAddr));
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = incrementSelector;

        vm.startBroadcast();
        smartAccount.addSessionKey(sessionKey, expiry, selectors);
        vm.stopBroadcast();

        console2.log("SmartAccount:", smartAccountAddr);
        console2.log("Session key added:", sessionKey);
        console2.log("Expiry:", uint256(expiry));
        console2.logBytes4(incrementSelector);
    }
}

contract RevokeSessionKeyScript is Script {
    function run() external {
        address smartAccountAddr = vm.envAddress("SMART_ACCOUNT_ADDRESS");
        address sessionKey = vm.envAddress("SESSION_KEY_ADDRESS");

        SmartAccount smartAccount = SmartAccount(payable(smartAccountAddr));

        vm.startBroadcast();
        smartAccount.revokeSessionKey(sessionKey);
        vm.stopBroadcast();

        console2.log("SmartAccount:", smartAccountAddr);
        console2.log("Session key revoked:", sessionKey);
    }
}
