import { defineConfig } from "vite";

// The agent talks to the local LLM proxy (server/llm-proxy.ts) through /llm,
// so the page stays same-origin and API keys stay in the proxy process.
const proxy = { "/llm": { target: `http://127.0.0.1:${process.env.NYAL2D_PROXY_PORT ?? 8787}` } };

export default defineConfig({
  base: "./",
  server: { proxy },
  preview: { proxy },
});
