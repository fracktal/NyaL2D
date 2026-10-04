import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { BridgeMessage } from "../src/agent/bridge-protocol";
import { createAppServer, providerName, type AppServer } from "../server/app-server";
import { findAppUrl } from "../server/mcp-bridge";

let app: AppServer;
let http: Server;
let base: string;

beforeEach(async () => {
  app = createAppServer({ env: { NYAL2D_LLM_PROVIDER: "mock" }, log: () => {}, discovery: false });
  http = createServer((req, res) => app.handle(req, res, () => res.writeHead(200).end("static")));
  app.attach(http);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterEach(async () => {
  await app.close();
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
});

describe("app server (one port for app, LLM and tools)", () => {
  it("knows its own address once listening", () => {
    expect(app.url).toBe(base);
  });

  it("answers /llm routes and leaves the rest to the static server", async () => {
    expect(await (await fetch(`${base}/llm/health`)).json()).toMatchObject({ provider: "mock", ready: true });
    expect(await (await fetch(`${base}/index.html`)).text()).toBe("static");
    expect((await fetch(`${base}/llm/nope`)).status).toBe(404);
  });

  it("refuses requests from other sites", async () => {
    const res = await fetch(`${base}/llm/health`, { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("carries the page's tools over /llm/bridge to MCP clients at /llm/mcp", async () => {
    const page = new WebSocket(`${base.replace("http", "ws")}/llm/bridge`, { origin: base });
    const seen: BridgeMessage[] = [];
    page.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as BridgeMessage;
      seen.push(msg);
      if (msg.type === "call") page.send(JSON.stringify({ type: "result", id: msg.id, result: { ok: true, data: { echo: msg.name } } }));
    });
    await new Promise((r) => page.once("open", r));
    page.send(JSON.stringify({ type: "tools", tools: [{ name: "inspect_model", description: "d", inputSchema: { type: "object", properties: {} } }] }));
    expect(await app.hub.waitForPage(1000)).toBe(true);

    const client = new Client({ name: "Claude Desktop", version: "1.2" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/llm/mcp`)));
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["inspect_model"]);
    const res = await client.callTool({ name: "inspect_model", arguments: {} });
    expect(JSON.parse((res.content as { text: string }[])[0].text)).toEqual({ echo: "inspect_model" });
    // The page is told which client is driving it.
    expect(seen).toContainEqual({ type: "client", name: "Claude Desktop", version: "1.2" });
    await client.close();
    page.close();
  });
});

describe("provider choice", () => {
  it("uses the API key when there is one, otherwise the signed-in Claude Code", () => {
    expect(providerName({})).toBe("claude-code");
    expect(providerName({ ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
    expect(providerName({ NYAL2D_LLM_PROVIDER: "mock", ANTHROPIC_API_KEY: "k" })).toBe("mock");
  });
});

describe("mcp-bridge finds the app", () => {
  const dir = mkdtempSync(join(tmpdir(), "nyal2d-test-"));
  it("reads the address a running app recorded", () => {
    const file = join(dir, "a.json");
    writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:47311", pid: process.pid }));
    expect(findAppUrl({}, file)).toBe("http://127.0.0.1:47311");
  });
  it("ignores a record left by an app that is gone", () => {
    const file = join(dir, "b.json");
    writeFileSync(file, JSON.stringify({ url: "http://127.0.0.1:47311", pid: 2 ** 22 + 12345 }));
    expect(findAppUrl({}, file)).toBeUndefined();
  });
  it("prefers NYAL2D_URL", () => {
    expect(findAppUrl({ NYAL2D_URL: "http://127.0.0.1:5000/" }, join(dir, "none.json"))).toBe("http://127.0.0.1:5000");
  });
});
