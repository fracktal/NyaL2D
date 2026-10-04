import type { LlmClient } from "../agent/llm";
import type { AgentEvent, AgentPhase, AgentSession } from "../agent/loop";
import type { ProxyHealth } from "../agent/protocol";
import { el } from "./dom";
import { icon, iconEl } from "./icons";

const TOOL_LABELS: Record<string, string> = {
  list_capabilities: "기능 확인",
  inspect_model: "모델 구조 살펴보기",
  get_parameters: "파라미터 읽기",
  capture_frame: "화면 캡처",
  simulate_physics: "물리 시뮬레이션",
  list_changes: "변경 기록 확인",
  set_parameter: "파라미터 설정",
  set_motion_mode: "모션 모드 변경",
  edit_physics_rig: "물리 리그 수정",
  edit_binding: "바인딩 수정",
  undo: "되돌리기",
  revert_all: "원본으로 되돌리기",
};

const PHASE_LABELS: Record<AgentPhase, string> = { analyze: "분석", plan: "계획", change: "변경", evaluate: "평가" };

const SUGGESTIONS = ["이 모델을 설명해 줘", "숨 쉬는 동작을 더 은은하게 해 줘", "머리카락이 고개를 더 자연스럽게 따라오게 해 줘"];

export interface AgentPanel {
  /** Refresh the connection status (call when the panel becomes visible). */
  refreshHealth(): Promise<void>;
  /** Clear the transcript after the conversation was reset. */
  clear(note?: string): void;
  focus(): void;
}

/**
 * Chat panel for the agent. It renders {@link AgentSession} events and never
 * calls tools itself; the transcript shows each tool step with the phase it
 * belongs to (analyze, plan, change, evaluate).
 */
