import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { useSmartAccount } from "../hooks/useSmartAccount.js";
import { SMART_ACCOUNT_ABI, COUNTER_ABI } from "../abis/index.js";
import { COUNTER_ADDRESS } from "../config.js";

export default function SmartAccountPage() {
  const { isConnected } = useAccount();
  const {
    ownerAddress,
    smartAccountAddress,
    counterValue,
    isLoadingAddress,
    isDeploying,
    deploy,
    refetchCounter,
  } = useSmartAccount();

  const [deployTx, setDeployTx] = useState(null);
  const [deployError, setDeployError] = useState(null);

  const [sessionKeyInput, setSessionKeyInput] = useState("");
  const [sessionExpiry, setSessionExpiry] = useState("");
  const [addKeyTx, setAddKeyTx] = useState(null);
  const [addKeyError, setAddKeyError] = useState(null);

  const [revokeKeyInput, setRevokeKeyInput] = useState("");
  const [revokeError, setRevokeError] = useState(null);
  const [revokeTx, setRevokeTx] = useState(null);

  const [incrError, setIncrError] = useState(null);
  const [incrTx, setIncrTx] = useState(null);

  const { writeContractAsync, isPending } = useWriteContract();

  if (!isConnected) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
        <p style={{ color: "#718096", marginBottom: "1rem" }}>
          Connect your wallet to manage your EpiChain Smart Account.
        </p>
      </div>
    );
  }

  const handleDeploy = async () => {
    setDeployError(null);
    setDeployTx(null);
    try {
      const hash = await deploy();
      setDeployTx(hash);
    } catch (err) {
      setDeployError(err.shortMessage ?? err.message);
    }
  };

  const handleAddSessionKey = async () => {
    setAddKeyError(null);
    setAddKeyTx(null);
    if (!sessionKeyInput) return;
    try {
      // Allow only the Counter.increment selector if not overridden.
      const incrementSelector = "0xd09de08a"; // keccak256("increment()")[0:4]
      const expiry = sessionExpiry ? BigInt(Math.floor(new Date(sessionExpiry).getTime() / 1000)) : 0n;
      const hash = await writeContractAsync({
        abi: SMART_ACCOUNT_ABI,
        address: smartAccountAddress,
        functionName: "addSessionKey",
        args: [sessionKeyInput, expiry, [incrementSelector]],
      });
      setAddKeyTx(hash);
      setSessionKeyInput("");
      setSessionExpiry("");
    } catch (err) {
      setAddKeyError(err.shortMessage ?? err.message);
    }
  };

  const handleRevokeSessionKey = async () => {
    setRevokeError(null);
    setRevokeTx(null);
    if (!revokeKeyInput) return;
    try {
      const hash = await writeContractAsync({
        abi: SMART_ACCOUNT_ABI,
        address: smartAccountAddress,
        functionName: "revokeSessionKey",
        args: [revokeKeyInput],
      });
      setRevokeTx(hash);
      setRevokeKeyInput("");
    } catch (err) {
      setRevokeError(err.shortMessage ?? err.message);
    }
  };

  const handleIncrement = async () => {
    setIncrError(null);
    setIncrTx(null);
    try {
      // Call SmartAccount.execute(counter, 0, increment())
      const data = "0xd09de08a"; // Counter.increment() selector
      const hash = await writeContractAsync({
        abi: SMART_ACCOUNT_ABI,
        address: smartAccountAddress,
        functionName: "execute",
        args: [COUNTER_ADDRESS, 0n, data],
      });
      setIncrTx(hash);
      setTimeout(refetchCounter, 3000);
    } catch (err) {
      setIncrError(err.shortMessage ?? err.message);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "1.5rem" }}>
        Smart Account
      </h1>

      {/* Account info */}
      <div className="card">
        <h2>Account Info</h2>
        <div className="form-group">
          <label>Owner EOA</label>
          <div className="addr">{ownerAddress}</div>
        </div>
        <div className="form-group">
          <label>Smart Account Address (counterfactual)</label>
          <div className="addr">
            {isLoadingAddress ? "Loading…" : smartAccountAddress ?? "—"}
          </div>
        </div>
        <div className="form-group">
          <label>Counter Value</label>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#63b3ed" }}>
            {counterValue !== undefined ? counterValue.toString() : "—"}
          </div>
        </div>

        <button
          className="btn-primary"
          onClick={handleDeploy}
          disabled={isDeploying}
        >
          {isDeploying ? "Deploying…" : "Deploy Smart Account"}
        </button>
        {deployTx && (
          <div className="msg-info mt-1">
            ✓ Deployment tx submitted:{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${deployTx}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {deployTx.slice(0, 14)}…
            </a>
          </div>
        )}
        {deployError && <div className="msg-error mt-1">{deployError}</div>}
      </div>

      {/* Owner actions */}
      <div className="card">
        <h2>Owner Actions</h2>
        <p style={{ fontSize: "0.85rem", color: "#718096", marginBottom: "1rem" }}>
          These calls go through your smart account (execute) — your EOA must be
          the owner.
        </p>

        <button
          className="btn-primary"
          onClick={handleIncrement}
          disabled={isPending || !smartAccountAddress}
        >
          {isPending ? "Submitting…" : "Increment Counter"}
        </button>
        {incrTx && (
          <div className="msg-info mt-1">
            ✓ Tx submitted:{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${incrTx}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {incrTx.slice(0, 14)}…
            </a>
          </div>
        )}
        {incrError && <div className="msg-error mt-1">{incrError}</div>}
      </div>

      {/* Session key management */}
      <div className="card">
        <h2>Session Key Management</h2>
        <p style={{ fontSize: "0.85rem", color: "#718096", marginBottom: "1rem" }}>
          Grant a secondary address temporary access to call{" "}
          <code>increment()</code> on the Counter contract.
        </p>

        <div className="form-group">
          <label>Session Key Address</label>
          <input
            type="text"
            placeholder="0x…"
            value={sessionKeyInput}
            onChange={(e) => setSessionKeyInput(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>Expiry (leave blank for no expiry)</label>
          <input
            type="datetime-local"
            value={sessionExpiry}
            onChange={(e) => setSessionExpiry(e.target.value)}
            className="input-datetime"
          />
        </div>
        <button
          className="btn-primary"
          onClick={handleAddSessionKey}
          disabled={isPending || !sessionKeyInput || !smartAccountAddress}
        >
          {isPending ? "Submitting…" : "Add Session Key"}
        </button>
        {addKeyTx && (
          <div className="msg-info mt-1">
            ✓ Session key added. Tx:{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${addKeyTx}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {addKeyTx.slice(0, 14)}…
            </a>
          </div>
        )}
        {addKeyError && <div className="msg-error mt-1">{addKeyError}</div>}

        <hr style={{ borderColor: "#2d3748", margin: "1rem 0" }} />

        <div className="form-group">
          <label>Revoke Session Key Address</label>
          <input
            type="text"
            placeholder="0x…"
            value={revokeKeyInput}
            onChange={(e) => setRevokeKeyInput(e.target.value)}
          />
        </div>
        <button
          className="btn-danger"
          onClick={handleRevokeSessionKey}
          disabled={isPending || !revokeKeyInput || !smartAccountAddress}
        >
          {isPending ? "Submitting…" : "Revoke Session Key"}
        </button>
        {revokeTx && (
          <div className="msg-info mt-1">✓ Session key revoked.</div>
        )}
        {revokeError && <div className="msg-error mt-1">{revokeError}</div>}
      </div>
    </div>
  );
}
