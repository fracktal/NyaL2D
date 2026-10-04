import { HairChainMotion, IkiMotion, IkiPlayer, PhysicsMotion, type IkiLoadResult } from "@ikijs/engine";
import { parseIkiModel, type IkiModel, type IkiParameter } from "@ikijs/format";

type ParamListener = (id: string, value: number) => void;

/**
 * - `idle`: Iki's bundled idle (blink, breath, gaze, head sway) + physics.
 * - `physics`: physics rigs and chains only. Idle also writes ParamAngleX/Y/Z,
 *   so this is the mode for driving the head yourself and watching the
 *   secondary motion respond.
 * - `off`: nothing runs; parameters stay where they were set.
 */
export type MotionMode = "idle" | "physics" | "off";

interface MotionDriver {
  readonly drivenParameterIds: readonly string[];
  update(nowMs: number): void;
}

/**
 * The application's single boundary to the Iki runtime.
 *
 * Everything the app (and later the agent) does to the live puppet goes
 * through here: load a model, read/write parameters, run the motion drivers,
 * capture a rendered frame. Nothing outside this module imports
 * `@ikijs/engine`.
 */
export class IkiRuntime {
  private readonly player: IkiPlayer;
  private model?: IkiModel;
  private motion?: MotionDriver;
  private motionRaf?: number;
  private mode: MotionMode = "idle";
  private paramListeners = new Set<ParamListener>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.player = new IkiPlayer(canvas);
    this.player.start();
  }

  /**
   * Validate and load a model. The player keeps a reference to the object it
   * is given, so we hand it a private clone: later edits to the caller's
   * model only reach the screen through another `load()`.
   *
   * Parameter values that the new model still declares are carried over, so a
   * reload after an edit does not snap the pose back to defaults.
   */
  async load(model: IkiModel): Promise<IkiLoadResult> {
    const validated = parseIkiModel(structuredClone(model));
    const previous = this.model ? this.snapshotParameters() : undefined;
    const result = await this.player.load(validated);
    if (result.superseded) return result;
    this.model = validated;
    if (previous) {
      for (const [id, value] of Object.entries(previous)) this.player.setParameter(id, value);
    }
    this.rebuildMotion();
    return result;
  }

  get loadedModel(): IkiModel | undefined {
    return this.model;
  }

  getParameters(): IkiParameter[] {
    return this.player.getParameters();
  }

  getParameter(id: string): number {
    return this.player.getParameter(id);
  }

  setParameter(id: string, value: number): void {
    this.player.setParameter(id, value);
    this.emitParam(id);
  }

  /** Put every parameter back at its declared default. */
  resetPose(): void {
    for (const p of this.player.getParameters()) this.setParameter(p.id, p.default);
  }

  snapshotParameters(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.player.getParameters()) out[p.id] = this.player.getParameter(p.id);
    return out;
  }

  /** Parameters written by the idle/physics/chain drivers for this model. */
  get drivenParameterIds(): readonly string[] {
    return this.motion?.drivenParameterIds ?? [];
  }

  setMotionMode(mode: MotionMode): void {
    this.mode = mode;
    this.rebuildMotion();
  }

  get motionMode(): MotionMode {
    return this.mode;
  }

  onParameter(listener: ParamListener): () => void {
    this.paramListeners.add(listener);
    return () => this.paramListeners.delete(listener);
  }

  /**
   * Capture the next rendered frame as a PNG blob.
   *
   * The player renders inside its own requestAnimationFrame loop and its
   * WebGL context does not set `preserveDrawingBuffer`, so the canvas must be
   * read in a later rAF callback of the same frame, before the browser
   * composites and clears it. See docs/iki/rendering.md for the observation
   * that backs this.
   */
  captureFrame(type = "image/png"): Promise<Blob> {
    return new Promise((resolve, reject) => {
      requestAnimationFrame(() => {
        // toDataURL is synchronous, so it reads the buffer the player just drew.
        const url = this.canvas.toDataURL(type);
        fetch(url)
          .then((r) => r.blob())
          .then(resolve, reject);
      });
    });
  }

  destroy(): void {
    this.stopMotion();
    this.player.destroy();
  }

  private rebuildMotion(): void {
    this.stopMotion();
    this.motion = undefined;
    if (!this.model || this.mode === "off") return;
    // A fresh driver set per model: physics rigs are read at construction.
    const read = (id: string) => this.player.getParameter(id);
    const sink = (id: string, value: number) => {
      this.player.setParameter(id, value);
      this.emitParam(id);
    };
    const m = this.model;
    const motion: MotionDriver =
      this.mode === "idle" ? new IkiMotion(m, read, sink) : physicsOnly(m, read, sink);
    this.motion = motion;
    const frame = () => {
      motion.update(performance.now());
      this.motionRaf = requestAnimationFrame(frame);
    };
    this.motionRaf = requestAnimationFrame(frame);
  }

  private stopMotion(): void {
    if (this.motionRaf !== undefined) cancelAnimationFrame(this.motionRaf);
    this.motionRaf = undefined;
  }

  private emitParam(id: string): void {
    const value = this.player.getParameter(id);
    for (const l of this.paramListeners) l(id, value);
  }
}

function physicsOnly(
  model: IkiModel,
  read: (id: string) => number,
  sink: (id: string, value: number) => void,
): MotionDriver {
  const physics = new PhysicsMotion(model.physics ?? [], model.parameters, read, sink);
  const chains = new HairChainMotion(model.physicsChains ?? [], model.parameters, model.deformers ?? [], read, sink);
  return {
    drivenParameterIds: [...new Set([...physics.drivenParameterIds, ...chains.drivenParameterIds])],
    update(nowMs) {
      physics.update(nowMs);
      chains.update(nowMs);
    },
  };
}
