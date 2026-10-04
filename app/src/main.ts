import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import { loadIkiModel, type IkiModel } from "@ikijs/format";
import { inspectModel } from "./inspection/inspect";
import { ModelSession } from "./model/model-session";
import { IkiRuntime, type MotionMode } from "./runtime/iki-runtime";
import { renderChanges } from "./ui/changes";
import { icon } from "./ui/icons";
import { renderInspector } from "./ui/inspector";
import { renderParameters, type ParameterPanel } from "./ui/parameters";
import { toast } from "./ui/toast";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Hydrate data-icon attributes into inline SVGs.
for (const node of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon!));
}
$("param-search-wrap").insertAdjacentHTML("afterbegin", icon("search"));

const canvas = $<HTMLCanvasElement>("canvas");
const runtime = new IkiRuntime(canvas);
let session: ModelSession | undefined;
let unsubscribeSession: (() => void) | undefined;
let panel: ParameterPanel = { update() {} };
let paramFilter = "";

runtime.onParameter((id, v) => panel.update(id, v));

// --- Stage overlay & HUD -------------------------------------------------------

type OverlayState = { kind: "loading"; label: string } | { kind: "empty" } | { kind: "drop" } | { kind: "error"; title: string; detail: string } | { kind: "none" };
let overlayBeforeDrop: OverlayState = { kind: "none" };
let overlayState: OverlayState = { kind: "none" };

function setOverlay(state: OverlayState): void {
  overlayState = state;
  const overlay = $("overlay");
  const card = $("overlay-card");
  overlay.className = `stage-overlay ${state.kind === "none" ? "" : "visible"} ${state.kind}`;
  switch (state.kind) {
    case "loading":
      card.innerHTML = `<div class="spinner" aria-hidden="true"></div><p>${state.label}</p>`;
      break;
    case "empty":
      card.innerHTML = `${icon("upload", "big-icon")}<h3>모델을 열어 시작하세요</h3><p>.iki 파일을 여기로 끌어다 놓거나, 상단의 열기 또는 샘플을 누르세요.</p>`;
      break;
    case "drop":
      card.innerHTML = `${icon("upload", "big-icon")}<h3>놓아서 열기</h3><p>.iki 모델 파일</p>`;
      break;
    case "error":
      card.innerHTML = `${icon("alert", "big-icon")}<h3></h3><div class="error-detail"></div><p>다른 파일을 끌어다 놓거나 샘플을 열 수 있습니다.</p>`;
      card.querySelector("h3")!.textContent = state.title;
      card.querySelector(".error-detail")!.textContent = state.detail;
      if (session) {
        const back = document.createElement("button");
        back.className = "btn";
        back.type = "button";
        back.textContent = `${session.current.name}(으)로 돌아가기`;
        back.addEventListener("click", () => setOverlay({ kind: "none" }));
        card.append(back);
        back.focus();
      }
      break;
    default:
      card.replaceChildren();
  }
}

function setStatus(text: string): void {
  $("hud-status").lastElementChild!.textContent = text;
}

new ResizeObserver(() => {
  const dpr = window.devicePixelRatio || 1;
  $("hud-size").textContent = `${Math.round(canvas.clientWidth * dpr)} × ${Math.round(canvas.clientHeight * dpr)} px`;
}).observe(canvas);

// --- Model lifecycle -----------------------------------------------------------

async function openModel(model: IkiModel, label: string): Promise<void> {
  unsubscribeSession?.();
  session = new ModelSession(model);
  unsubscribeSession = session.onChange(() => void refresh());
  setOverlay({ kind: "loading", label: `${label} 불러오는 중` });
  await refresh(true);
  setOverlay({ kind: "none" });
  setStatus(label);
}

async function openText(text: string, label: string): Promise<void> {
  try {
    await openModel(loadIkiModel(text), label);
  } catch (err) {
    // IkiFormatError carries a path-qualified message, e.g. "parts[3].mesh…".
    setOverlay({ kind: "error", title: `${label}을(를) 열 수 없습니다`, detail: (err as Error).message });
    setStatus("열기 실패");
  }
}

