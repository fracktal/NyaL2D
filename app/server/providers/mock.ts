import type { AssistantBlock, LlmMessage, TurnRequest, TurnResponse } from "../../src/agent/protocol.ts";
import type { Provider } from "./types.ts";

/**
 * A scripted stand-in for a real model, for trying the agent UI without an
 * API key and for the browser smoke test. It follows a fixed plan picked from
 * keywords in the request: look at the model, make at most one edit, check
 * it, and report. Every answer says it is a mock.
 */
export function createMockProvider(): Provider {
  return {
    async health() {
      return { provider: "mock", model: "scripted", ready: true };
    },
    async turn(req) {
      return mockTurn(req);
    },
  };
}

type Step = { name: string; input: Record<string, unknown> };

function planFor(request: string): Step[] {
  if (/숨|호흡|breath/i.test(request)) {
    return [
      { name: "inspect_model", input: {} },
      { name: "edit_binding", input: { target: "deformer", id: "bodyDeformer", parameter: "ParamBreath", channel: "translateY", to: 2.3 } },
      { name: "edit_binding", input: { target: "deformer", id: "headDeformer", parameter: "ParamBreath", channel: "translateY", to: 1.5 } },
      { name: "list_changes", input: {} },
    ];
  }
  if (/머리카락|헤어|hair|출렁|흔들/i.test(request)) {
    return [
      { name: "simulate_physics", input: { input: "ParamAngleX", to: 30, record: ["ParamHairSwayX"] } },
      { name: "edit_physics_rig", input: { rig: "hairSway", damping: 1.8 } },
      { name: "simulate_physics", input: { input: "ParamAngleX", to: 30, record: ["ParamHairSwayX"] } },
    ];
  }
  return [{ name: "inspect_model", input: {} }];
}

export function mockTurn(req: TurnRequest): TurnResponse {
  // The request is the latest user text; steps taken are the tool calls since then.
  let start = req.messages.length - 1;
  while (start >= 0 && !isUserText(req.messages[start])) start--;
  const request = start >= 0 ? textOf(req.messages[start]) : "";
  const done = req.messages.slice(start + 1).filter((m) => m.role === "assistant").length;
  const available = new Set(req.tools.map((t) => t.name));
  const steps = [{ name: "list_capabilities", input: {} }, ...planFor(request)].filter((s) => available.has(s.name));

  if (done < steps.length) {
    const step = steps[done];
    const content: AssistantBlock[] = [
      { type: "text", text: done === 0 ? "(모의 응답) 먼저 모델 상태를 확인합니다." : `(모의 응답) ${step.name}을(를) 실행합니다.` },
      { type: "tool_call", id: `mock_${start}_${done}`, name: step.name, input: step.input },
    ];
    return { content, stop: "tool_calls", model: "mock" };
  }
  const failures = req.messages
    .slice(start + 1)
    .flatMap((m) => (m.role === "user" ? m.content : []))
    .filter((b) => b.type === "tool_result" && !b.ok).length;
  const text =
    `(모의 응답) 도구 ${steps.length}개를 실행했습니다${failures ? `, 그중 ${failures}개는 실패했습니다` : ""}. ` +
    "실제 모델을 쓰려면 프록시를 NYAL2D_LLM_PROVIDER=anthropic으로 실행하세요.";
  return { content: [{ type: "text", text }], stop: "end", model: "mock" };
}

function isUserText(m: LlmMessage): boolean {
  return m.role === "user" && m.content.some((b) => b.type === "text");
}

function textOf(m: LlmMessage): string {
  return m.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
}
