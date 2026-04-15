import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

export const wagmiConfig = getDefaultConfig({
  appName: "EpiChain",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "",
  chains: [sepolia, mainnet],
  transports: {
    [sepolia.id]: import.meta.env.VITE_SEPOLIA_RPC_URL
      ? http(import.meta.env.VITE_SEPOLIA_RPC_URL)
      : http(),
    [mainnet.id]: http(),
  },
  ssr: false,
});