/** Push the session's current model into the runtime and redraw the panels. */
async function refresh(rebuildParams = false): Promise<void> {
  if (!session) return;
  const result = await runtime.load(session.current);
  if (result.superseded) return;
  if (result.failedTextures.length) toast(`텍스처 ${result.failedTextures.join(", ")}번을 불러오지 못했습니다`, "error");
  const snap = inspectModel(session.current);

  const name = $("model-name");
  name.textContent = snap.name;
  name.classList.remove("muted");
  const badge = $("model-badge");
  badge.hidden = false;
  badge.textContent = session.changes.length ? `${session.changes.length}개 변경` : "원본";
  badge.className = `badge hide-md ${session.changes.length ? "accent" : ""}`;

  $("param-count").textContent = String(snap.parameters.length);
  if (rebuildParams || !$("params").childElementCount) rebuildParameters();
  renderInspector($("inspector-tabs"), $("inspector"), snap, session);
  renderChanges($("changes"), session);
  $<HTMLButtonElement>("undo").disabled = !session.canUndo;
  $<HTMLButtonElement>("redo").disabled = !session.canRedo;
  $<HTMLButtonElement>("revert").disabled = !session.changes.length;
  $<HTMLButtonElement>("export").disabled = false;
  $<HTMLButtonElement>("capture").disabled = false;
}

function rebuildParameters(): void {
  if (!session) return;
  panel = renderParameters($("params"), runtime, inspectModel(session.current), paramFilter);
}

async function loadSample(): Promise<void> {
  setOverlay({ kind: "loading", label: "샘플 모델 불러오는 중" });
  try {
    const res = await fetch("./models/hero.iki");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await openText(await res.text(), "hero.iki");
  } catch (err) {
    setOverlay({ kind: "error", title: "샘플을 불러오지 못했습니다", detail: (err as Error).message });
  }
}

// --- Controls ------------------------------------------------------------------

$("load-sample").addEventListener("click", () => void loadSample());

$<HTMLInputElement>("file-input").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) await openText(await file.text(), file.name);
});

const motionGroup = $("motion-mode");
motionGroup.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
  if (!btn) return;
  const mode = btn.dataset.mode as MotionMode;
  runtime.setMotionMode(mode);
  for (const b of motionGroup.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === btn));
  rebuildParameters();
});

$("reset-pose").addEventListener("click", () => {
  runtime.resetPose();
  toast("포즈를 기본값으로 되돌렸습니다");
});

$<HTMLInputElement>("param-search").addEventListener("input", (e) => {
  paramFilter = (e.target as HTMLInputElement).value;
  rebuildParameters();
});

$("capture").addEventListener("click", async () => {
  const blob = await runtime.captureFrame();
  download(blob, `${session?.current.name ?? "frame"}-${Date.now()}.png`);
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
  if (target.matches("input[type=text], input[type=search], input:not([type])")) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) session?.redo();
    else session?.undo();
  } else if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    session?.redo();
  }
});

// Drag and drop onto the stage.
const stage = $("stage");
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
  const file = e.dataTransfer?.files[0];
  if (!file) return setOverlay(overlayBeforeDrop);
  await openText(await file.text(), file.name);
});

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Initial state: nothing loaded until the sample arrives.
for (const id of ["undo", "redo", "revert", "export", "capture"]) $<HTMLButtonElement>(id).disabled = true;
rebuildParameters();

// Programmatic handle for experiments and, later, the agent tool layer.
declare global {
  interface Window {
    nyal2d: {
      runtime: IkiRuntime;
      session: () => ModelSession | undefined;
      inspect: () => ReturnType<typeof inspectModel> | undefined;
      ready: Promise<void>;
    };
  }
}
window.nyal2d = {
  runtime,
  session: () => session,
  inspect: () => (session ? inspectModel(session.current) : undefined),
  ready: loadSample(),
};
