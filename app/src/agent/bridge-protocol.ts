/**
 * WebSocket messages between a NyaL2D page and the MCP bridge
 * (server/mcp-bridge.ts). The bridge exposes the page's agent tools to an
 * MCP client such as Claude Code or Claude Desktop, so the person's own
 * Claude plan drives the app and no API key is involved.
 */
import type { ToolSpec } from "./tools";

export type WireToolResult =
  | { ok: true; data: unknown; image?: { mediaType: string; base64: string } }
  | { ok: false; error: string };

/** Page → bridge. */
export type PageMessage =
  | { type: "tools"; tools: ToolSpec[] }
  | { type: "result"; id: string; result: WireToolResult };

/** Bridge → page. */
export type BridgeMessage =
  | { type: "client"; name?: string; version?: string }
  | { type: "call"; id: string; name: string; args: unknown };

export const DEFAULT_BRIDGE_PORT = 8788;
