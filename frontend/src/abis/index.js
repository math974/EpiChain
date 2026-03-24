/**
 * ABI for SmartAccountFactory — only functions used by the frontend.
 */
export const FACTORY_ABI = [
  {
    type: "function",
    name: "createAccount",
    inputs: [
      { name: "_owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getAddress",
    inputs: [
      { name: "_owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
];

/**
 * ABI for SmartAccount — only functions used by the frontend.
 */
export const SMART_ACCOUNT_ABI = [
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "addSessionKey",
    inputs: [
      { name: "key",       type: "address" },
      { name: "expiry",    type: "uint256" },
      { name: "selectors", type: "bytes4[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeSessionKey",
    inputs: [{ name: "key", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isSessionKeyAllowed",
    inputs: [
      { name: "key",      type: "address" },
      { name: "selector", type: "bytes4" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "target", type: "address" },
      { name: "value",  type: "uint256" },
      { name: "data",   type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "SessionKeyAdded",
    inputs: [
      { name: "key",    type: "address", indexed: true },
      { name: "expiry", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionKeyRevoked",
    inputs: [{ name: "key", type: "address", indexed: true }],
  },
];

/**
 * ABI for Counter demo contract.
 */
export const COUNTER_ABI = [
  {
    type: "function",
    name: "increment",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getCount",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Incremented",
    inputs: [
      { name: "account",  type: "address", indexed: true },
      { name: "newCount", type: "uint256", indexed: false },
    ],
  },
];
