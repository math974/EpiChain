/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_SEPOLIA_RPC_URL?: string;
  readonly VITE_BUNDLER_URL?: string;
  readonly VITE_FACTORY_ADDRESS?: `0x${string}`;
  readonly VITE_COUNTER_ADDRESS?: `0x${string}`;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
