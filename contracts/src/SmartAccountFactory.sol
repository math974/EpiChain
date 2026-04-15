// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SmartAccount} from "./SmartAccount.sol";

contract SmartAccountFactory {
    address public immutable entryPoint;

    event AccountCreated(address indexed owner, address indexed account, uint256 salt);

    constructor(address entryPoint_) {
        require(entryPoint_ != address(0), "entryPoint is zero");
        entryPoint = entryPoint_;
    }

    function createAccount(address owner, uint256 salt) external returns (SmartAccount account) {
        address predicted = getAddress(owner, salt);
        if (predicted.code.length > 0) {
            return SmartAccount(payable(predicted));
        }

        bytes32 create2Salt = bytes32(salt);
        account = new SmartAccount{salt: create2Salt}(owner, entryPoint);
        emit AccountCreated(owner, address(account), salt);
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        bytes memory initCode = abi.encodePacked(
            type(SmartAccount).creationCode,
            abi.encode(owner, entryPoint)
        );

        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), keccak256(initCode))
        );

        return address(uint160(uint256(hash)));
    }
}
