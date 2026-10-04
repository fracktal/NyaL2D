/**
 * What the application needs from any puppet runtime.
 *
 * Iki implements all of it (and more, see IkiRuntime). An external runtime
 * loaded through the adapter contract (docs/runtime/adapter-contract.md)
 * implements the parameter/render core and declares what else it supports
 * through {@link RuntimeCapabilities}, so the UI and, later, the agent can
 * discover what is possible instead of assuming it.
 */

export type MotionMode = "idle" | "physics" | "off";

export interface RuntimeParameter {
  id: string;
  name?: string;
  min: number;
  max: number;
  default: number;
}

export interface RuntimeCapabilities {
  /** Reversible model edits through ModelSession (Iki's EditCommand). */
  editing: boolean;
  /** Headless physics stepping (simulatePhysics). */
  physicsSimulation: boolean;
  /** Full model inspection (parts, deformers, physics) vs parameters only. */
  inspection: "full" | "parameters";
  /** Motion modes the runtime can run; `off` is always available. */
  motionModes: readonly MotionMode[];
}

export interface PuppetRuntime {
  readonly kind: string;
  readonly label: string;
  readonly capabilities: RuntimeCapabilities;
  /** `accept` attribute for the file picker. */
  readonly accept: string;

  getParameters(): RuntimeParameter[];
  getParameter(id: string): number;
  setParameter(id: string, value: number): void;
  resetPose(): void;
  /** Parameters the runtime's own motion writes every frame. */
  readonly drivenParameterIds: readonly string[];

  setMotionMode(mode: MotionMode): void;
  readonly motionMode: MotionMode;

  onParameter(listener: (id: string, value: number) => void): () => void;
  captureFrame(type?: string): Promise<Blob>;
  destroy(): void;
}

/**
 * Read a WebGL canvas without `preserveDrawingBuffer`: wait for the next
 * animation frame so the runtime's own rAF callback has drawn first.
 * Observed behaviour, see docs/iki/rendering.md.
 */
export function captureCanvasNextFrame(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      const url = canvas.toDataURL(type);
      fetch(url)
        .then((r) => r.blob())
        .then(resolve, reject);
    });
  });
}