export function mountAgentPanel(root: HTMLElement, agent: AgentSession, client: LlmClient): AgentPanel {
  const status = el("span", { class: "agent-status", role: "status" });
  const reset = el("button", { class: "btn ghost sm", type: "button", title: "대화를 지우고 새로 시작" });
  reset.innerHTML = `${icon("plus")}<span>새 대화</span>`;
  const log = el("div", { class: "agent-log", "aria-live": "polite" });
  const input = el("textarea", { class: "agent-input", rows: "1", placeholder: "무엇을 바꿔 볼까요?", "aria-label": "에이전트에게 요청" });
  const send = el("button", { class: "btn primary icon agent-send", type: "button", "aria-label": "보내기", title: "보내기 (Enter)" });
  send.innerHTML = icon("send");
  const hint = el("div", { class: "agent-hint" }, "Enter 보내기 · Shift+Enter 줄바꿈 · Undo로 되돌리기");

  root.replaceChildren(
    el("div", { class: "agent-head" }, status, el("span", { class: "spacer" }), reset),
    log,
    el("div", { class: "agent-composer" }, el("div", { class: "agent-box" }, input, send), hint),
  );

  let health: ProxyHealth | undefined;
  let run: HTMLElement | undefined;
  const steps = new Map<string, HTMLElement>();

  const setStatus = (kind: "ok" | "mock" | "warn" | "busy", text: string, title = "") => {
    status.className = `agent-status ${kind}`;
    status.title = title;
    status.innerHTML = `<span class="dot"></span><span></span>`;
    status.lastElementChild!.textContent = text;
  };

  const renderEmpty = () => {
    const chips = SUGGESTIONS.map((s) => {
      const b = el("button", { class: "chip", type: "button" }, s);
      b.addEventListener("click", () => void submit(s));
      return b;
    });
    log.replaceChildren(
      el(
        "div",
        { class: "agent-empty" },
        iconEl("sparkle", "big-icon"),
        el("h3", {}, "모델을 말로 다듬어 보세요"),
        el("p", {}, "에이전트는 모델을 살펴보고, 바꾸고, 시뮬레이션으로 확인합니다. 바뀐 내용은 아래 변경 기록에 AI로 표시됩니다."),
        el("div", { class: "chips" }, ...chips),
      ),
    );
  };

  const scroll = () => {
    log.scrollTop = log.scrollHeight;
  };

  const ensureRun = () => {
    if (!run) {
      log.querySelector(".agent-empty")?.remove();
      run = el("div", { class: "agent-run" });
      log.append(run);
    }
    return run;
  };

  const syncComposer = () => {
    const busy = agent.busy;
    send.innerHTML = icon(busy ? "stop" : "send");
    send.setAttribute("aria-label", busy ? "중단" : "보내기");
    send.title = busy ? "중단" : "보내기 (Enter)";
    send.classList.toggle("primary", !busy);
    send.disabled = !busy && !input.value.trim();
    reset.disabled = busy;
  };

  async function submit(text: string) {
    text = text.trim();
    if (!text || agent.busy) return;
    input.value = "";
    autosize();
    run = undefined;
    ensureRun().append(el("div", { class: "msg user" }, text));
    scroll();
    await agent.send(text);
  }

  agent.on((e: AgentEvent) => {
    switch (e.type) {
      case "busy": {
        if (e.busy) {
          ensureRun().append(el("div", { class: "thinking" }, el("span", { class: "spinner sm" }), "생각하는 중"));
          setStatus("busy", "작업 중");
        } else {
          log.querySelectorAll(".thinking").forEach((n) => n.remove());
          void refreshHealth();
        }
        syncComposer();
        break;
      }
      case "text": {
        const r = ensureRun();
        r.querySelector(".thinking")?.remove();
        r.append(el("div", { class: "msg assistant" }, formatText(e.text)));
        r.append(el("div", { class: "thinking" }, el("span", { class: "spinner sm" }), "생각하는 중"));
        break;
      }
      case "tool_call": {
        const r = ensureRun();
        r.querySelector(".thinking")?.remove();
        const label = TOOL_LABELS[e.name] ?? e.name;
        const row = el(
          "div",
          { class: "step running", "data-phase": e.phase },
          el("span", { class: "step-icon" }, el("span", { class: "spinner sm" })),
          el(
            "div",
            { class: "step-body" },
            el("div", { class: "step-title" }, el("span", { class: `phase ${e.phase}` }, PHASE_LABELS[e.phase]), label),
            el("div", { class: "step-detail mono" }, argsLine(e.input)),
          ),
        );
        row.title = `${e.name} ${JSON.stringify(e.input)}`;
        steps.set(e.id, row);
        r.append(row);
        break;
      }
      case "tool_result": {
        const row = steps.get(e.id);
        if (!row) break;
        row.classList.remove("running");
        row.classList.add(e.ok ? "ok" : "failed");
        row.querySelector(".step-icon")!.replaceChildren(iconEl(e.ok ? "check" : "alert"));
        const detail = row.querySelector(".step-detail")!;
        detail.textContent = e.summary;
        if (e.image) {
          const img = el("img", { class: "step-shot", alt: "에이전트가 찍은 화면" });
          img.src = URL.createObjectURL(e.image);
          row.querySelector(".step-body")!.append(img);
        }
        ensureRun().append(el("div", { class: "thinking" }, el("span", { class: "spinner sm" }), "생각하는 중"));
        break;
      }
      case "done":
        if (e.note) ensureRun().append(el("div", { class: "msg note" }, e.note));
        break;
      case "error": {
        const box = el("div", { class: "msg error" }, iconEl("alert"), el("span", {}, e.message));
        ensureRun().append(box);
        break;
      }
    }
    scroll();
  });

  const autosize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    syncComposer();
  };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit(input.value);
    }
  });
  send.addEventListener("click", () => (agent.busy ? agent.stop() : void submit(input.value)));
  reset.addEventListener("click", () => {
    agent.reset();
    clear();
  });

  async function refreshHealth() {
    if (agent.busy) return;
    try {
      health = await client.health();
      if (!health.ready) setStatus("warn", `${health.provider} 준비 안 됨`, health.detail ?? "");
      else if (health.provider === "mock") setStatus("mock", "모의 응답 모드", "프록시가 NYAL2D_LLM_PROVIDER=mock으로 실행 중입니다");
      else setStatus("ok", modelLabel(health.model), `${health.provider} · 로컬 프록시 경유`);
    } catch (err) {
      setStatus("warn", "프록시 연결 안 됨", (err as Error).message);
    }
  }

  function clear(note?: string) {
    run = undefined;
    steps.clear();
    renderEmpty();
    if (note) log.prepend(el("div", { class: "msg note" }, note));
    syncComposer();
  }

  renderEmpty();
  syncComposer();
  setStatus("busy", "연결 확인 중");
  return { refreshHealth, clear, focus: () => input.focus() };
}

function modelLabel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (!m) return id;
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

function argsLine(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const parts = Object.entries(input as Record<string, unknown>).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return parts.join("  ");
}

/** Plain text with **bold**, `code` and line breaks; everything else is escaped. */
function formatText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  text.split("\n").forEach((line, i) => {
    if (i) frag.append(document.createElement("br"));
    for (const part of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (!part) continue;
      if (part.startsWith("**") && part.endsWith("**")) frag.append(el("strong", {}, part.slice(2, -2)));
      else if (part.startsWith("`") && part.endsWith("`")) frag.append(el("code", {}, part.slice(1, -1)));
      else frag.append(part);
    }
  });
  return frag;
}
