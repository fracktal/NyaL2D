/**
 * Tool hub: holds the WebSocket connection to a NyaL2D page and exposes that
 * page's agent tools as an MCP server.
 *
 * It lives in the app server (server/app-server.ts), on the same port as the
 * app: the page connects to /llm/bridge, and MCP clients reach the tools at
 * /llm/mcp, either the "claude-code" provider (requests typed in the Agent
 * panel) or server/mcp-bridge.ts (Claude Code / Claude Desktop the person runs).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { type BridgeMessage, type PageMessage, type WireToolResult } from "../src/agent/bridge-protocol.ts";
import { MCP_INSTRUCTIONS } from "../src/agent/prompt.ts";
import type { ToolSpec } from "../src/agent/tools.ts";
import { isLocalOrigin } from "./origin.ts";

const CALL_TIMEOUT_MS = 60_000;

export const NOT_CONNECTED =
  "NyaL2D 페이지가 연결되어 있지 않습니다. 브라우저에서 NyaL2D를 열고 에이전트 탭의 플러그 버튼(Claude 앱 연결)을 켜 주세요. (The NyaL2D page is not connected: open the app and turn on the plug button in the Agent tab.)";

/** Listed before any page has connected, so a client still has something to call. */
const STATUS_TOOL: ToolSpec = {
  name: "list_capabilities",
  description: "NyaL2D 앱 연결 상태와 지금 쓸 수 있는 도구 목록. 페이지가 연결되면 전체 도구가 나타난다.",
  inputSchema: { type: "object", properties: {} },
};

export interface ToolHub {
  readonly connected: boolean;
  /** Take over an HTTP upgrade request for the page's WebSocket. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Resolves once a page has sent its tool list, or after `timeoutMs`. */
  waitForPage(timeoutMs: number): Promise<boolean>;
  call(name: string, args: unknown): Promise<WireToolResult>;
  /** A fresh MCP server whose tools are the page's tools. */
  createMcpServer(): Server;
  /** Tell the page which client is driving it (shown in its Agent panel). */
  announce(client: { name?: string; version?: string }): void;
  close(): Promise<void>;
}

export function createToolHub(opts: { log?: (msg: string) => void } = {}): ToolHub {
  const log = opts.log ?? ((m: string) => console.error(`[nyal2d] ${m}`));
  let page: WebSocket | undefined;
  let tools: ToolSpec[] = [];
  let client: { name?: string; version?: string } = {};
  let nextId = 1;
  const pending = new Map<string, { resolve: (r: WireToolResult) => void; timer: NodeJS.Timeout }>();
  const waiters = new Set<() => void>();
  const servers = new Set<Server>();

  const send = (msg: BridgeMessage) => page?.send(JSON.stringify(msg));
  const toolsChanged = () => {
    for (const s of servers) s.sendToolListChanged().catch(() => {});
  };

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req) => {
    if (!isLocalOrigin(req.headers.origin)) {
      ws.close(1008, "local pages only");
      return;
    }
    // The newest tab wins: one page is driven at a time.
    if (page && page !== ws) page.close(1000, "replaced by another NyaL2D tab");
    page = ws;
    log("NyaL2D 페이지 연결됨");
    send({ type: "client", ...client });
    ws.on("message", (raw) => {
      let msg: PageMessage;
      try {
        msg = JSON.parse(String(raw)) as PageMessage;
      } catch {
        return;
      }
      if (msg.type === "tools") {
        const changed = JSON.stringify(msg.tools) !== JSON.stringify(tools);
        tools = msg.tools;
        for (const w of waiters) w();
        if (changed) toolsChanged();
      } else if (msg.type === "result") {
        const p = pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.id);
        p.resolve(msg.result);
      }
    });
    ws.on("close", () => {
      if (page !== ws) return;
      page = undefined;
      tools = [];
      log("NyaL2D 페이지 연결 끊김");
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: NOT_CONNECTED });
        pending.delete(id);
      }
      toolsChanged();
    });
  });

  const hub: ToolHub = {
    get connected() {
      return !!page;
    },

    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    },

    waitForPage(timeoutMs) {
      if (page && tools.length) return Promise.resolve(true);
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve(!!page && tools.length > 0);
        };
        const timer = setTimeout(done, timeoutMs);
        waiters.add(done);
      });
    },

    call(name, args) {
      if (!page) return Promise.resolve({ ok: false, error: NOT_CONNECTED });
      const id = String(nextId++);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: "NyaL2D 페이지가 제때 응답하지 않았습니다" });
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve, timer });
        send({ type: "call", id, name, args });
      });
    },

    createMcpServer() {
      const server = new Server({ name: "nyal2d", version: "0.1.0" }, { capabilities: { tools: { listChanged: true } }, instructions: MCP_INSTRUCTIONS });
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        await hub.waitForPage(5_000);
        const list = tools.length ? tools : [STATUS_TOOL];
        return { tools: list.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: "object" } })) };
      });
      server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
        const result = await hub.call(req.params.name, req.params.arguments ?? {});
        if (!result.ok) return { content: [{ type: "text", text: result.error }], isError: true };
        const content: CallToolResult["content"] = [{ type: "text", text: JSON.stringify(result.data ?? null) }];
        if (result.image) content.push({ type: "image", data: result.image.base64, mimeType: result.image.mediaType });
        return { content };
      });
      servers.add(server);
      server.onclose = () => servers.delete(server);
      return server;
    },

    announce(c) {
      client = c;
      send({ type: "client", ...c });
    },

    async close() {
      for (const s of servers) await s.close().catch(() => {});
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
  return hub;
}
