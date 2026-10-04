/**
 * NyaL2D app server: everything the page needs besides its static files,
 * mounted on the same HTTP server and port as the app (the Vite dev/preview
 * server, see server/vite-plugin.ts), so there is one port to think about.
 *
 *   GET  /llm/health   which LLM provider answers, and whether it is ready
 *   POST /llm/turn     one model turn (API-key providers, mock): the loop runs in the page
 *   POST /llm/run      one whole request run by Claude Code, streamed as NDJSON
 *   WS   /llm/bridge   the page's tool connection (tool hub)
 *   POST /llm/mcp      the page's tools as an MCP server (Streamable HTTP)
 *
 * Provider credentials stay in this process; keys never reach the browser.
 *
 * Environment:
 *   NYAL2D_LLM_PROVIDER  auto (default) | anthropic | claude-code | mock
 *                        auto: anthropic when ANTHROPIC_API_KEY is set, otherwise claude-code
 *   NYAL2D_LLM_MODEL     model id for the provider (anthropic default: claude-opus-5-5)
 *   NYAL2D_LLM_EFFORT    low | medium (default) | high | xhigh | max
 *   NYAL2D_CLAUDE_BIN    Claude Code CLI path (default: claude)
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, Server as HttpServer, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { RunEvent, RunRequest, TurnRequest } from "../src/agent/protocol.ts";
import { isLocalOrigin } from "./origin.ts";
import { createAnthropicProvider } from "./providers/anthropic.ts";
import { createClaudeCodeProvider } from "./providers/claude-code.ts";
import { createMockProvider } from "./providers/mock.ts";
import { ProviderError, type Provider } from "./providers/types.ts";
import { createToolHub, type ToolHub } from "./tool-hub.ts";

const MAX_BODY = 25 * 1024 * 1024;

/** Where a running app server records its address, so server/mcp-bridge.ts can find it. */
export const DISCOVERY_FILE = join(tmpdir(), "nyal2d", "server.json");

export function providerName(env: NodeJS.ProcessEnv): string {
  const name = env.NYAL2D_LLM_PROVIDER || "auto";
  if (name !== "auto") return name;
  return env.ANTHROPIC_API_KEY ? "anthropic" : "claude-code";
}

export function createProvider(env: NodeJS.ProcessEnv, deps: { hub: ToolHub; mcpUrl: () => string }): Provider {
  const name = providerName(env);
  if (name === "mock") return createMockProvider();
  if (name === "claude-code") return createClaudeCodeProvider({ ...deps, model: env.NYAL2D_LLM_MODEL || undefined, command: env.NYAL2D_CLAUDE_BIN || undefined });
  if (name === "anthropic") {
    return createAnthropicProvider({
      model: env.NYAL2D_LLM_MODEL || undefined,
      effort: (env.NYAL2D_LLM_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) || undefined,
    });
  }
  throw new Error(`알 수 없는 NYAL2D_LLM_PROVIDER: ${name} (auto, anthropic, claude-code, mock)`);
}

export interface AppServer {
  readonly hub: ToolHub;
  readonly provider: Provider;
  /** The address it is reachable at, once attached to a listening server. */
  readonly url: string | undefined;
  /** Connect-style middleware: answers /llm/* and passes everything else on. */
  handle(req: IncomingMessage, res: ServerResponse, next?: () => void): void;
  /** Answer WebSocket upgrades for /llm/bridge on `server`, and learn its address once it listens. */
  attach(server: HttpServer): void;
  close(): Promise<void>;
}

