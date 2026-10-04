import type { Server as HttpServer } from "node:http";
import type { Plugin } from "vite";
import { createAppServer, type AppServer } from "./app-server.ts";

/**
 * Mounts the NyaL2D app server (LLM providers, tool hub, MCP endpoint) on the
 * Vite dev and preview servers, so `npm run dev` is the only thing to start
 * and the app, the agent and the tool connection share one port.
 */
export function nyal2dServer(): Plugin {
  let app: AppServer | undefined;
  const mount = (server: { middlewares: { use(fn: AppServer["handle"]): void }; httpServer: unknown }) => {
    app = createAppServer();
    server.middlewares.use(app.handle);
    if (server.httpServer) app.attach(server.httpServer as HttpServer);
    (server.httpServer as HttpServer | null)?.once("close", () => void app?.close());
  };
  return {
    name: "nyal2d-server",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
