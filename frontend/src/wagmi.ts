import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { sepolia } from "wagmi/chains";

// In dev, Vite proxies /rpc/sepolia → actual RPC to avoid CORS from Docker IPs.
// In production, VITE_SEPOLIA_RPC_URL must be set (or nginx handles the proxy).
const sepoliaTransport = import.meta.env.DEV
  ? http("/rpc/sepolia")
  : import.meta.env.VITE_SEPOLIA_RPC_URL
  ? http(import.meta.env.VITE_SEPOLIA_RPC_URL)
  : http();

export const wagmiConfig = getDefaultConfig({
  appName: "EpiChain",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "",
  chains: [sepolia],
  transports: {
    [sepolia.id]: sepoliaTransport,
  },
  ssr: false,
});
