import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,

  // Required for @huggingface/transformers WASM SharedArrayBuffer
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  // Enable Web Worker bundling
  worker: {
    format: 'es',
  },

  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
}));

