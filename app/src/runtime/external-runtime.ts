import { captureCanvasNextFrame, type MotionMode, type PuppetRuntime, type RuntimeCapabilities, type RuntimeParameter } from "./types";

/**
 * Contract version an adapter module must export as `nyal2dAdapter`.
 * See docs/runtime/adapter-contract.md.
 */
export const ADAPTER_CONTRACT_VERSION = 1;

export interface AdapterMeta {
  name: string;
  version?: string;
  /** File picker `accept` value, e.g. ".zip,.moc3". */
  accept?: string;
  /** Motion modes the adapter can run besides "off". */
  motionModes?: MotionMode[];
  /**
   * `false` marks an empty wrapper that is not wired to its runtime yet; the
   * app then shows a "not connected" state instead of opening models.
   */
  connected?: boolean;
}

/** What an adapter's `create()` resolves to. Optional members may be absent. */
export interface AdapterInstance {
  load(files: File[]): Promise<void>;
  parameters(): RuntimeParameter[];
  getParameter(id: string): number;
  setParameter(id: string, value: number): void;
  modelName?(): string;
  setMotionMode?(mode: MotionMode): void;
  drivenParameterIds?(): string[];
  capture?(type: string): Promise<Blob>;
  destroy(): void;
}

export interface AdapterModule {
  nyal2dAdapter: number;
  meta: AdapterMeta;
  create(canvas: HTMLCanvasElement): Promise<AdapterInstance> | AdapterInstance;
}

export class AdapterError extends Error {}

/** Check a dynamically imported module against the contract. */
export function validateAdapterModule(mod: unknown): AdapterModule {
  const m = mod as Partial<AdapterModule> | null;
  if (!m || typeof m !== "object") throw new AdapterError("모듈이 비어 있습니다");
  if (m.nyal2dAdapter !== ADAPTER_CONTRACT_VERSION) {
    throw new AdapterError(`nyal2dAdapter = ${String(m.nyal2dAdapter)} (지원: ${ADAPTER_CONTRACT_VERSION})`);
  }
  if (!m.meta || typeof m.meta.name !== "string" || !m.meta.name) throw new AdapterError("meta.name이 없습니다");
  if (typeof m.create !== "function") throw new AdapterError("create(canvas) 함수가 없습니다");
  return m as AdapterModule;
}

function validateInstance(inst: unknown): AdapterInstance {
  const i = inst as Partial<AdapterInstance> | null;
  const required = ["load", "parameters", "getParameter", "setParameter", "destroy"] as const;
  const missing = required.filter((k) => typeof i?.[k] !== "function");
  if (!i || missing.length) throw new AdapterError(`create()가 반환한 객체에 ${missing.join(", ")} 이(가) 없습니다`);
  return i as AdapterInstance;
}

/** Import an adapter module from a URL (resolved against the page). */
export async function importAdapter(url: string): Promise<AdapterModule> {
  const href = new URL(url, document.baseURI).href;
  let mod: unknown;
  try {
    mod = await import(/* @vite-ignore */ href);
  } catch (err) {
    throw new AdapterError(`모듈을 불러오지 못했습니다: ${(err as Error).message}`);
  }
  return validateAdapterModule(mod);
}

/**
 * A runtime provided by an external adapter module, used as a black box:
 * the app only calls the contract's functions and reads the canvas.
 */
export class ExternalRuntime implements PuppetRuntime {
  readonly kind: string;
  readonly label: string;
  readonly accept: string;
  readonly capabilities: RuntimeCapabilities;
  private mode: MotionMode = "off";
  private listeners = new Set<(id: string, value: number) => void>();
  private params: RuntimeParameter[] = [];
  private pollRaf = 0;

  private constructor(
    kind: string,
    private readonly meta: AdapterMeta,
    private readonly inst: AdapterInstance,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.kind = kind;
    this.label = meta.name;
    this.accept = meta.accept ?? "";
    const modes = (meta.motionModes ?? []).filter((m) => m !== "off");
    this.capabilities = {
      editing: false,
      physicsSimulation: false,
      inspection: "parameters",
      motionModes: [...modes, "off"],
    };
    if (modes.length && inst.setMotionMode) this.setMotionMode(modes[0]);
    // The adapter's own motion writes parameters internally; poll the ones it
    // reports so the UI (and later the agent) sees live values.
    const poll = () => {
      for (const id of this.drivenParameterIds) {
        const v = this.getParameter(id);
        for (const l of this.listeners) l(id, v);
      }
      this.pollRaf = requestAnimationFrame(poll);
    };
    this.pollRaf = requestAnimationFrame(poll);
  }

  static async create(kind: string, mod: AdapterModule, canvas: HTMLCanvasElement): Promise<ExternalRuntime> {
    const inst = validateInstance(await mod.create(canvas));
    return new ExternalRuntime(kind, mod.meta, inst, canvas);
  }

  /** False for an empty wrapper (`meta.connected === false`). */
  get connected(): boolean {
    return this.meta.connected !== false;
  }

  get adapterVersion(): string | undefined {
    return this.meta.version;
  }

  async load(files: File[]): Promise<void> {
    await this.inst.load(files);
    const raw = this.inst.parameters();
    if (!Array.isArray(raw)) throw new AdapterError("parameters()가 배열을 반환하지 않았습니다");
    this.params = raw.filter(
      (p) => p && typeof p.id === "string" && [p.min, p.max, p.default].every(Number.isFinite) && p.max > p.min,
    );
  }

  get modelName(): string | undefined {
    return this.inst.modelName?.();
  }

  getParameters(): RuntimeParameter[] {
    return this.params;
  }

  getParameter(id: string): number {
    const v = this.inst.getParameter(id);
    return Number.isFinite(v) ? v : 0;
  }

  setParameter(id: string, value: number): void {
    const p = this.params.find((x) => x.id === id);
    if (!p || !Number.isFinite(value)) return;
    this.inst.setParameter(id, Math.min(p.max, Math.max(p.min, value)));
    const v = this.getParameter(id);
    for (const l of this.listeners) l(id, v);
  }

  resetPose(): void {
    for (const p of this.params) this.setParameter(p.id, p.default);
  }

  get drivenParameterIds(): readonly string[] {
    return this.mode === "off" ? [] : (this.inst.drivenParameterIds?.() ?? []);
  }

  setMotionMode(mode: MotionMode): void {
    if (!this.capabilities.motionModes.includes(mode)) return;
    this.mode = mode;
    this.inst.setMotionMode?.(mode);
  }

  get motionMode(): MotionMode {
    return this.mode;
  }

  onParameter(listener: (id: string, value: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  captureFrame(type = "image/png"): Promise<Blob> {
    return this.inst.capture ? this.inst.capture(type) : captureCanvasNextFrame(this.canvas, type);
  }

  destroy(): void {
    cancelAnimationFrame(this.pollRaf);
    this.inst.destroy();
    this.listeners.clear();
  }
}
