import { loadIkiModel, type IkiModel } from "@ikijs/format";
import { inspectModel } from "./inspection/inspect";
import { ModelSession } from "./model/model-session";
import { IkiRuntime, type MotionMode } from "./runtime/iki-runtime";
import { renderChanges } from "./ui/changes";
import { renderInspector } from "./ui/inspector";
import { renderParameters } from "./ui/parameters";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("canvas");
const status = $("status");
const runtime = new IkiRuntime(canvas);
let session: ModelSession | undefined;
let unsubscribeSession: (() => void) | undefined;
let updateSlider: (id: string, v: number) => void = () => {};

runtime.onParameter((id, v) => updateSlider(id, v));

function setStatus(text: string): void {
  status.textContent = text;
}

async function openModel(model: IkiModel, label: string): Promise<void> {
  unsubscribeSession?.();
  session = new ModelSession(model);
  unsubscribeSession = session.onChange(() => void refresh());
  setStatus(`${label} 로딩 중…`);
  await refresh(true);
  setStatus(`${label} 로드됨`);
}

/** Push the session's current model into the runtime and redraw the panels. */
async function refresh(rebuildSliders = false): Promise<void> {
  if (!session) return;
  const result = await runtime.load(session.current);
  if (result.superseded) return;
  if (result.failedTextures.length) setStatus(`텍스처 로드 실패: ${result.failedTextures.join(", ")}`);
  $("model-name").textContent = session.current.name;
  if (rebuildSliders || $("params").childElementCount === 0) {
    updateSlider = renderParameters($("params"), runtime);
  }
  renderInspector($("inspector"), inspectModel(session.current), session);
  renderChanges($("changes"), session);
  $<HTMLButtonElement>("undo").disabled = !session.canUndo;
  $<HTMLButtonElement>("redo").disabled = !session.canRedo;
  $<HTMLButtonElement>("revert").disabled = session.changes.length === 0;
}

async function loadSample(): Promise<void> {
  const res = await fetch("./models/hero.iki");
  await openModel(loadIkiModel(await res.text()), "샘플 모델(hero.iki)");
}

$("load-sample").addEventListener("click", () => void loadSample());

$<HTMLInputElement>("file-input").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    await openModel(loadIkiModel(await file.text()), file.name);
  } catch (err) {
    // IkiFormatError carries a path-qualified message (e.g. "parts[3].mesh…").
    setStatus(`열기 실패: ${(err as Error).message}`);
  }
});

$<HTMLSelectElement>("motion-mode").addEventListener("change", (e) => {
  runtime.setMotionMode((e.target as HTMLSelectElement).value as MotionMode);
  updateSlider = renderParameters($("params"), runtime);
});

$("capture").addEventListener("click", async () => {
  const blob = await runtime.captureFrame();
  download(blob, `frame-${Date.now()}.png`);
  setStatus(`프레임 캡처 ${canvas.width}×${canvas.height}, ${Math.round(blob.size / 1024)} KB`);
});

$("export").addEventListener("click", () => {
  if (!session) return;
  download(new Blob([session.serialize()], { type: "application/json" }), `${session.current.name}.iki`);
});

$("undo").addEventListener("click", () => session?.undo());
$("redo").addEventListener("click", () => session?.redo());
$("revert").addEventListener("click", () => session?.revertAll());

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
