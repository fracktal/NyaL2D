import { BRIDGE_PATH, type BridgeMessage, type PageMessage, type WireToolResult } from "./bridge-protocol";
import type { ToolResult, ToolSpec } from "./tools";

export type BridgeState = "off" | "connecting" | "connected" | "unavailable";

export type BridgeActivity =
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; data?: unknown; error?: string; image?: Blob };

/**
 * The page's end of the tool hub (server/tool-hub.ts): it answers tool calls
 * from Claude Code or another MCP client by running them through the same
 * tool layer as the in-app agent, and keeps the hub's tool list current.
 */
export class BridgeClient {
  private ws?: WebSocket;
  private enabled = false;
  private retry?: ReturnType<typeof setTimeout>;
  private sentTools = "";
  private stateListeners = new Set<(s: BridgeState, client?: string) => void>();
  private activityListeners = new Set<(a: BridgeActivity) => void>();
  state: BridgeState = "off";
  clientName?: string;
  readonly url: string;
  private readonly tools: () => ToolSpec[];
  private readonly call: (name: string, args: unknown) => Promise<ToolResult>;

  constructor(handlers: { tools: () => ToolSpec[]; call: (name: string, args: unknown) => Promise<ToolResult> }, url = defaultBridgeUrl()) {
    this.tools = handlers.tools;
    this.call = handlers.call;
    this.url = url;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.connect();
  }

  disable(): void {
    this.enabled = false;
    clearTimeout(this.retry);
    this.ws?.close();
    this.ws = undefined;
    this.setState("off");
  }

  /** Send the tool list if it changed (call after the model or runtime changes). */
  syncTools(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const tools = this.tools();
    const json = JSON.stringify(tools);
    if (json === this.sentTools) return;
    this.sentTools = json;
    this.send({ type: "tools", tools });
  }

  onState(l: (s: BridgeState, client?: string) => void): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }

  onActivity(l: (a: BridgeActivity) => void): () => void {
    this.activityListeners.add(l);
    return () => this.activityListeners.delete(l);
  }

  private connect(): void {
    if (!this.enabled) return;
    this.setState(this.state === "unavailable" ? "unavailable" : "connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.sentTools = "";
      this.setState("connected");
      this.syncTools();
    };
    ws.onmessage = (ev) => void this.onMessage(ev.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.clientName = undefined;
      if (!this.enabled) return;
      this.setState("unavailable");
      this.retry = setTimeout(() => this.connect(), 2500);
    };
  }

  private async onMessage(raw: unknown): Promise<void> {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(String(raw)) as BridgeMessage;
    } catch {
      return;
    }
    if (msg.type === "client") {
      this.clientName = msg.name;
      this.setState(this.state);
      return;
    }
    if (msg.type !== "call") return;
    this.emit({ type: "tool_call", id: msg.id, name: msg.name, input: msg.args });
    const r = await this.call(msg.name, msg.args);
    let result: WireToolResult;
    if (r.ok) {
      result = { ok: true, data: r.data };
      if (r.image) result.image = { mediaType: r.image.type || "image/png", base64: await blobToBase64(r.image) };
      this.emit({ type: "tool_result", id: msg.id, ok: true, data: r.data, image: r.image });
    } else {
      result = r;
      this.emit({ type: "tool_result", id: msg.id, ok: false, error: r.error });
    }
    this.send({ type: "result", id: msg.id, result });
    // A call can change what is available (e.g. an edit enables undo).
    this.syncTools();
  }

  private send(msg: PageMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private setState(s: BridgeState): void {
    this.state = s;
    for (const l of this.stateListeners) l(s, this.clientName);
  }

  private emit(a: BridgeActivity): void {
    for (const l of this.activityListeners) l(a);
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The app server's bridge endpoint, next to the page (same host and port). */
function defaultBridgeUrl(): string {
  const u = new URL(BRIDGE_PATH, location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.href;
}
