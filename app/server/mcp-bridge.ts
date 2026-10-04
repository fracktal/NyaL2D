/**
 * NyaL2D MCP bridge: lets Claude Code, Claude Desktop or any MCP client use
 * the agent tools of a NyaL2D page open in the browser.
 *
 *   MCP client ──stdio──▶ this process ──WebSocket (127.0.0.1)──▶ NyaL2D page ──▶ tools
 *
 * The MCP client brings the model (the person's own Claude plan), so no API
 * key is needed. The page runs every call through the same tool layer as the
 * in-app agent, so edits land in its change timeline and can be undone.
 *
 *   claude mcp add nyal2d -- node /path/to/app/server/mcp-bridge.ts
 *
 * Environment: NYAL2D_BRIDGE_PORT (default 8788).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { startToolHub } from "./tool-hub.ts";

export async function startBridge(): Promise<void> {
  const hub = await startToolHub({ log: (m) => console.error(`[nyal2d-bridge] ${m}`) });
  const server = hub.createMcpServer();
  server.oninitialized = () => hub.announce(server.getClientVersion() ?? {});
  await server.connect(new StdioServerTransport());
  console.error(`[nyal2d-bridge] ws://127.0.0.1:${hub.port}/bridge 에서 NyaL2D 페이지를 기다립니다`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBridge().catch(() => process.exit(1));
}
