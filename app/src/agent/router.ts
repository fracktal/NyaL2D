import type { BridgeActivity, BridgeClient } from "./bridge";
import type { LlmClient } from "./llm";
import { LlmError } from "./llm";
import { ACTION_TOOLS, summarize, type AgentEvent, type AgentPhase, type AgentSession } from "./loop";
import type { RunEvent } from "./protocol";

/** What the Agent panel drives. */
export interface AgentDriver {
  readonly busy: boolean;
  readonly hasHistory: boolean;
  on(listener: (e: AgentEvent) => void): () => void;
  send(text: string): Promise<void>;
  stop(): void;
  reset(): void;
}

/**
 * One agent for the panel, whichever way the proxy runs it:
 *
 * - "turn" mode: {@link AgentSession} runs the loop in the page and asks the
 *   proxy for one model turn at a time (API-key providers, mock).
 * - "run" mode: the proxy hands the whole request to Claude Code, which calls
 *   the page's tools over the {@link BridgeClient}; this class streams Claude
 *   Code's text and turns the bridge's tool calls into transcript steps.
 *
 * Tool calls from an MCP client the person runs themselves (Claude Desktop,
 * Claude Code in a terminal) also arrive over the bridge and are shown the
 * same way.
 */
export class AgentRouter implements AgentDriver {
  private mode: "turn" | "run" = "turn";
  private listeners = new Set<(e: AgentEvent) => void>();
  private runAbort?: AbortController;
  private sessionId?: string;
  private changed = false;
  private lastActivity = 0;
  private readonly turn: AgentSession;
  private readonly client: LlmClient & { baseUrl?: string };

  constructor(turn: AgentSession, client: LlmClient & { baseUrl?: string }, bridge: BridgeClient) {
    this.turn = turn;
    this.client = client;
    turn.on((e) => this.emit(e));
    bridge.onActivity((a) => this.onBridge(a));
  }

  setMode(mode: "turn" | "run"): void {
    if (mode === this.mode) return;
    this.reset();
    this.mode = mode;
  }

  get busy(): boolean {
    return this.mode === "turn" ? this.turn.busy : !!this.runAbort;
  }

  get hasHistory(): boolean {
    return this.turn.messages.length > 0 || !!this.sessionId;
  }

  on(listener: (e: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    this.turn.stop();
    this.runAbort?.abort();
  }

  reset(): void {
    this.stop();
    this.turn.reset();
    this.sessionId = undefined;
  }

  async send(text: string): Promise<void> {
    this.changed = false;
    if (this.mode === "turn") return this.turn.send(text);
    if (this.runAbort) throw new Error("에이전트가 이미 작업 중입니다");
    const abort = (this.runAbort = new AbortController());
    this.emit({ type: "busy", busy: true });
    let ended = false;
    const onEvent = (e: RunEvent) => {
      if (e.type === "text") this.emit({ type: "text", text: e.text, phase: this.changed ? "evaluate" : "analyze" });
      else if (e.type === "done") {
        ended = true;
        if (e.sessionId) this.sessionId = e.sessionId;
        this.emit({ type: "done", note: e.note });
      } else {
        ended = true;
        this.emit({ type: "error", message: e.error, retryable: !!e.retryable });
      }
    };
    try {
      const res = await fetch(`${this.client.baseUrl ?? "./llm"}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, sessionId: this.sessionId }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new LlmError(body.error ?? `프록시 오류 (HTTP ${res.status})`, res.status >= 500);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) onEvent(JSON.parse(line) as RunEvent);
        }
      }
      if (!ended) this.emit({ type: "error", message: "프록시 응답이 중간에 끊겼습니다", retryable: true });
    } catch (err) {
      if ((err as Error).name === "AbortError") this.emit({ type: "done", note: "중단했습니다." });
      else this.emit({ type: "error", message: err instanceof TypeError ? "로컬 프록시에 연결하지 못했습니다." : (err as Error).message, retryable: err instanceof LlmError ? err.retryable : true });
    } finally {
      this.runAbort = undefined;
      this.emit({ type: "busy", busy: false });
    }
  }

  private onBridge(a: BridgeActivity): void {
    // Outside a panel request (an external MCP client), a pause starts a new task.
    if (!this.busy && Date.now() - this.lastActivity > 120_000) this.changed = false;
    this.lastActivity = Date.now();
    const id = `bridge:${a.id}`;
    if (a.type === "tool_call") {
      const isAction = ACTION_TOOLS.has(a.name);
      const phase: AgentPhase = isAction ? "change" : this.changed ? "evaluate" : "analyze";
      this.emit({ type: "tool_call", id, name: a.name, input: a.input, phase, external: !this.busy });
    } else {
      if (a.ok && this.pendingAction.has(id)) this.changed = true;
      this.emit({ type: "tool_result", id, ok: a.ok, summary: a.ok ? summarize(this.names.get(id) ?? "", a.data) : (a.error ?? "실패"), image: a.image });
    }
    if (a.type === "tool_call") {
      this.names.set(id, a.name);
      if (ACTION_TOOLS.has(a.name)) this.pendingAction.add(id);
    }
  }

  private names = new Map<string, string>();
  private pendingAction = new Set<string>();

  private emit(e: AgentEvent): void {
    for (const l of this.listeners) l(e);
  }
}
