import { HairChainMotion, ParameterStore, PhysicsMotion } from "@ikijs/engine";
import type { IkiModel } from "@ikijs/format";

export interface PhysicsSimulationOptions {
  /** Simulated duration in milliseconds. */
  durationMs: number;
  /** Frame rate the drivers are stepped at (they sub-step at 1/60 s internally). */
  fps?: number;
  /** Host-driven inputs at time t (ms), written before each physics step. */
  inputs: (tMs: number) => Record<string, number>;
  /** Parameter ids to record each frame. */
  record: string[];
}

export interface PhysicsSample {
  t: number;
  values: Record<string, number>;
}

/**
 * Step a model's physics rigs and chains on synthetic timestamps, with no
 * canvas, WebGL or wall clock.
 *
 * Iki's `PhysicsMotion` and `HairChainMotion` are pure drivers stepped by
 * `update(nowMs)` through read/sink callbacks, so they run deterministically
 * outside the browser. Idle motion is deliberately left out: it is random
 * (blink/gaze timing) and it also writes ParamAngleX/Y/Z, which would mask
 * the inputs given here.
 */
export function simulatePhysics(model: IkiModel, opts: PhysicsSimulationOptions): PhysicsSample[] {
  const store = new ParameterStore(model.parameters);
  const read = (id: string) => store.get(id);
  const sink = (id: string, v: number) => store.set(id, v);
  const physics = new PhysicsMotion(model.physics ?? [], model.parameters, read, sink);
  const chains = new HairChainMotion(model.physicsChains ?? [], model.parameters, model.deformers ?? [], read, sink);

  const frameMs = 1000 / (opts.fps ?? 60);
  const samples: PhysicsSample[] = [];
  for (let t = 0; t <= opts.durationMs + 1e-9; t += frameMs) {
    for (const [id, v] of Object.entries(opts.inputs(t))) store.set(id, v);
    physics.update(t);
    chains.update(t);
    const values: Record<string, number> = {};
    for (const id of opts.record) values[id] = store.get(id);
    samples.push({ t: Math.round(t * 1000) / 1000, values });
  }
  return samples;
}
