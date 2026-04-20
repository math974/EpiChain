/**
 * EntryPoint v0.7 ABI — only the three event signatures needed by the indexer.
 */
export const entryPointAbi = [
  {
    type: "event",
    name: "UserOperationEvent",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "paymaster", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "success", type: "bool", indexed: false },
      { name: "actualGasCost", type: "uint256", indexed: false },
      { name: "actualGasUsed", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AccountDeployed",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "factory", type: "address", indexed: false },
      { name: "paymaster", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UserOperationRevertReason",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "revertReason", type: "bytes", indexed: false },
    ],
  },
] as const;
