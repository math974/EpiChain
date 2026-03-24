/**
 * ABI fragments for the ERC-4337 EntryPoint v0.7 events we index.
 *
 * EntryPoint address: 0x0000000071727De22E5E9d8BAf0edAc6f37da032
 */
export const ENTRY_POINT_ABI = [
  {
    type: "event",
    name: "UserOperationEvent",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender",     type: "address", indexed: true },
      { name: "paymaster",  type: "address", indexed: true },
      { name: "nonce",      type: "uint256", indexed: false },
      { name: "success",    type: "bool",    indexed: false },
      { name: "actualGasCost", type: "uint256", indexed: false },
      { name: "actualGasUsed", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AccountDeployed",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender",     type: "address", indexed: true },
      { name: "factory",    type: "address", indexed: false },
      { name: "paymaster",  type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UserOperationRevertReason",
    inputs: [
      { name: "userOpHash",   type: "bytes32", indexed: true },
      { name: "sender",       type: "address", indexed: true },
      { name: "nonce",        type: "uint256", indexed: false },
      { name: "revertReason", type: "bytes",   indexed: false },
    ],
  },
];

export const ENTRY_POINT_ADDRESS =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
