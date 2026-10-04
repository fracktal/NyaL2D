import { readFileSync } from "node:fs";
import { loadIkiModel, type IkiMatrixDeformer } from "@ikijs/format";
import { describe, expect, it } from "vitest";
import { fromAnthropic, toAnthropicMessages, toAnthropicTools } from "../server/providers/anthropic";
import { mockTurn } from "../server/providers/mock";
import { isLocalOrigin } from "../server/llm-proxy";
import { AgentSession, type AgentEvent } from "../src/agent/loop";
import type { LlmClient } from "../src/agent/llm";
import { LlmError } from "../src/agent/llm";
import type { TurnResponse } from "../src/agent/protocol";
import { listTools, type ToolContext } from "../src/agent/tools";
import { ModelSession } from "../src/model/model-session";
import type { PuppetRuntime } from "../src/runtime/types";

const hero = loadIkiModel(readFileSync(new URL("../public/models/hero.iki", import.meta.url), "utf8"));

function context(): () => ToolContext {
  const session = new ModelSession(hero);
  const values = new Map(hero.parameters.map((p) => [p.id, p.default]));
  const runtime = {
    kind: "fake",
    label: "Fake",
    accept: "",
    capabilities: { editing: true, physicsSimulation: true, inspection: "full", motionModes: ["idle", "physics", "off"] },
    getParameters: () => hero.parameters,
    getParameter: (id: string) => values.get(id) ?? 0,
    setParameter: (id: string, v: number) => void values.set(id, v),
    resetPose: () => {},
    drivenParameterIds: [],
    setMotionMode: () => {},
    motionMode: "off",
    onParameter: () => () => {},
    captureFrame: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    destroy: () => {},
  } as unknown as PuppetRuntime;
  return () => ({ runtime, session, modelOpen: true });
}

const mockClient: LlmClient = {
  health: async () => ({ provider: "mock", model: "scripted", ready: true }),
  turn: async (req) => structuredClone(mockTurn(req)),
};

function record(agent: AgentSession): AgentEvent[] {
  const events: AgentEvent[] = [];
  agent.on((e) => events.push(e));
  return events;
}

