import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import { loadIkiModel, type IkiModel } from "@ikijs/format";
import { importLayeredArt, isLayeredArt } from "./import/layer-import";
import { inspectModel } from "./inspection/inspect";
import { ModelSession } from "./model/model-session";
import { ProxyLlmClient } from "./agent/llm";
import { BridgeClient } from "./agent/bridge";
import { AgentSession } from "./agent/loop";
import { AgentRouter } from "./agent/router";
import { callTool, listTools, type ToolContext, type ToolResult, type ToolSpec } from "./agent/tools";
import { ExternalRuntime, importAdapter } from "./runtime/external-runtime";
import { IkiRuntime } from "./runtime/iki-runtime";
import { adapterUrlFor, loadSettings, RUNTIMES, saveSettings, type AppSettings, type RuntimeId } from "./runtime/registry";
import type { MotionMode, PuppetRuntime } from "./runtime/types";
import { mountAgentPanel } from "./ui/agent-panel";
import { renderChanges } from "./ui/changes";
import { icon } from "./ui/icons";
import { renderInspector, renderRuntimeInspector } from "./ui/inspector";
import { renderParameters, type ParameterPanel } from "./ui/parameters";
import { openSettings } from "./ui/settings";
import { toast } from "./ui/toast";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Hydrate data-icon attributes into inline SVGs.
for (const node of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon!));
}
$("param-search-wrap").insertAdjacentHTML("afterbegin", icon("search"));

const stage = $("stage");
let settings: AppSettings = loadSettings();

/**
 * Exactly one runtime is active. Iki gets the full editing stack
 * (ModelSession, inspector, timeline); an external adapter runtime is a black
 * box that only exposes parameters, rendering and capture.
 */
let runtime: PuppetRuntime | undefined;
let iki: IkiRuntime | undefined;
let external: ExternalRuntime | undefined;
let canvas: HTMLCanvasElement;
let session: ModelSession | undefined;
let unsubscribeSession: (() => void) | undefined;
let unsubscribeParams: (() => void) | undefined;
let panel: ParameterPanel = { update() {} };
let paramFilter = "";
let externalModelOpen = false;

// --- Stage overlay & HUD -------------------------------------------------------

type OverlayState =
  | { kind: "loading"; label: string }
  | { kind: "empty"; hint: string }
  | { kind: "drop" }
  | { kind: "error"; title: string; detail: string }
  | { kind: "unconnected"; name: string }
  | { kind: "none" };
let overlayBeforeDrop: OverlayState = { kind: "none" };
let overlayState: OverlayState = { kind: "none" };

function hasModel(): boolean {
  return iki ? !!session : externalModelOpen;
}

function setOverlay(state: OverlayState): void {
  overlayState = state;
  const overlay = $("overlay");
  const card = $("overlay-card");
  overlay.className = `stage-overlay ${state.kind === "none" ? "" : "visible"} ${state.kind}`;
  switch (state.kind) {
    case "loading":
      card.innerHTML = `<div class="spinner" aria-hidden="true"></div><p></p>`;
      card.querySelector("p")!.textContent = state.label;
      break;
    case "empty":
      card.innerHTML = `${icon("upload", "big-icon")}<h3>모델을 열어 시작하세요</h3><p></p>`;
      card.querySelector("p")!.textContent = state.hint;
      break;
    case "drop":
      card.innerHTML = `${icon("upload", "big-icon")}<h3>놓아서 열기</h3><p></p>`;
      card.querySelector("p")!.textContent = runtime?.accept || "모델 파일";
      break;
    case "error": {
      card.innerHTML = `${icon("alert", "big-icon")}<h3></h3><div class="error-detail"></div><p>다른 파일을 열거나 설정에서 런타임을 바꿀 수 있습니다.</p>`;
      card.querySelector("h3")!.textContent = state.title;
      card.querySelector(".error-detail")!.textContent = state.detail;
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:8px";
      if (hasModel()) actions.append(button("btn", "이전 모델로 돌아가기", () => setOverlay({ kind: "none" })));
      actions.append(button("btn ghost", "설정 열기", () => void showSettings()));
      card.append(actions);
      (actions.firstElementChild as HTMLElement).focus();
      break;
    }
    case "unconnected": {
      card.innerHTML = `${icon("plug", "big-icon")}<h3></h3><p></p><div class="error-detail mono">app/public/adapters/ayagami-adapter.js</div>`;
      card.querySelector("h3")!.textContent = `${state.name} 런타임이 아직 연결되지 않았습니다`;
      card.querySelector("p")!.textContent = `지금 슬롯에는 빈 래퍼가 들어 있습니다. 래퍼를 채우거나 설정에서 다른 어댑터 URL을 지정하면 여기서 모델을 열 수 있습니다.`;
      card.querySelector(".error-detail")!.textContent = adapterUrlFor(settings, settings.runtime) ?? "";
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:8px";
      actions.append(button("btn", "설정 열기", () => void showSettings()), button("btn ghost", "Iki로 돌아가기", () => void switchRuntime("iki")));
      card.append(actions);
      break;
    }
    default:
      card.replaceChildren();
  }
}

