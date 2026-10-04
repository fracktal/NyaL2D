import type { LlmClient } from "./llm";
import { LlmError } from "./llm";
import type { AssistantBlock, LlmMessage, UserBlock } from "./protocol";
import { callTool, listTools, type ToolContext } from "./tools";

/**
 * The agent loop: request → analyze → plan → change → evaluate.
 *
 * It runs in the browser, next to the tools, and asks the model for one turn
 * at a time through an {@link LlmClient}. It never touches the model file
 * directly: every effect goes through the tool layer, so edits land in the
 * change list as source "agent" and can be undone like any other edit.
 */

/** Where in request → analyze → plan → change → evaluate a step belongs. */
export type AgentPhase = "analyze" | "plan" | "change" | "evaluate";

export type AgentEvent =
  | { type: "busy"; busy: boolean }
  | { type: "text"; text: string; phase: AgentPhase }
  | { type: "tool_call"; id: string; name: string; input: unknown; phase: AgentPhase }
  | { type: "tool_result"; id: string; ok: boolean; summary: string; image?: Blob }
  | { type: "done"; note?: string }
  | { type: "error"; message: string; retryable: boolean };

const ACTION_TOOLS = new Set(["set_parameter", "set_motion_mode", "edit_physics_rig", "edit_binding", "undo", "revert_all"]);
const MAX_RESULT_CHARS = 12_000;

export const SYSTEM_PROMPT = `You are the assistant inside NyaL2D, an authoring tool for 2D puppet models (Iki runtime). The person sees the model on a canvas next to this chat and can undo anything you change.

Work through the tools: they are the only way to see or change the model. Start a task by calling list_capabilities, because what is possible depends on the runtime and the open model. Observe before you change (inspect_model, get_parameters, simulate_physics), make the smallest change that does the job, then check the effect (simulate_physics for physics, capture_frame to look) before you report. Model edits are recorded as changes and can be undone; never claim a change you did not make through a tool.

If something the person asks for is not possible with the tools (for example, the format has no motion or expression clips), say so plainly instead of approximating it silently.

Reply in the person's language, briefly: what you changed, what you measured, and what they might try next.`;

export class AgentSession {
  private readonly history: LlmMessage[] = [];
  private abort?: AbortController;
  private readonly listeners = new Set<(e: AgentEvent) => void>();
  readonly maxSteps: number;

  constructor(
    private readonly client: LlmClient,
    private readonly context: () => ToolContext,
    opts: { maxSteps?: number } = {},
  ) {
    this.maxSteps = opts.maxSteps ?? 16;
  }

  get busy(): boolean {
    return !!this.abort;
  }

  /** The conversation so far, in the neutral wire format. */
  get messages(): readonly LlmMessage[] {
    return this.history;
  }

