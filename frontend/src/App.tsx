import { ConnectButton } from "@rainbow-me/rainbowkit";
import { encodeFunctionData, formatEther, isAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useMemo, useState, lazy, Suspense } from "react";

const IndexerFeed = lazy(() => import("./IndexerFeed"));
const FuturesMarket = lazy(() => import("./FuturesMarket"));
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWalletClient,
} from "wagmi";
import { ENTRY_POINT_V07 } from "./lib/aa-constants";
import {
  counterAbi,
  entryPointAbi,
  smartAccountAbi,
  smartAccountFactoryAbi,
} from "./lib/aa-abi";
import {
  buildOwnerAuthSignature,
  buildSessionAuthSignature,
  buildSessionAuthSignatureFromPrivateKey,
  computeDemoUserOpHash,
  encodeAuthSignature,
  encodeExecuteCall,
  packUint128Pair,
  toRpcHex,
  type PackedUserOperation,
} from "./lib/aa-userop";
import "./App.css";

const INCREMENT_SELECTOR = "0xd09de08a";
const MIN_PRIORITY_FEE_PER_GAS = 100_000_000n; // 0.1 gwei floor required by bundler precheck
const MAX_FEE_SAFETY_MULTIPLIER_NUM = 130n; // 30% safety margin for fast baseFee changes
const MAX_FEE_SAFETY_MULTIPLIER_DEN = 100n;
const MIN_VERIFICATION_GAS_LIMIT = 45_000n;
const MAX_VERIFICATION_GAS_RETRY_LIMIT = 1_000_000n;
const USER_OP_SEND_MAX_RETRIES = 4;
const USER_OP_RECEIPT_MAX_POLLS = 24;
const USER_OP_RECEIPT_POLL_INTERVAL_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bundlerRpc<T>(
  bundlerUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(bundlerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });
  const data = (await response.json()) as {
    result?: T | { result?: T };
    error?: { code?: number; message?: string; data?: unknown };
  };
  if (data.error) {
    const details = JSON.stringify(data.error);
    throw new Error(`${data.error.message ?? `Bundler error on ${method}`} | ${details}`);
  }
  if (data.result === undefined) {
    throw new Error(`Missing result for ${method}`);
  }
  if (typeof data.result === "object" && data.result !== null && "result" in data.result) {
    const nested = (data.result as { result?: T }).result;
    if (nested === undefined) {
      throw new Error(`Missing nested result for ${method}`);
    }
    return nested;
  }
  return data.result as T;
}