function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function setStatus(text: string): void {
  $("hud-status").lastElementChild!.textContent = text;
}

const sizeObserver = new ResizeObserver(() => {
  const dpr = window.devicePixelRatio || 1;
  $("hud-size").textContent = `${Math.round(canvas.clientWidth * dpr)} × ${Math.round(canvas.clientHeight * dpr)} px`;
});

/** A canvas keeps the first context type it was given, so each runtime gets a fresh one. */
function mountCanvas(): HTMLCanvasElement {
  canvas?.remove();
  const c = document.createElement("canvas");
  c.id = "canvas";
  c.setAttribute("aria-label", "모델 미리보기");
  stage.prepend(c);
  sizeObserver.disconnect();
  sizeObserver.observe(c);
  return c;
}

// --- Runtime lifecycle ---------------------------------------------------------

async function activateRuntime(next: AppSettings): Promise<void> {
  resetAgent();
  unsubscribeSession?.();
  unsubscribeParams?.();
  runtime?.destroy();
  runtime = iki = external = session = undefined;
  externalModelOpen = false;
  canvas = mountCanvas();

  const desc = RUNTIMES.find((r) => r.id === next.runtime)!;
  $("runtime-badge").textContent = desc.name;
  try {
    if (desc.kind === "builtin") {
      iki = new IkiRuntime(canvas);
      runtime = iki;
    } else {
      const url = adapterUrlFor(next, desc.id);
      if (!url) throw new Error(`${desc.name} 어댑터 URL이 설정되지 않았습니다`);
      setOverlay({ kind: "loading", label: `${desc.name} 어댑터 연결 중` });
      external = await ExternalRuntime.create(desc.id, await importAdapter(url), canvas);
      runtime = external;
      $("runtime-badge").textContent = external.connected ? `${desc.name} · ${external.label}` : `${desc.name} · 미연결`;
    }
  } catch (err) {
    syncChrome(true);
    setOverlay({ kind: "error", title: `${desc.name} 런타임을 시작하지 못했습니다`, detail: (err as Error).message });
    setStatus("런타임 오류");
    return;
  }
  unsubscribeParams = runtime.onParameter((id, v) => panel.update(id, v));
  $<HTMLInputElement>("file-input").accept = runtime.accept;
  syncChrome(true);
  if (external && !external.connected) {
    setOverlay({ kind: "unconnected", name: desc.name });
    setStatus(`${desc.name} 미연결`);
    return;
  }
  setOverlay({ kind: "empty", hint: `${runtime.accept || "모델 파일"}을(를) 끌어다 놓거나 상단의 열기 또는 샘플을 누르세요.` });
  setStatus(`${desc.name} 준비됨`);
}

async function showSettings(): Promise<void> {
  const next = await openSettings(settings);
  if (next) await applySettings(next);
}

async function switchRuntime(id: RuntimeId): Promise<void> {
  await applySettings({ ...settings, runtime: id });
}

async function applySettings(next: AppSettings): Promise<void> {
  const changed = JSON.stringify(next) !== JSON.stringify(settings);
  settings = next;
  saveSettings(settings);
  if (!changed) return;
  await activateRuntime(settings);
  if (runtime) {
    toast(`런타임: ${runtime.label}`);
    await loadSample();
  }
}

// --- Model lifecycle -----------------------------------------------------------

