import { defineConfig } from "vite";
import { nyal2dServer } from "./server/vite-plugin.ts";

// One port for everything: the app, the agent's LLM endpoint (/llm) and the
// tool connection. The default is uncommon on purpose; when it is taken, Vite
// moves to the next free port and prints the address. NYAL2D_PORT overrides it.
const port = Number(process.env.NYAL2D_PORT ?? 47310);
const host = "127.0.0.1";

export default defineConfig({
  base: "./",
  plugins: [nyal2dServer()],
  server: { port, host },
  preview: { port, host },
});
