import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  keccak256,
  parseSignature,
  serializeSignature,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { WalletClient } from "viem";
import {
  AUTH_MODE_OWNER,
  AUTH_MODE_SESSION,
} from "./aa-constants";
import { smartAccountAbi } from "./aa-abi";

export type PackedUserOperation = {
  sender: `0x${string}`;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
};

export function encodeAuthSignature(mode: number, signature: Hex): Hex {
  return encodeAbiParameters(
    [
      { name: "authMode", type: "uint8" },
      { name: "authSignature", type: "bytes" },
    ],
    [mode, signature],
  );
}

export async function signUserOpHash(
  walletClient: WalletClient,
  account: `0x${string}`,
  userOpHash: Hex,
): Promise<Hex> {
  const signature = await walletClient.signMessage({
    account,
    message: { raw: userOpHash },
  });
  const parsed = parseSignature(signature);
  return serializeSignature(parsed);
}

export async function buildOwnerAuthSignature(
  walletClient: WalletClient,
  owner: `0x${string}`,
  userOpHash: Hex,
): Promise<Hex> {
  const signature = await signUserOpHash(walletClient, owner, userOpHash);
  return encodeAuthSignature(AUTH_MODE_OWNER, signature);
}

export async function buildSessionAuthSignature(
  walletClient: WalletClient,
  sessionKey: `0x${string}`,
  userOpHash: Hex,
): Promise<Hex> {
  // Session-key validation in SmartAccount currently recovers directly from
  // userOpHash (no EIP-191 prefix), so we must use raw eth_sign here.
  // Some wallets disable eth_sign for security reasons.
  let signature: Hex;
  try {
    signature = (await walletClient.request({
      method: "eth_sign",
      params: [sessionKey, userOpHash],
    })) as Hex;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Wallet does not support eth_sign";
    throw new Error(
      `Session-key signing requires eth_sign (raw hash). ${message}`,
    );
  }
  return encodeAuthSignature(AUTH_MODE_SESSION, signature);
}

/// Signs the EntryPoint userOpHash with a locally generated session private key
/// (same digest as `eth_sign` on the hash — matches `ecrecover` in SmartAccount).
export async function buildSessionAuthSignatureFromPrivateKey(
  privateKey: Hex,
  userOpHash: Hex,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const signature = await account.sign({ hash: userOpHash });
  const parsed = parseSignature(signature);
  return encodeAuthSignature(AUTH_MODE_SESSION, serializeSignature(parsed));
}

export function encodeExecuteCall(
  target: `0x${string}`,
  value: bigint,
  data: Hex,
): Hex {
  return encodeFunctionData({
    abi: smartAccountAbi,
    functionName: "execute",
    args: [target, value, data],
  });
}

export function packUint128Pair(high: bigint, low: bigint): Hex {
  return concatHex([toHex(high, { size: 16 }), toHex(low, { size: 16 })]);
}

export function toRpcHex(value: bigint): Hex {
  return toHex(value);
}

/// Temporary helper for local demos until bundler integration is done.
export function computeDemoUserOpHash(callData: Hex, nonce: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes", name: "callData" },
        { type: "uint256", name: "nonce" },
      ],
      [callData, nonce],
    ),
  );
}