async function openIkiText(text: string, label: string): Promise<void> {
  if (!iki) return;
  let model: IkiModel;
  try {
    model = loadIkiModel(text);
  } catch (err) {
    // IkiFormatError carries a path-qualified message, e.g. "parts[3].mesh…".
    setOverlay({ kind: "error", title: `${label}을(를) 열 수 없습니다`, detail: (err as Error).message });
    setStatus("열기 실패");
    return;
  }
  unsubscribeSession?.();
  resetAgent();
  session = new ModelSession(model);
  unsubscribeSession = session.onChange(() => void refresh());
  setOverlay({ kind: "loading", label: `${label} 불러오는 중` });
  await refresh(true);
  setOverlay({ kind: "none" });
  setStatus(label);
}

async function openExternal(files: File[], label: string): Promise<void> {
  if (!external) return;
  resetAgent();
  setOverlay({ kind: "loading", label: `${label} 불러오는 중` });
  try {
    await external.load(files);
  } catch (err) {
    setOverlay({ kind: "error", title: `${label}을(를) 열 수 없습니다`, detail: (err as Error).message });
    setStatus("열기 실패");
    return;
  }
  externalModelOpen = true;
  syncChrome(true);
  setOverlay({ kind: "none" });
  setStatus(external.modelName ?? label);
}

/** PSD or layer PNGs → auto-rigged `.iki`, opened like any other model. */
async function importArt(files: File[]): Promise<void> {
  const label = files.length === 1 ? files[0].name : `레이어 ${files.length}장`;
  setOverlay({ kind: "loading", label: `${label} 자동 리깅 중` });
  let result: Awaited<ReturnType<typeof importLayeredArt>>;
  try {
    result = await importLayeredArt(files);
  } catch (err) {
    setOverlay({ kind: "error", title: `${label}을(를) 모델로 만들 수 없습니다`, detail: (err as Error).message });
    setStatus("가져오기 실패");
    return;
  }
  await openIkiText(result.text, `${result.name}.iki`);
  const { report } = result;
  console.info("[nyal2d] layer import", report);
  toast(`${result.name}: 부위 ${report.roles.length}개로 리깅 (${report.roles.map((r) => r.role).join(", ")})${report.dropped.length ? ` · 제외 ${report.dropped.length}개` : ""}`);
}

async function openFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  if (iki && isLayeredArt(files)) await importArt(files);
  else if (iki) await openIkiText(await files[0].text(), files[0].name);
  else if (external?.connected) await openExternal(files, files[0].name);
  else if (external) setOverlay({ kind: "unconnected", name: external.label });
}

/** Push the session's current model into Iki and redraw the panels. */
async function refresh(rebuildParams = false): Promise<void> {
  if (!iki || !session) return;
  const result = await iki.load(session.current);
  if (result.superseded) return;
  if (result.failedTextures.length) toast(`텍스처 ${result.failedTextures.join(", ")}번을 불러오지 못했습니다`, "error");
  syncChrome(rebuildParams);
}

/** Reflect the active runtime and model in every panel and control. */
function syncChrome(rebuildParams = false): void {
  const caps = runtime?.capabilities;
  const name = $("model-name");
  const badge = $("model-badge");
  const modelName = session?.current.name ?? (externalModelOpen ? (external?.modelName ?? "모델") : undefined);
  name.textContent = modelName ?? "모델 없음";
  name.classList.toggle("muted", !modelName);
  badge.hidden = !session;
  if (session) {
    badge.textContent = session.changes.length ? `${session.changes.length}개 변경` : "원본";
    badge.className = `badge hide-md ${session.changes.length ? "accent" : ""}`;
  }

  // Motion modes this runtime supports.
  for (const b of $("motion-mode").querySelectorAll<HTMLButtonElement>("button")) {
    const mode = b.dataset.mode as MotionMode;
    b.disabled = !caps?.motionModes.includes(mode);
    b.setAttribute("aria-pressed", String(runtime?.motionMode === mode));
  }

  $("param-count").textContent = hasModel() ? String(runtime?.getParameters().length ?? 0) : "";
  if (rebuildParams || !$("params").childElementCount) rebuildParameters();

  if (iki && session) {
    renderInspector($("inspector-tabs"), $("inspector"), inspectModel(session.current), session);
  } else if (runtime) {
    renderRuntimeInspector($("inspector-tabs"), $("inspector"), {
      runtime: RUNTIMES.find((r) => r.id === settings.runtime)!.name,
      adapter: external ? `${external.label}${external.adapterVersion ? ` v${external.adapterVersion}` : ""}` : "내장",
      connected: external?.connected,
      model: modelName,
      parameters: hasModel() ? runtime.getParameters().length : 0,
      capabilities: runtime.capabilities,
    });
  } else {
    $("inspector-tabs").replaceChildren();
    $("inspector").replaceChildren();
  }

  if (session) renderChanges($("changes"), session);
  else {
    const note = document.createElement("span");
    note.className = "muted";
    note.style.fontSize = "12px";
    note.textContent = caps && !caps.editing ? "이 런타임은 모델 편집을 지원하지 않습니다" : "모델을 열면 변경 기록이 여기에 쌓입니다";
    $("changes").replaceChildren(note);
  }
  $<HTMLButtonElement>("undo").disabled = !session?.canUndo;
  $<HTMLButtonElement>("redo").disabled = !session?.canRedo;
  $<HTMLButtonElement>("revert").disabled = !session?.changes.length;
  $<HTMLButtonElement>("export").disabled = !session;
  $<HTMLButtonElement>("capture").disabled = !hasModel();
  $<HTMLButtonElement>("reset-pose").disabled = !hasModel();
  bridge.syncTools();
  const canOpen = !!runtime && (!external || external.connected);
  $<HTMLButtonElement>("load-sample").disabled = !canOpen;
  $<HTMLInputElement>("file-input").disabled = !canOpen;
  $("file-input").parentElement!.classList.toggle("disabled", !canOpen);
}

