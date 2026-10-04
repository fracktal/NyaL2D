/**
 * NyaL2D local LLM proxy.
 *
 * The browser agent loop sends one model turn at a time in the neutral format
 * of src/agent/protocol.ts; this process holds the provider credentials and
 * forwards the turn. Keys never reach the browser.
 *
 *   node server/llm-proxy.ts                      # Anthropic, key from ANTHROPIC_API_KEY or `ant auth login`
 *   NYAL2D_LLM_PROVIDER=claude-code node server/llm-proxy.ts   # Claude Code CLI with your Claude login, no key
 *   NYAL2D_LLM_PROVIDER=mock node server/llm-proxy.ts   # scripted, no key
 *
 * Environment:
 *   NYAL2D_LLM_PROVIDER  anthropic (default) | claude-code | mock
 *   NYAL2D_LLM_MODEL     model id for the provider (anthropic default: claude-opus-5-5)
 *   NYAL2D_LLM_EFFORT    low | medium (default) | high | xhigh | max
 *   NYAL2D_PROXY_PORT    default 8787 (the Vite dev/preview server forwards /llm here)
 *   NYAL2D_BRIDGE_PORT   default 8788 (claude-code: WebSocket the page connects to for tool calls)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import type { RunEvent, RunRequest, TurnRequest } from "../src/agent/protocol.ts";
import { createAnthropicProvider } from "./providers/anthropic.ts";
import { createClaudeCodeProvider } from "./providers/claude-code.ts";
import { createMockProvider } from "./providers/mock.ts";
import { isLocalOrigin } from "./origin.ts";
import { ProviderError, type Provider } from "./providers/types.ts";

export { isLocalOrigin };

const MAX_BODY = 25 * 1024 * 1024;

export async function createProvider(env: NodeJS.ProcessEnv = process.env, proxyPort = 8787): Promise<Provider> {
  const name = env.NYAL2D_LLM_PROVIDER ?? "anthropic";
  if (name === "mock") return createMockProvider();
  if (name === "claude-code") return createClaudeCodeProvider({ proxyPort, model: env.NYAL2D_LLM_MODEL || undefined, command: env.NYAL2D_CLAUDE_BIN || undefined });
  if (name === "anthropic") {
    return createAnthropicProvider({
      model: env.NYAL2D_LLM_MODEL || undefined,
      effort: (env.NYAL2D_LLM_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) || undefined,
    });
  }
  throw new Error(`알 수 없는 NYAL2D_LLM_PROVIDER: ${name} (anthropic, claude-code, mock)`);
}


function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
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

export function createProxyServer(provider: Provider) {
  return createServer(async (req, res) => {
    if (!isLocalOrigin(req.headers.origin)) return send(res, 403, { error: "이 프록시는 로컬 페이지에서만 쓸 수 있습니다" });
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/llm/health") return send(res, 200, await provider.health());
      if (provider.handle && (await provider.handle(req, res, url))) return;
      if (req.method === "POST" && url.pathname === "/llm/run") {
        if (!provider.run) return send(res, 400, { error: "이 제공자는 /llm/turn을 씁니다" });
        const body = await readJson(req);
        if (!isRunRequest(body)) return send(res, 400, { error: "prompt가 필요합니다" });
        const abort = new AbortController();
        res.on("close", () => {
          if (!res.writableFinished) abort.abort();
        });
        res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
        const emit = (e: RunEvent) => res.write(`${JSON.stringify(e)}\n`);
        await provider.run(body, abort.signal, emit);
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/llm/turn") {
        if (!provider.turn) return send(res, 400, { error: "이 제공자는 /llm/run을 씁니다" });
        const body = await readJson(req);
        if (!isTurnRequest(body)) return send(res, 400, { error: "system, messages, tools가 필요합니다" });
        const abort = new AbortController();
        res.on("close", () => {
          if (!res.writableFinished) abort.abort();
        });
        return send(res, 200, await provider.turn(body, abort.signal));
      }
      send(res, 404, { error: "없는 경로" });
    } catch (err) {
      const e = err instanceof ProviderError ? err : new ProviderError((err as Error).message, 500);
      if (!res.headersSent) send(res, e.status, { error: e.message, retryable: e.retryable });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.NYAL2D_PROXY_PORT ?? 8787);
  const provider = await createProvider(process.env, port);
  createProxyServer(provider).listen(port, "127.0.0.1", async () => {
    const h = await provider.health();
    console.log(`NyaL2D LLM proxy · http://127.0.0.1:${port} · ${h.provider}/${h.model} · ${h.ready ? "ready" : `not ready: ${h.detail}`}`);
  });
}
