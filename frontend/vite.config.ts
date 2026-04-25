import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Proxy Sepolia RPC calls through the dev server to avoid CORS issues when
  // running inside Docker (browser origin is 172.18.x.x which public RPCs block).
  const sepoliaTarget =
    env.VITE_SEPOLIA_RPC_URL || "https://rpc2.sepolia.org";

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      watch: {
        usePolling: process.env.CHOKIDAR_USEPOLLING === "true",
      },
      proxy: {
        "/rpc/sepolia": {
          target: sepoliaTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rpc\/sepolia/, ""),
        },
      },
    },
  };
});
