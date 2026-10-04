/**
 * NyaL2D MCP bridge: lets Claude Code, Claude Desktop or any MCP client the
 * person runs use the agent tools of the NyaL2D page open in the browser.
 *
 *   MCP client ──stdio──▶ this process ──HTTP /llm/mcp──▶ app server (npm run dev) ──▶ page tools
 *
 * The MCP client brings the model (the person's own Claude plan), so no API
 * key is needed. The page runs every call through the same tool layer as the
 * in-app agent, so edits land in its change timeline and can be undone.
 *
 *   claude mcp add nyal2d -- node /path/to/app/server/mcp-bridge.ts
 *
 * It finds the running app by itself (the app server records its address in
 * a file under the system temp folder), whichever port the app ended up on.
 * NYAL2D_URL (e.g. http://127.0.0.1:47310) overrides that.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MCP_INSTRUCTIONS } from "../src/agent/prompt.ts";
import { DISCOVERY_FILE } from "./app-server.ts";

const NO_APP =
  "NyaL2D 앱이 실행 중이 아닙니다. app 폴더에서 `npm run dev`로 앱을 띄우고 브라우저에서 연 뒤, 에이전트 탭의 플러그 버튼(Claude 앱 연결)을 켜 주세요. (NyaL2D is not running: start it with `npm run dev`, open it, and turn on the plug button in the Agent tab.)";

const STATUS_TOOL: Tool = {
  name: "list_capabilities",
  description: "NyaL2D 앱 연결 상태와 지금 쓸 수 있는 도구 목록. 앱이 연결되면 전체 도구가 나타난다.",
  inputSchema: { type: "object", properties: {} },
};

/** Address of the running app server, or undefined when none is recorded. */
export function findAppUrl(env: NodeJS.ProcessEnv = process.env, file = DISCOVERY_FILE): string | undefined {
  if (env.NYAL2D_URL) return env.NYAL2D_URL.replace(/\/$/, "");
  try {
    const { url, pid } = JSON.parse(readFileSync(file, "utf8")) as { url?: string; pid?: number };
    if (!url) return undefined;
    if (pid) process.kill(pid, 0); // throws when that server is gone
    return url;
  } catch {
    return undefined;
  }
}

export async function startBridge(): Promise<void> {
  const log = (m: string) => console.error(`[nyal2d-bridge] ${m}`);
  const server = new Server({ name: "nyal2d", version: "0.1.0" }, { capabilities: { tools: { listChanged: true } }, instructions: MCP_INSTRUCTIONS });
  let remote: { url: string; client: Client } | undefined;

  async function connect(): Promise<Client | undefined> {
    const url = findAppUrl();
    if (!url) return undefined;
    if (remote?.url === url) return remote.client;
    await remote?.client.close().catch(() => {});
    remote = undefined;
    // Introduce ourselves as the real client, so the page shows "Claude Desktop" rather than the bridge.
    const info = server.getClientVersion() ?? { name: "MCP client", version: "0" };
    const client = new Client({ name: info.name, version: info.version });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/llm/mcp`)));
    } catch (err) {
      log(`${url} 에 연결하지 못했습니다: ${(err as Error).message}`);
      return undefined;
    }
    log(`NyaL2D 앱 연결됨 (${url})`);
    remote = { url, client };
    return client;
  }

  /** Run `fn` against the app, reconnecting once if the app restarted on another port. */
  async function withApp<T>(fn: (c: Client) => Promise<T>): Promise<T | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const client = await connect();
      if (!client) return undefined;
      try {
        return await fn(client);
      } catch {
        await remote?.client.close().catch(() => {});
        remote = undefined;
      }
    }
    return undefined;
  }

  let lastTools = "";
  const listTools = async (): Promise<Tool[]> => (await withApp(async (c) => (await c.listTools()).tools)) ?? [STATUS_TOOL];
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await listTools();
    lastTools = JSON.stringify(tools);
    return { tools };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const result = await withApp((c) => c.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} }) as Promise<CallToolResult>);
    return result ?? { content: [{ type: "text", text: NO_APP }], isError: true };
  });

  // The app can start, stop or move after the client connected: tell the client when its tools change.
  server.oninitialized = () => {
    const poll = async () => {
      const json = JSON.stringify(await listTools());
      if (lastTools && json !== lastTools) {
        lastTools = json;
        server.sendToolListChanged().catch(() => {});
      }
      setTimeout(poll, 3000).unref();
    };
    setTimeout(poll, 3000).unref();
  };

  await server.connect(new StdioServerTransport());
  log(findAppUrl() ? `NyaL2D 앱: ${findAppUrl()}` : "NyaL2D 앱을 기다립니다 (npm run dev)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBridge().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