type Tab = "account" | "indexer" | "futures";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("account");
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [saltInput, setSaltInput] = useState("1");
  const [ownerAddressInput, setOwnerAddressInput] = useState("");
  const [sessionKeyInput, setSessionKeyInput] = useState("");
  /** In-memory session signing key (exam flow: generate here, not a second MetaMask account). */
  const [sessionKeyPrivateKey, setSessionKeyPrivateKey] = useState<`0x${string}` | null>(null);
  const [sessionExpiryInput, setSessionExpiryInput] = useState(
    String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
  );
  const [lastTxHash, setLastTxHash] = useState<`0x${string}` | undefined>();
  const [lastAction, setLastAction] = useState<string>("");
  const [ownerUserOpHash, setOwnerUserOpHash] = useState<`0x${string}` | undefined>();
  const [ownerBundlerError, setOwnerBundlerError] = useState<string>("");
  const [ownerBundlerStatus, setOwnerBundlerStatus] = useState<string>("");
  const [ownerBundlerPayload, setOwnerBundlerPayload] = useState<string>("");
  const [isOwnerBundlerPending, setIsOwnerBundlerPending] = useState(false);
  const [sessionUserOpHash, setSessionUserOpHash] = useState<`0x${string}` | undefined>();
  const [sessionBundlerError, setSessionBundlerError] = useState<string>("");
  const [sessionBundlerStatus, setSessionBundlerStatus] = useState<string>("");
  const [sessionBundlerPayload, setSessionBundlerPayload] = useState<string>("");
  const [isSessionBundlerPending, setIsSessionBundlerPending] = useState(false);
  const [isOwnerTxPending, setIsOwnerTxPending] = useState(false);

  const factoryAddress = import.meta.env.VITE_FACTORY_ADDRESS;
  const counterAddress = import.meta.env.VITE_COUNTER_ADDRESS;
  const bundlerUrl = import.meta.env.VITE_BUNDLER_URL;
  const salt = BigInt(Number.isNaN(Number(saltInput)) ? 0 : Number(saltInput));
  const sessionExpiry = Number.isNaN(Number(sessionExpiryInput))
    ? 0
    : Number(sessionExpiryInput);

  const ownerAddressForSmartAccount =
    ownerAddressInput && isAddress(ownerAddressInput)
      ? (ownerAddressInput as `0x${string}`)
      : address;
  const canReadFactoryForOwner =
    !!factoryAddress && isAddress(factoryAddress) && !!ownerAddressForSmartAccount;
  const canBuildDemoCall = !!counterAddress && isAddress(counterAddress);
  const sessionKeyIsAddress = isAddress(sessionKeyInput);
  const incrementCallData = useMemo(() => {
    if (!canBuildDemoCall) return null;
    return encodeFunctionData({
      abi: counterAbi,
      functionName: "increment",
    });
  }, [canBuildDemoCall]);

  const demoExecuteCallData = useMemo(() => {
    if (!canBuildDemoCall || !incrementCallData) return null;
    return encodeExecuteCall(counterAddress as `0x${string}`, 0n, incrementCallData);
  }, [canBuildDemoCall, counterAddress, incrementCallData]);

  const demoUserOpHash = useMemo(() => {
    if (!demoExecuteCallData) return null;
    return computeDemoUserOpHash(demoExecuteCallData, 0n);
  }, [demoExecuteCallData]);

  const txReceiptQuery = useWaitForTransactionReceipt({
    hash: lastTxHash,
    query: { enabled: !!lastTxHash },
  });

  const predictedAddressQuery = useReadContract({
    abi: smartAccountFactoryAbi,
    address: canReadFactoryForOwner ? (factoryAddress as `0x${string}`) : undefined,
    functionName: "getAddress",
    args: ownerAddressForSmartAccount ? [ownerAddressForSmartAccount, salt] : undefined,
    query: {
      enabled: canReadFactoryForOwner,
    },
  });

  const smartAccountAddress = predictedAddressQuery.data;
  const canUseSmartAccount = !!smartAccountAddress && isAddress(smartAccountAddress);
  const canUseOwnerBundler =
    !!bundlerUrl &&
    !!walletClient &&
    !!publicClient &&
    !!address &&
    !!demoExecuteCallData &&
    canUseSmartAccount;
  const connectedAddressMatchesSessionKey =
    !!address &&
    sessionKeyIsAddress &&
    address.toLowerCase() === sessionKeyInput.toLowerCase();
  const canSignSessionUserOp =
    sessionKeyPrivateKey !== null ||
    (!!walletClient && !!address && connectedAddressMatchesSessionKey);
  const canUseSessionBundler =
    !!bundlerUrl &&
    !!publicClient &&
    !!demoExecuteCallData &&
    canUseSmartAccount &&
    sessionKeyIsAddress &&
    canSignSessionUserOp;
  const isAnyBundlerPending = isOwnerBundlerPending || isSessionBundlerPending;

  const counterValueQuery = useReadContract({
    abi: counterAbi,
    address: canBuildDemoCall ? (counterAddress as `0x${string}`) : undefined,
    functionName: "getCount",
    args: canUseSmartAccount ? [smartAccountAddress as `0x${string}`] : undefined,
    query: {
      enabled: canBuildDemoCall && canUseSmartAccount,
    },
  });
  const smartAccountBalanceQuery = useBalance({
    address: canUseSmartAccount ? (smartAccountAddress as `0x${string}`) : undefined,
    query: {
      enabled: canUseSmartAccount,
    },
  });

  const sessionAllowedQuery = useReadContract({
    abi: smartAccountAbi,
    address: canUseSmartAccount ? (smartAccountAddress as `0x${string}`) : undefined,
    functionName: "isSelectorAllowed",
    args: sessionKeyIsAddress
      ? [sessionKeyInput as `0x${string}`, INCREMENT_SELECTOR]
      : undefined,
    query: {
      enabled: canUseSmartAccount && sessionKeyIsAddress,
    },
  });

  const sessionConfigQuery = useReadContract({
    abi: smartAccountAbi,
    address: canUseSmartAccount ? (smartAccountAddress as `0x${string}`) : undefined,
    functionName: "sessionConfigs",
    args: sessionKeyIsAddress ? [sessionKeyInput as `0x${string}`] : undefined,
    query: {
      enabled: canUseSmartAccount && sessionKeyIsAddress,
    },
  });

  const submitCreateAccount = async () => {
    if (!canReadFactoryForOwner || !ownerAddressForSmartAccount || !address || !walletClient) return;
    setIsOwnerTxPending(true);
    try {
      const hash = await walletClient.writeContract({
        account: address as `0x${string}`,
        chain: undefined,
        abi: smartAccountFactoryAbi,
        address: factoryAddress as `0x${string}`,
        functionName: "createAccount",
        args: [ownerAddressForSmartAccount, salt],
      });
      setLastAction("createAccount");
      setLastTxHash(hash);
    } finally {
      setIsOwnerTxPending(false);
    }
  };

  const submitAddSessionKey = async () => {
    if (
      !canUseSmartAccount ||
      !sessionKeyIsAddress ||
      sessionExpiry <= 0 ||
      !walletClient ||
      !address
    ) {
      return;
    }
    setIsOwnerTxPending(true);
    try {
      const hash = await walletClient.writeContract({
        account: address as `0x${string}`,
        chain: undefined,
        abi: smartAccountAbi,
        address: smartAccountAddress as `0x${string}`,
        functionName: "addSessionKey",
        args: [sessionKeyInput as `0x${string}`, sessionExpiry, [INCREMENT_SELECTOR]],
      });
      setLastAction("addSessionKey");
      setLastTxHash(hash);
    } finally {
      setIsOwnerTxPending(false);
    }
  };

  const submitRevokeSessionKey = async () => {
    if (!canUseSmartAccount || !sessionKeyIsAddress || !walletClient || !address) return;
    setIsOwnerTxPending(true);
    try {
      const hash = await walletClient.writeContract({
        account: address as `0x${string}`,
        chain: undefined,
        abi: smartAccountAbi,
        address: smartAccountAddress as `0x${string}`,
        functionName: "revokeSessionKey",
        args: [sessionKeyInput as `0x${string}`],
      });
      setLastAction("revokeSessionKey");
      setLastTxHash(hash);
    } finally {
      setIsOwnerTxPending(false);
    }
  };

  const submitIncrementViaBundler = async (authMode: "owner" | "session") => {
    if (!bundlerUrl || !publicClient || !demoExecuteCallData || !canUseSmartAccount) return;
    const isOwnerMode = authMode === "owner";
    const setError = isOwnerMode ? setOwnerBundlerError : setSessionBundlerError;
    const setStatus = isOwnerMode ? setOwnerBundlerStatus : setSessionBundlerStatus;
    const setUserOpHash = isOwnerMode ? setOwnerUserOpHash : setSessionUserOpHash;
    const setPayload = isOwnerMode ? setOwnerBundlerPayload : setSessionBundlerPayload;
    const setPending = isOwnerMode ? setIsOwnerBundlerPending : setIsSessionBundlerPending;

    if (isOwnerMode) {
      if (!canUseOwnerBundler || !walletClient || !address) return;
    } else {
      if (!sessionKeyIsAddress) {
        setError("Provide a valid session key address.");
        return;
      }
      if (!canSignSessionUserOp) {
        setError(
          "Generate a session key below, or connect a wallet whose address matches the session key.",
        );
        return;
      }
    }
    setError("");
    setStatus("");
    setUserOpHash(undefined);
    setPending(true);
    try {
      const accountCode = await publicClient.getCode({
        address: smartAccountAddress as `0x${string}`,
      });
      if (!accountCode || accountCode === "0x") {
        throw new Error("Smart account is not deployed. Run Create account first.");
      }

      const nonce = (await publicClient.readContract({
        abi: entryPointAbi,
        address: ENTRY_POINT_V07,
        functionName: "getNonce",
        args: [smartAccountAddress as `0x${string}`, 0n],
      } as any)) as bigint;

      const feeData = await publicClient.estimateFeesPerGas();
      const pendingBlock = await publicClient.getBlock({ blockTag: "pending" });
      const estimatedPriorityFee = feeData.maxPriorityFeePerGas ?? 1_500_000_000n;
      const maxPriorityFeePerGas =
        estimatedPriorityFee < MIN_PRIORITY_FEE_PER_GAS
          ? MIN_PRIORITY_FEE_PER_GAS
          : estimatedPriorityFee;
      const pendingBaseFee = pendingBlock.baseFeePerGas ?? 0n;
      const baseSuggestedMaxFee = pendingBaseFee * 2n + maxPriorityFeePerGas;
      const estimatedMaxFee =
        feeData.maxFeePerGas ??
        (feeData.gasPrice ? feeData.gasPrice * 2n : maxPriorityFeePerGas * 2n);
      const rawMaxFeePerGas =
        estimatedMaxFee > baseSuggestedMaxFee ? estimatedMaxFee : baseSuggestedMaxFee;
      const maxFeePerGas =
        (rawMaxFeePerGas * MAX_FEE_SAFETY_MULTIPLIER_NUM) / MAX_FEE_SAFETY_MULTIPLIER_DEN;
      const defaultCallGasLimit = 120_000n;
      const defaultVerificationGasLimit = 250_000n;
      const defaultPreVerificationGas = 60_000n;

      // Estimation still runs account validation paths. Provide a well-formed
      // auth envelope to avoid InvalidSignatureEncoding revert.
      // 65-byte zero signature is enough for estimation prechecks.
      const estimateDummySignature = encodeAuthSignature(
        0,
        `0x${"00".repeat(65)}` as `0x${string}`,
      );
      const rpcUserOpForEstimatePayload = {
        sender: smartAccountAddress as `0x${string}`,
        nonce: toRpcHex(nonce),
        callData: demoExecuteCallData!,
        callGasLimit: toRpcHex(defaultCallGasLimit),
        verificationGasLimit: toRpcHex(defaultVerificationGasLimit),
        preVerificationGas: toRpcHex(defaultPreVerificationGas),
        maxFeePerGas: toRpcHex(maxFeePerGas),
        maxPriorityFeePerGas: toRpcHex(maxPriorityFeePerGas),
        signature: estimateDummySignature,
      };

      const gasEstimate = await bundlerRpc<{
        callGasLimit?: `0x${string}`;
        verificationGasLimit?: `0x${string}`;
        preVerificationGas?: `0x${string}`;
      }>(bundlerUrl, "eth_estimateUserOperationGas", [
        rpcUserOpForEstimatePayload,
        ENTRY_POINT_V07,
      ]);

      const callGasLimit = gasEstimate.callGasLimit
        ? BigInt(gasEstimate.callGasLimit)
        : defaultCallGasLimit;
      const estimatedVerificationGasLimit = gasEstimate.verificationGasLimit
        ? BigInt(gasEstimate.verificationGasLimit)
        : defaultVerificationGasLimit;
      const preVerificationGas = gasEstimate.preVerificationGas
        ? BigInt(gasEstimate.preVerificationGas)
        : defaultPreVerificationGas;
      const canRetrySilently =
        authMode === "session" && sessionKeyPrivateKey !== null;

      // Compute optimal verificationGasLimit from the bundler's "efficiency"
      // error when available, otherwise derive from the raw estimate.
      function computeOptimalVgl(
        estimate: bigint,
        errorMsg?: string,
      ): bigint {
        // Parse "Actual: 0.15546" from efficiency error to derive real gas usage.
        if (errorMsg) {
          const m = errorMsg.match(/Actual:\s*([\d.]+)/);
          if (m) {
            const actualRatio = parseFloat(m[1]);
            if (actualRatio > 0 && actualRatio < 1) {
              const estimateNum = Number(estimate);
              const realGas = Math.ceil(estimateNum * actualRatio);
              // Need: realGas / limit >= 0.4.  Target 0.55 so there is margin.
              const optimal = BigInt(Math.ceil(realGas / 0.55));
              return optimal < MIN_VERIFICATION_GAS_LIMIT
                ? MIN_VERIFICATION_GAS_LIMIT
                : optimal;
            }
          }
        }
        // Default: assume real gas is ~15% of the heavily-padded bundler estimate.
        // Aim for efficiency ~0.55 → limit = realGas / 0.55 ≈ estimate * 0.15 / 0.55 ≈ 27%.
        const tuned = (estimate * 27n) / 100n;
        return tuned < MIN_VERIFICATION_GAS_LIMIT ? MIN_VERIFICATION_GAS_LIMIT : tuned;
      }

      const initialVgl = computeOptimalVgl(estimatedVerificationGasLimit);

      const signUserOp = async (vgl: bigint) => {
        const op: PackedUserOperation = {
          sender: smartAccountAddress as `0x${string}`,
          nonce,
          initCode: "0x",
          callData: demoExecuteCallData!,
          accountGasLimits: packUint128Pair(vgl, callGasLimit),
          preVerificationGas,
          gasFees: packUint128Pair(maxPriorityFeePerGas, maxFeePerGas),
          paymasterAndData: "0x",
          signature: "0x",
        };
        const hash = (await publicClient.readContract({
          abi: entryPointAbi,
          address: ENTRY_POINT_V07,
          functionName: "getUserOpHash",
          args: [op],
        } as any)) as `0x${string}`;
        const sig =
          authMode === "owner"
            ? await buildOwnerAuthSignature(walletClient!, address as `0x${string}`, hash)
            : sessionKeyPrivateKey !== null
              ? await buildSessionAuthSignatureFromPrivateKey(sessionKeyPrivateKey, hash)
              : await buildSessionAuthSignature(
                  walletClient!,
                  sessionKeyInput as `0x${string}`,
                  hash,
                );
        return sig;
      };

      // Owner: up to 2 attempts (initial + 1 smart retry from error).
      // Session (local key): up to 4 silent retries.
      const maxAttempts = canRetrySilently ? USER_OP_SEND_MAX_RETRIES : 2;
      let currentVgl = initialVgl;
      let sentUserOpHash: `0x${string}` | undefined;
      let lastSendError: Error | undefined;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0 && !canRetrySilently) {
          setStatus("Adjusting gas and re-signing (one more MetaMask prompt)...");
        }
        const sig = await signUserOp(currentVgl);
        const rpcUserOp = {
          sender: smartAccountAddress as `0x${string}`,
          nonce: toRpcHex(nonce),
          callData: demoExecuteCallData!,
          callGasLimit: toRpcHex(callGasLimit),
          verificationGasLimit: toRpcHex(currentVgl),
          preVerificationGas: toRpcHex(preVerificationGas),
          maxFeePerGas: toRpcHex(maxFeePerGas),
          maxPriorityFeePerGas: toRpcHex(maxPriorityFeePerGas),
          signature: sig,
        };
        setPayload(JSON.stringify(rpcUserOp, null, 2));

        try {
          sentUserOpHash = await bundlerRpc<`0x${string}`>(
            bundlerUrl,
            "eth_sendUserOperation",
            [rpcUserOp, ENTRY_POINT_V07],
          );
          break;
        } catch (sendError) {
          const sendMessage =
            sendError instanceof Error ? sendError.message : "Unknown bundler send error";
          const canRetry = attempt < maxAttempts - 1;

          if (canRetry && sendMessage.includes("AA26 over verificationGasLimit")) {
            const increased = currentVgl + currentVgl / 3n + 20_000n;
            currentVgl =
              increased > MAX_VERIFICATION_GAS_RETRY_LIMIT
                ? MAX_VERIFICATION_GAS_RETRY_LIMIT
                : increased;
            setStatus(
              `Retrying (${attempt + 2}/${maxAttempts}) verificationGas=${currentVgl.toString()}`,
            );
            continue;
          }
          if (canRetry && sendMessage.includes("Verification gas limit efficiency too low")) {
            currentVgl = computeOptimalVgl(currentVgl, sendMessage);
            setStatus(
              `Retrying (${attempt + 2}/${maxAttempts}) verificationGas=${currentVgl.toString()} (efficiency)`,
            );
            continue;
          }
          lastSendError =
            sendError instanceof Error ? sendError : new Error("Unknown bundler send error");
          break;
        }
      }

      if (!sentUserOpHash) {
        if (lastSendError) throw lastSendError;
        throw new Error("Bundler rejected UserOperation after retries.");
      }

      setUserOpHash(sentUserOpHash);
      setStatus(
        `UserOperation (${authMode}) sent. Waiting for inclusion...`,
      );

      let foundReceipt = false;
      for (let pollIdx = 0; pollIdx < USER_OP_RECEIPT_MAX_POLLS; pollIdx += 1) {
        const receipt = await bundlerRpc<
          | null
          | {
              transactionHash?: `0x${string}`;
            }
        >(bundlerUrl, "eth_getUserOperationReceipt", [sentUserOpHash]);

        if (receipt) {
          foundReceipt = true;
          setStatus(
            receipt.transactionHash
              ? `Included on-chain: ${receipt.transactionHash}`
              : "Included on-chain.",
          );
          await counterValueQuery.refetch();
          break;
        }

        await sleep(USER_OP_RECEIPT_POLL_INTERVAL_MS);
      }

      if (!foundReceipt) {
        setStatus("Still pending in bundler mempool. Try refresh in a few seconds.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown bundler error";
      const prefundMatch = message.match(
        /sender balance and deposit together is (\d+) but must be at least (\d+)/,
      );
      if (prefundMatch) {
        const balance = BigInt(prefundMatch[1]);
        const required = BigInt(prefundMatch[2]);
        const missing = required > balance ? required - balance : 0n;
        setError(
          `${message}\nTop up smart account by at least ${formatEther(missing)} ETH (current ${formatEther(balance)} / required ${formatEther(required)}).`,
        );
      } else {
        setError(message);
      }
      setStatus("");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>EpiChain</h1>
        <nav className="tab-nav">
          <button
            className={`tab-btn ${activeTab === "account" ? "active" : ""}`}
            onClick={() => setActiveTab("account")}
          >
            Smart Account
          </button>
          <button
            className={`tab-btn ${activeTab === "indexer" ? "active" : ""}`}
            onClick={() => setActiveTab("indexer")}
          >
            Indexer Feed
          </button>
          <button
            className={`tab-btn ${activeTab === "futures" ? "active" : ""}`}
            onClick={() => setActiveTab("futures")}
          >
            Futures Markets
          </button>
        </nav>
        <ConnectButton />
      </header>
      <main className="app-main">
        {activeTab === "indexer" ? (
          <Suspense fallback={<p>Loading indexer...</p>}>
            <IndexerFeed />
          </Suspense>
        ) : activeTab === "futures" ? (
          <Suspense fallback={<p>Loading futures markets...</p>}>
            <FuturesMarket />
          </Suspense>
        ) : (
        <>
          {/* ── Card 1: Smart Account Setup ── */}
          <section className="card">
            <div className="card-title-row">
              <h2>Smart Account Setup</h2>
              {canUseSmartAccount && <span className="badge-status badge-ok">Configured</span>}
            </div>
            <p className="muted">
              Compute the deterministic address from your owner + salt, then deploy via the
              factory using CREATE2.
            </p>

            <div className="form-two-col">
              <div>
                <label className="label" htmlFor="ownerAddressInput">Owner address</label>
                <div className="input-with-btn">
                  <input
                    id="ownerAddressInput"
                    className="input input-full"
                    placeholder={address ?? "0x…"}
                    value={ownerAddressInput}
                    onChange={(event) => setOwnerAddressInput(event.target.value)}
                  />
                  <button
                    className="btn btn-secondary"
                    disabled={!address}
                    onClick={() => setOwnerAddressInput(address ?? "")}
                  >
                    Use my wallet
                  </button>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="saltInput">Salt</label>
                <input
                  id="saltInput"
                  className="input"
                  value={saltInput}
                  onChange={(event) => setSaltInput(event.target.value)}
                />
              </div>
            </div>

            <div className="predicted-block">
              <span className="label">Predicted smart account (CREATE2)</span>
              <div className="predicted-row">
                <code className="address-code">
                  {predictedAddressQuery.data ??
                    (canReadFactoryForOwner ? "Loading…" : "Configure factory + owner above")}
                </code>
                <button
                  className="btn"
                  disabled={!canReadFactoryForOwner || isOwnerTxPending}
                  onClick={() => void submitCreateAccount()}
                >
                  {isOwnerTxPending ? "Deploying…" : "Deploy Account"}
                </button>
              </div>
            </div>

            <div className="account-stats">
              <div className="account-stat">
                <span className="account-stat-label">Counter</span>
                <span className="account-stat-value">
                  {counterValueQuery.data !== undefined
                    ? counterValueQuery.data.toString()
                    : "—"}
                </span>
              </div>
              <div className="account-stat">
                <span className="account-stat-label">Balance</span>
                <span className="account-stat-value">
                  {smartAccountBalanceQuery.data
                    ? `${formatEther(smartAccountBalanceQuery.data.value)} ETH`
                    : canUseSmartAccount
                    ? "Loading…"
                    : "—"}
                </span>
              </div>
              <div className="account-stat">
                <span className="account-stat-label">Factory</span>
                <span className="account-stat-value account-stat-mono">
                  {factoryAddress
                    ? `${factoryAddress.slice(0, 6)}…${factoryAddress.slice(-4)}`
                    : "Not set"}
                </span>
              </div>
            </div>

            {lastTxHash && (
              <div className="tx-result">
                <span className="label">Last transaction — {lastAction}</span>
                <div className="tx-row">
                  <code>{lastTxHash}</code>
                  {txReceiptQuery.isSuccess && (
                    <span
                      className={`badge ${
                        txReceiptQuery.data.status === "success"
                          ? "badge-success"
                          : "badge-fail"
                      }`}
                    >
                      {txReceiptQuery.data.status === "success" ? "Success" : "Failed"}
                    </span>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ── Card 2: Owner Flow ── */}
          <section className="card">
            <div className="card-title-row">
              <h2>Owner Flow — Bundler</h2>
              {!canUseOwnerBundler && (
                <span className="badge-status badge-warn">
                  {!canUseSmartAccount ? "Deploy account first" : "Connect wallet"}
                </span>
              )}
            </div>
            <p className="muted">
              Signs and submits an <code>increment()</code> UserOperation through the bundler
              using your EOA as the owner. EntryPoint validates the ECDSA signature on-chain.
            </p>

            <div className="actions">
              <button
                className="btn"
                disabled={!canUseOwnerBundler || isAnyBundlerPending}
                onClick={() => void submitIncrementViaBundler("owner")}
              >
                {isOwnerBundlerPending
                  ? "Sending UserOperation…"
                  : "Increment via bundler (owner)"}
              </button>
            </div>

            {ownerBundlerStatus && (
              <div className="bundler-status-row">
                <span className="dot dot-green" />
                <span>{ownerBundlerStatus}</span>
              </div>
            )}
            {ownerBundlerError && (
              <div className="bundler-error">{ownerBundlerError}</div>
            )}
            {ownerUserOpHash && (
              <div className="result">
                <span className="label">UserOp Hash</span>
                <code>{ownerUserOpHash}</code>
              </div>
            )}
            {ownerBundlerPayload && (
              <details className="tech-details">
                <summary>Show raw UserOp payload</summary>
                <code>{ownerBundlerPayload}</code>
              </details>
            )}
          </section>

          {/* ── Card 3: Session Keys ── */}
          <section className="card">
            <div className="card-title-row">
              <h2>Session Keys</h2>
              {sessionKeyPrivateKey !== null && (
                <span className="badge-status badge-ok">Key loaded in memory</span>
              )}
            </div>
            <p className="muted">
              A session key is a temporary, scoped address that can call{" "}
              <code>increment()</code> without the owner's signature — until its expiry.
              The owner registers it on-chain; the key signs UserOps in-browser.
            </p>

            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={!canUseSmartAccount}
                onClick={() => {
                  const pk = generatePrivateKey();
                  const acc = privateKeyToAccount(pk);
                  setSessionKeyPrivateKey(pk);
                  setSessionKeyInput(acc.address);
                }}
              >
                Generate session key
              </button>
              {sessionKeyPrivateKey !== null && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSessionKeyPrivateKey(null)}
                >
                  Clear in-memory key
                </button>
              )}
            </div>

            <div className="form-two-col">
              <div>
                <label className="label" htmlFor="sessionKey">Session key address</label>
                <input
                  id="sessionKey"
                  className="input input-full"
                  placeholder="0x… (generate above or paste)"
                  value={sessionKeyInput}
                  onChange={(event) => setSessionKeyInput(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="sessionExpiry">Expiry (unix seconds)</label>
                <input
                  id="sessionExpiry"
                  className="input"
                  value={sessionExpiryInput}
                  onChange={(event) => setSessionExpiryInput(event.target.value)}
                />
                {sessionExpiry > 0 && (
                  <span className="input-hint">
                    {new Date(sessionExpiry * 1000).toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            {sessionKeyIsAddress && canUseSmartAccount && (
              <div className="session-status-grid">
                <div className="session-status-item">
                  <span className="label">Selector scope</span>
                  <span className={sessionAllowedQuery.data ? "text-ok" : "text-muted"}>
                    {sessionAllowedQuery.data === undefined
                      ? "Loading…"
                      : sessionAllowedQuery.data
                      ? "✓ increment() allowed"
                      : "✗ Not allowed"}
                  </span>
                </div>
                <div className="session-status-item">
                  <span className="label">On-chain config</span>
                  <span>
                    {sessionConfigQuery.data === undefined
                      ? "Loading…"
                      : (() => {
                          const [expiry, active] = sessionConfigQuery.data;
                          const expSec = Number(expiry);
                          if (expSec === 0) return "Not registered";
                          return `${active ? "Active" : "Inactive"} · expires ${new Date(expSec * 1000).toLocaleString()}`;
                        })()}
                  </span>
                </div>
                <div className="session-status-item">
                  <span className="label">Signing method</span>
                  <span>
                    {sessionKeyPrivateKey !== null
                      ? "In-memory key (no MetaMask)"
                      : connectedAddressMatchesSessionKey
                      ? "Connected wallet (eth_sign)"
                      : "Generate a key or connect matching wallet"}
                  </span>
                </div>
              </div>
            )}

            <div className="actions">
              <button
                className="btn"
                disabled={!canUseSmartAccount || !sessionKeyIsAddress || isOwnerTxPending}
                onClick={() => void submitAddSessionKey()}
              >
                Add session key
              </button>
              <button
                className="btn btn-secondary"
                disabled={!canUseSmartAccount || !sessionKeyIsAddress || isOwnerTxPending}
                onClick={() => void submitRevokeSessionKey()}
              >
                Revoke
              </button>
            </div>

            <div className="card-divider" />

            <h3 className="subsection-title">Submit as Session Key</h3>
            <p className="muted">
              Calls <code>increment()</code> via the session key — no owner signature, scope
              enforced on-chain by <code>validateUserOp</code>.
            </p>

            <div className="actions">
              <button
                className="btn"
                disabled={!canUseSessionBundler || isAnyBundlerPending}
                onClick={() => void submitIncrementViaBundler("session")}
              >
                {isSessionBundlerPending
                  ? "Sending UserOperation…"
                  : "Increment via bundler (session key)"}
              </button>
            </div>

            {sessionBundlerStatus && (
              <div className="bundler-status-row">
                <span className="dot dot-green" />
                <span>{sessionBundlerStatus}</span>
              </div>
            )}
            {sessionBundlerError && (
              <div className="bundler-error">{sessionBundlerError}</div>
            )}
            {sessionUserOpHash && (
              <div className="result">
                <span className="label">Session UserOp Hash</span>
                <code>{sessionUserOpHash}</code>
              </div>
            )}
            {sessionBundlerPayload && (
              <details className="tech-details">
                <summary>Show raw UserOp payload</summary>
                <code>{sessionBundlerPayload}</code>
              </details>
            )}
          </section>
        </>
        )}
      </main>
    </div>
  );
}

export default App;