  on(listener: (e: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    this.abort?.abort();
  }

  reset(): void {
    this.stop();
    this.history.length = 0;
  }

  async send(text: string): Promise<void> {
    if (this.busy) throw new Error("에이전트가 이미 작업 중입니다");
    const last = this.history.at(-1);
    // A stopped request can leave a user turn without a reply; extend it
    // rather than sending two user turns in a row.
    if (last?.role === "user") last.content.push({ type: "text", text });
    else this.history.push({ role: "user", content: [{ type: "text", text }] });

    const abort = (this.abort = new AbortController());
    this.emit({ type: "busy", busy: true });
    let changed = false;
    try {
      for (let step = 0; step < this.maxSteps; step++) {
        const ctx = { ...this.context(), source: "agent" };
        const res = await this.client.turn({ system: SYSTEM_PROMPT, messages: this.history, tools: listTools(ctx) }, abort.signal);
        this.history.push({ role: "assistant", content: res.content, raw: res.raw });

        const calls = res.content.filter((b): b is Extract<AssistantBlock, { type: "tool_call" }> => b.type === "tool_call");
        const textPhase: AgentPhase = changed ? "evaluate" : calls.some((c) => ACTION_TOOLS.has(c.name)) ? "plan" : "analyze";
        for (const b of res.content) if (b.type === "text" && b.text.trim()) this.emit({ type: "text", text: b.text, phase: textPhase });

        if (res.stop === "pause") continue;
        if (res.stop === "refusal") return this.emit({ type: "error", message: "모델이 이 요청을 거절했습니다. 표현을 바꿔 다시 요청해 보세요.", retryable: false });
        if (res.stop === "max_tokens") return this.emit({ type: "done", note: "응답이 길이 한도에서 잘렸습니다." });
        if (res.stop !== "tool_calls" || !calls.length) return this.emit({ type: "done" });

        const results: UserBlock[] = [];
        for (const call of calls) {
          if (abort.signal.aborted) {
            results.push({ type: "tool_result", callId: call.id, ok: false, content: "사용자가 작업을 중단했습니다" });
            continue;
          }
          const isAction = ACTION_TOOLS.has(call.name);
          this.emit({ type: "tool_call", id: call.id, name: call.name, input: call.input, phase: isAction ? "change" : changed ? "evaluate" : "analyze" });
          const r = await callTool(call.name, call.input, { ...this.context(), source: "agent" });
          if (r.ok && isAction) changed = true;
          const content = r.ok ? truncate(JSON.stringify(r.data ?? null)) : r.error;
          const block: UserBlock = { type: "tool_result", callId: call.id, ok: r.ok, content };
          if (r.ok && r.image) block.image = { mediaType: r.image.type || "image/png", base64: await toBase64(r.image) };
          results.push(block);
          this.emit({ type: "tool_result", id: call.id, ok: r.ok, summary: r.ok ? summarize(call.name, r.data) : r.error, image: r.ok ? r.image : undefined });
        }
        this.history.push({ role: "user", content: results });
        if (abort.signal.aborted) return this.emit({ type: "done", note: "중단했습니다." });
      }
      this.emit({ type: "error", message: `한 번의 요청에 쓸 수 있는 단계(${this.maxSteps})를 모두 썼습니다. 이어서 하려면 다시 요청하세요.`, retryable: true });
    } catch (err) {
      if ((err as Error).name === "AbortError") this.emit({ type: "done", note: "중단했습니다." });
      else this.emit({ type: "error", message: (err as Error).message, retryable: err instanceof LlmError && err.retryable });
    } finally {
      this.abort = undefined;
      this.emit({ type: "busy", busy: false });
    }
  }

  private emit(e: AgentEvent): void {
    for (const l of this.listeners) l(e);
  }
}

function truncate(s: string): string {
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}… (잘림: ${s.length}자 중 ${MAX_RESULT_CHARS}자)` : s;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** One line for the chat transcript; the model gets the full JSON. */
export function summarize(name: string, data: unknown): string {
  const d = data as Record<string, any>;
  switch (name) {
    case "list_capabilities":
      return `${d.runtime?.label ?? "런타임 없음"} · 도구 ${d.tools?.length ?? 0}개`;
    case "inspect_model":
      return `파라미터 ${d.parameters?.length}, 파트 ${d.parts?.length}, 디포머 ${d.deformers?.length}, 물리 ${d.physics?.length}`;
    case "get_parameters":
      return `파라미터 ${d.parameters?.length}개 · 모션 ${d.motionMode}`;
    case "simulate_physics":
      return Object.entries(d.outputs ?? {})
        .map(([id, o]: [string, any]) => `${id} 최대 ${o.peak} (${o.peakMs}ms) · 오버슈트 ${Math.round(o.overshoot * 100)}% · 정착 ${o.settleMs ?? "—"}ms`)
        .join("\n");
    case "edit_physics_rig":
    case "edit_binding":
      return `변경 #${d.change?.seq} ${d.change?.label}`;
    case "set_parameter":
      return `${d.id} = ${d.value}${d.clamped ? " (범위로 조정)" : ""}`;
    case "set_motion_mode":
      return `모션: ${d.mode}`;
    case "capture_frame":
      return `캡처 ${Math.round((d.bytes ?? 0) / 1024)} KB`;
    case "list_changes":
      return `변경 ${d.applied?.length ?? 0}개`;
    case "undo":
      return `되돌림: ${d.undone?.label}`;
    case "revert_all":
      return `원본으로 (${d.dropped}개 버림)`;
    default:
      return "완료";
  }
}