function rebuildParameters(): void {
  const physicsOut = new Set(session ? inspectModel(session.current).parameters.filter((p) => p.drivenBy.length).map((p) => p.id) : []);
  panel = renderParameters($("params"), hasModel() ? runtime : undefined, physicsOut, paramFilter);
}

async function loadSample(): Promise<void> {
  if (iki) {
    setOverlay({ kind: "loading", label: "샘플 모델 불러오는 중" });
    try {
      const res = await fetch("./models/hero.iki");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await openIkiText(await res.text(), "hero.iki");
    } catch (err) {
      setOverlay({ kind: "error", title: "샘플을 불러오지 못했습니다", detail: (err as Error).message });
    }
  } else if (external?.connected) {
    // Contract: load([]) opens the adapter's built-in sample, if it has one.
    await openExternal([], `${external.label} 샘플`);
  }
}

// --- Controls ------------------------------------------------------------------

$("load-sample").addEventListener("click", () => void loadSample());
$("settings").addEventListener("click", () => void showSettings());

$<HTMLInputElement>("file-input").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  await openFiles(files);
});

$("motion-mode").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
  if (!btn || btn.disabled || !runtime) return;
  runtime.setMotionMode(btn.dataset.mode as MotionMode);
  syncChrome(true);
});

$("reset-pose").addEventListener("click", () => {
  runtime?.resetPose();
  toast("포즈를 기본값으로 되돌렸습니다");
});

$<HTMLInputElement>("param-search").addEventListener("input", (e) => {
  paramFilter = (e.target as HTMLInputElement).value;
  rebuildParameters();
});

$("capture").addEventListener("click", async () => {
  if (!runtime) return;
  const blob = await runtime.captureFrame();
  download(blob, `${session?.current.name ?? external?.modelName ?? "frame"}-${Date.now()}.png`);
  toast(`프레임 저장 · ${canvas.width}×${canvas.height}`);
});

$("export").addEventListener("click", () => {
  if (!session) return;
  try {
    download(new Blob([session.serialize()], { type: "application/json" }), `${session.current.name}.iki`);
    toast(`${session.current.name}.iki 저장 · 변경 ${session.changes.length}개 포함`);
  } catch (err) {
    toast((err as Error).message, "error");
  }
});

$("undo").addEventListener("click", () => session?.undo());
$("redo").addEventListener("click", () => session?.redo());
$("revert").addEventListener("click", () => {
  if (!session?.changes.length) return;
  session.revertAll();
  toast("원본으로 되돌렸습니다");
});

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "j" && !target.closest("dialog")) {
    e.preventDefault();
    showView(currentView === "agent" ? "inspector" : "agent");
    return;
  }
  if (target.matches("input[type=text], input[type=search], input[type=url], input:not([type]), textarea") || target.closest("dialog")) return;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) session?.redo();
    else session?.undo();
  } else if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    session?.redo();
  } else if (mod && e.key === ",") {
    e.preventDefault();
    void showSettings();
  }
});

