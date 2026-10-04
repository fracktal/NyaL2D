import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { BridgeMessage, PageMessage } from "../src/agent/bridge-protocol";
import { createToolHub, NOT_CONNECTED, type ToolHub } from "../server/tool-hub";

let hub: ToolHub;
let http: Server;
let port: number;

beforeEach(async () => {
  hub = createToolHub({ log: () => {} });
  http = createServer().on("upgrade", (req, socket, head) => hub.handleUpgrade(req, socket, head));
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  port = (http.address() as { port: number }).port;
});
afterEach(async () => {
  await hub.close();
  await new Promise((r) => http.close(r));
});

/** A fake NyaL2D page: answers each call with the tool name and arguments. */
async function connectPage(origin?: string): Promise<{ ws: WebSocket; seen: BridgeMessage[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`, origin ? { origin } : {});
  const seen: BridgeMessage[] = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw)) as BridgeMessage;
    seen.push(msg);
    if (msg.type === "call") {
      const reply: PageMessage = msg.name === "fail" ? { type: "result", id: msg.id, result: { ok: false, error: "nope" } } : { type: "result", id: msg.id, result: { ok: true, data: { echo: msg.name, args: msg.args } } };
      ws.send(JSON.stringify(reply));
    }
  });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  const tools: PageMessage = { type: "tools", tools: [{ name: "inspect_model", description: "d", inputSchema: { type: "object", properties: {} } }] };
  ws.send(JSON.stringify(tools));
  return { ws, seen };
}

async function mcpClient(): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await hub.createMcpServer().connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}

describe("tool hub", () => {
  it("reports a missing page instead of hanging", async () => {
    expect(await hub.call("inspect_model", {})).toEqual({ ok: false, error: NOT_CONNECTED });
    expect(await hub.waitForPage(50)).toBe(false);
  });

  it("serves the page's tools over MCP and relays calls", async () => {
    await connectPage("http://localhost:5173");
    expect(await hub.waitForPage(1000)).toBe(true);
    const client = await mcpClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["inspect_model"]);
    const res = await client.callTool({ name: "inspect_model", arguments: { a: 1 } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse((res.content as { text: string }[])[0].text)).toEqual({ echo: "inspect_model", args: { a: 1 } });
    const bad = await client.callTool({ name: "fail", arguments: {} });
    expect(bad.isError).toBe(true);
    await client.close();
  });

  it("refuses pages from other origins", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`, { origin: "https://evil.example" });
    const code = await new Promise<number>((r) => ws.on("close", (c) => r(c)));
    expect(code).toBe(1008);
    expect(hub.connected).toBe(false);
  });

  it("lets the newest tab take over and tells the page who is driving", async () => {
    const first = await connectPage();
    const closed = new Promise((r) => first.ws.on("close", r));
    hub.announce({ name: "Claude Code", version: "app" });
    const second = await connectPage();
    await closed;
    await hub.waitForPage(1000);
    expect(second.seen[0]).toEqual({ type: "client", name: "Claude Code", version: "app" });
    expect(await hub.call("x", {})).toMatchObject({ ok: true, data: { echo: "x" } });
  });
});