export function createAppServer(opts: { env?: NodeJS.ProcessEnv; log?: (msg: string) => void; discovery?: boolean } = {}): AppServer {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((m: string) => console.error(`[nyal2d] ${m}`));
  const hub = createToolHub({ log });
  let url: string | undefined;
  const provider = createProvider(env, { hub, mcpUrl: () => `${url ?? "http://127.0.0.1"}/llm/mcp?via=panel` });
  let wroteDiscovery = false;

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname === "/llm/bridge") hub.handleUpgrade(req, socket, head);
  };

  const app: AppServer = {
    hub,
    provider,
    get url() {
      return url;
    },

    handle(req, res, next) {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (!path.startsWith("/llm/")) return next ? next() : send(res, 404, { error: "없는 경로" });
      void route(req, res, path);
    },

    attach(server) {
      server.on("upgrade", onUpgrade);
      const onListening = () => {
        const a = server.address();
        if (!a || typeof a === "string") return;
        url = `http://${a.family === "IPv6" ? `[${a.address}]` : a.address}:${a.port}`;
        if (opts.discovery !== false) {
          try {
            mkdirSync(join(tmpdir(), "nyal2d"), { recursive: true });
            writeFileSync(DISCOVERY_FILE, JSON.stringify({ url, pid: process.pid }));
            wroteDiscovery = true;
          } catch {
            // Without the file, mcp-bridge needs NYAL2D_URL; the app itself is unaffected.
          }
        }
        void provider.health().then((h) => log(`에이전트: ${h.provider} · ${h.ready ? "준비됨" : `준비 안 됨 (${h.detail ?? "확인 필요"})`}`));
      };
      if (server.listening) onListening();
      else server.once("listening", onListening);
    },

    async close() {
      await hub.close();
      await provider.close?.();
      if (wroteDiscovery) {
        try {
          if ((JSON.parse(readFileSync(DISCOVERY_FILE, "utf8")) as { pid?: number }).pid === process.pid) rmSync(DISCOVERY_FILE);
        } catch {
          // Already gone or replaced by a newer server.
        }
      }
    },
  };

  async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (!isLocalOrigin(req.headers.origin)) return send(res, 403, { error: "이 서버는 로컬 페이지에서만 쓸 수 있습니다" });
    try {
      if (req.method === "GET" && path === "/llm/health") return send(res, 200, await provider.health());
      if (path === "/llm/mcp") return await serveMcp(req, res);
      if (req.method === "POST" && path === "/llm/run") {
        if (!provider.run) return send(res, 400, { error: "이 제공자는 /llm/turn을 씁니다" });
        const body = await readJson(req);
        if (!isRunRequest(body)) return send(res, 400, { error: "prompt가 필요합니다" });
        const abort = abortOnClose(res);
        res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
        const emit = (e: RunEvent) => res.write(`${JSON.stringify(e)}\n`);
        await provider.run(body, abort.signal, emit);
        return void res.end();
      }
      if (req.method === "POST" && path === "/llm/turn") {
        if (!provider.turn) return send(res, 400, { error: "이 제공자는 /llm/run을 씁니다" });
        const body = await readJson(req);
        if (!isTurnRequest(body)) return send(res, 400, { error: "system, messages, tools가 필요합니다" });
        return send(res, 200, await provider.turn(body, abortOnClose(res).signal));
      }
      send(res, 404, { error: "없는 경로" });
    } catch (err) {
      const e = err instanceof ProviderError ? err : new ProviderError((err as Error).message, 500);
      if (!res.headersSent) send(res, e.status, { error: e.message, retryable: e.retryable });
      else res.end();
    }
  }

  async function serveMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Stateless Streamable HTTP: a fresh MCP server per request. Requests from
    // the panel's own Claude Code run are already announced by the provider.
    const via = new URL(req.url ?? "/", "http://localhost").searchParams.get("via");
    const server = hub.createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    // Set only by an initialize request: show the page which client is driving it.
    const client = server.getClientVersion();
    if (client && via !== "panel") hub.announce(client);
  }

  return app;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function abortOnClose(res: ServerResponse): AbortController {
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  return abort;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new ProviderError("요청이 너무 큽니다", 413);
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProviderError("JSON 본문이 아닙니다", 400);
  }
}

function isRunRequest(v: unknown): v is RunRequest {
  const r = v as RunRequest;
  return !!r && typeof r.prompt === "string" && !!r.prompt.trim() && (r.sessionId === undefined || typeof r.sessionId === "string");
}

function isTurnRequest(v: unknown): v is TurnRequest {
  const r = v as TurnRequest;
  return !!r && typeof r.system === "string" && Array.isArray(r.messages) && Array.isArray(r.tools);
}