describe("AgentSession", () => {
  it("runs a full request → change → report cycle through the tool layer", async () => {
    const ctx = context();
    const agent = new AgentSession(mockClient, ctx);
    const events = record(agent);
    await agent.send("숨 쉬는 걸 은은하게 해줘");

    const calls = events.filter((e) => e.type === "tool_call").map((e) => [e.name, e.phase]);
    expect(calls).toEqual([
      ["list_capabilities", "analyze"],
      ["inspect_model", "analyze"],
      ["edit_binding", "change"],
      ["edit_binding", "change"],
      ["list_changes", "evaluate"],
    ]);
    expect(events.filter((e) => e.type === "tool_result").every((e) => e.ok)).toBe(true);
    expect(events.at(-2)).toEqual({ type: "done" });
    expect(events.at(-1)).toEqual({ type: "busy", busy: false });

    const s = ctx().session!;
    expect(s.changes.map((c) => c.source)).toEqual(["agent", "agent"]);
    const body = s.current.deformers!.find((d) => d.id === "bodyDeformer") as IkiMatrixDeformer;
    expect(body.bindings![0].to).toBe(2.3);
    expect(s.original.deformers!.find((d) => d.id === "bodyDeformer")).toMatchObject({ bindings: [{ to: 4.6 }] });

    // Every tool call in the history has exactly one result, in the next user turn.
    const msgs = agent.messages;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role !== "assistant") continue;
      const ids = m.content.flatMap((b) => (b.type === "tool_call" ? [b.id] : []));
      if (!ids.length) continue;
      const next = msgs[i + 1];
      expect(next.role).toBe("user");
      expect(next.content.flatMap((b) => (b.type === "tool_result" ? [b.callId] : []))).toEqual(ids);
    }
  });

  it("feeds tool errors back to the model instead of failing", async () => {
    let turn = 0;
    const client: LlmClient = {
      health: mockClient.health,
      turn: async (): Promise<TurnResponse> =>
        turn++ === 0
          ? { content: [{ type: "tool_call", id: "a", name: "edit_physics_rig", input: { rig: "nope", damping: 2 } }], stop: "tool_calls" }
          : { content: [{ type: "text", text: "그 리그는 없습니다." }], stop: "end" },
    };
    const agent = new AgentSession(client, context());
    const events = record(agent);
    await agent.send("x");
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: false, summary: "없는 물리 리그: nope" });
    expect(events.find((e) => e.type === "text")).toMatchObject({ text: "그 리그는 없습니다." });
  });

  it("sends captured frames to the model as images", async () => {
    let seen: unknown;
    let turn = 0;
    const client: LlmClient = {
      health: mockClient.health,
      turn: async (req): Promise<TurnResponse> => {
        if (turn++ === 0) return { content: [{ type: "tool_call", id: "c", name: "capture_frame", input: {} }], stop: "tool_calls" };
        seen = req.messages.at(-1);
        return { content: [{ type: "text", text: "ok" }], stop: "end" };
      },
    };
    await new AgentSession(client, context()).send("look");
    expect(seen).toMatchObject({ role: "user", content: [{ type: "tool_result", ok: true, image: { mediaType: "image/png", base64: "iVBORw==" } }] });
  });

  it("reports proxy errors, refusals and the step limit", async () => {
    const failing: LlmClient = { health: mockClient.health, turn: async () => Promise.reject(new LlmError("프록시 꺼짐", true)) };
    const a = new AgentSession(failing, context());
    const ea = record(a);
    await a.send("x");
    expect(ea).toContainEqual({ type: "error", message: "프록시 꺼짐", retryable: true });
    // The unanswered user turn is extended, not duplicated.
    await a.send("y");
    expect(a.messages).toHaveLength(1);
    expect(a.messages[0].content).toHaveLength(2);

    const refusing: LlmClient = { health: mockClient.health, turn: async () => ({ content: [], stop: "refusal" }) };
    const b = new AgentSession(refusing, context());
    const eb = record(b);
    await b.send("x");
    expect(eb.find((e) => e.type === "error")).toMatchObject({ retryable: false });

    const looping: LlmClient = {
      health: mockClient.health,
      turn: async () => ({ content: [{ type: "tool_call", id: String(Math.random()), name: "list_changes", input: {} }], stop: "tool_calls" }),
    };
    const c = new AgentSession(looping, context(), { maxSteps: 3 });
    const ec = record(c);
    await c.send("x");
    expect(ec.filter((e) => e.type === "tool_call")).toHaveLength(3);
    expect(ec.find((e) => e.type === "error")).toMatchObject({ retryable: true });
  });
});

describe("Anthropic provider mapping", () => {
  it("maps tools, history and tool results onto the Messages API shape", () => {
    const ctx = context()();
    const tools = toAnthropicTools(listTools(ctx));
    expect(tools[0]).toEqual({ name: "list_capabilities", description: expect.any(String), input_schema: { type: "object", properties: {} } });

    const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "t1", name: "capture_frame", input: {} }];
    const msgs = toAnthropicMessages([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "tool_call", id: "t1", name: "capture_frame", input: {} }], raw },
      { role: "user", content: [{ type: "tool_result", callId: "t1", ok: true, content: "{}", image: { mediaType: "image/png", base64: "AA==" } }] },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ]);
    // Provider blocks (thinking included) are echoed unchanged.
    expect(msgs[1]).toEqual({ role: "assistant", content: raw });
    expect(msgs[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          is_error: false,
          content: [{ type: "text", text: "{}" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } }],
        },
      ],
    });
    expect(msgs[3]).toEqual({ role: "assistant", content: [{ type: "text", text: "done" }] });
  });

  it("maps a response back, keeping the raw blocks", () => {
    const res = fromAnthropic({
      id: "m",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "s" },
        { type: "text", text: "보겠습니다", citations: null },
        { type: "tool_use", id: "t", name: "inspect_model", input: {} },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    } as never);
    expect(res.stop).toBe("tool_calls");
    expect(res.content).toEqual([
      { type: "text", text: "보겠습니다" },
      { type: "tool_call", id: "t", name: "inspect_model", input: {} },
    ]);
    expect((res.raw as unknown[]).length).toBe(3);
  });
});

describe("proxy origin check", () => {
  it("accepts only pages served from this machine", () => {
    expect(isLocalOrigin(undefined)).toBe(true);
    expect(isLocalOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:4173")).toBe(true);
    expect(isLocalOrigin("https://example.com")).toBe(false);
    expect(isLocalOrigin("http://localhost.evil.com")).toBe(false);
    expect(isLocalOrigin("garbage")).toBe(false);
  });
});
