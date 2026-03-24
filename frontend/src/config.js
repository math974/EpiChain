import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";

export const wagmiConfig = getDefaultConfig({
  appName: "EpiChain",
  projectId: import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID ?? "EpiChain",
  chains: [sepolia],
  ssr: false,
});

export const FACTORY_ADDRESS =
  import.meta.env.VITE_FACTORY_ADDRESS ??
  "0x0000000000000000000000000000000000000000";

export const COUNTER_ADDRESS =
  import.meta.env.VITE_COUNTER_ADDRESS ??
  "0x0000000000000000000000000000000000000000";

export const INDEXER_URL =
  import.meta.env.VITE_INDEXER_URL ?? "http://localhost:3001";

export const INDEXER_WS =
  import.meta.env.VITE_INDEXER_WS ?? "ws://localhost:3001/ws";

export const ENTRY_POINT_ADDRESS =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