// Drag and drop onto the stage.
let dragDepth = 0;
stage.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if (dragDepth++ === 0) {
    overlayBeforeDrop = overlayState;
    setOverlay({ kind: "drop" });
  }
});
stage.addEventListener("dragover", (e) => e.preventDefault());
stage.addEventListener("dragleave", () => {
  if (--dragDepth === 0) setOverlay(overlayBeforeDrop);
});
stage.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return setOverlay(overlayBeforeDrop);
  await openFiles(files);
});

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Programmatic handle for experiments and, later, the agent tool layer.
declare global {
  interface Window {
    nyal2d: {
      readonly runtime: PuppetRuntime | undefined;
      session: () => ModelSession | undefined;
      inspect: () => ReturnType<typeof inspectModel> | undefined;
      settings: () => AppSettings;
      /** Agent tool layer (docs/agent/first-capabilities.md), callable without any LLM. */
      tools: { list: () => ToolSpec[]; call: (name: string, args?: unknown) => Promise<ToolResult> };
      ready: Promise<void>;
    };
  }
}

// --- Agent -----------------------------------------------------------------------

const llm = new ProxyLlmClient();
// Tool calls from Claude Code (in-app "run" mode or an MCP client the person runs) arrive over the bridge.
const bridge = new BridgeClient({ tools: () => listTools(toolContext()), call: (name, args) => window.nyal2d.tools.call(name, args) });
const agent = new AgentRouter(new AgentSession(llm, toolContext), llm, bridge);
let bridgeWanted = false;
const agentPanel = mountAgentPanel($("view-agent"), agent, llm, bridge, {
  onHealth(h) {
    agent.setMode(h?.mode === "run" ? "run" : "turn");
    // Run mode needs the page on the hub; otherwise the bridge is the person's choice.
    if (h?.mode === "run" && !bridge.isEnabled) {
      bridgeWanted = true;
      bridge.enable();
    } else if (h?.mode !== "run" && bridgeWanted) {
      bridgeWanted = false;
      bridge.disable();
    }
  },
});
type View = "inspector" | "agent";
let currentView: View = "inspector";

function showView(view: View): void {
  currentView = view;
  for (const b of $("panel-switch").querySelectorAll<HTMLButtonElement>("button")) b.setAttribute("aria-selected", String(b.dataset.view === view));
  $("view-inspector").hidden = view !== "inspector";
  $("view-agent").hidden = view !== "agent";
  try {
    localStorage.setItem("nyal2d.view", view);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  if (view === "agent") {
    void agentPanel.refreshHealth();
    agentPanel.focus();
  }
}

$("panel-switch").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]");
  if (b) showView(b.dataset.view as View);
});
try {
  if (localStorage.getItem("nyal2d.view") === "agent") showView("agent");
} catch {
  // Storage blocked: start on the inspector.
}

/** A different model or runtime makes the conversation stale. */
function resetAgent(): void {
  if (!agent.hasHistory && !agent.busy) return;
  agent.reset();
  agentPanel.clear("모델이 바뀌어 대화를 새로 시작했습니다.");
}

function toolContext(): ToolContext {
  return { runtime, session, modelOpen: hasModel() };
}

/**
 * `?open=<path or URL>` opens that file at startup instead of the sample —
 * a model or layered art (.iki, .psd, .png) served next to the app, e.g. from
 * the git-ignored `public/local/` folder for art that stays out of the repo.
 */
async function openFromQuery(): Promise<boolean> {
  const src = new URLSearchParams(location.search).get("open");
  if (!src) return false;
  const name = decodeURIComponent(src.split(/[/?#]/).filter(Boolean).pop() ?? src);
  setOverlay({ kind: "loading", label: `${name} 불러오는 중` });
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await openFiles([new File([blob], name, { type: blob.type })]);
  } catch (err) {
    setOverlay({ kind: "error", title: `${name}을(를) 불러오지 못했습니다`, detail: (err as Error).message });
  }
  return true;
}

const ready = (async () => {
  await activateRuntime(settings);
  if (runtime && !(await openFromQuery())) await loadSample();
})();

window.nyal2d = {
  get runtime() {
    return runtime;
  },
  session: () => session,
  inspect: () => (session ? inspectModel(session.current) : undefined),
  settings: () => settings,
  tools: {
    list: () => listTools(toolContext()),
    call: async (name, args) => {
      const result = await callTool(name, args, toolContext());
      // Model edits already redraw through the session; runtime state (motion mode) does not.
      if (result.ok && name === "set_motion_mode") syncChrome();
      return result;
    },
  },
  ready,
};
