import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadIkiModel, type IkiModel } from "@ikijs/format";
import { describe, expect, it } from "vitest";
import { simulatePhysics } from "../src/runtime/simulate";

const hero = loadIkiModel(readFileSync(new URL("../public/models/hero.iki", import.meta.url), "utf8"));

const step = (model: IkiModel) =>
  simulatePhysics(model, {
    durationMs: 2000,
    inputs: (t) => ({ ParamAngleX: t > 0 ? 30 : 0 }),
    record: ["ParamHairSwayX"],
  }).map((s) => [s.t, s.values.ParamHairSwayX] as const);

const withStiffness = (k: number): IkiModel => ({
  ...hero,
  physics: hero.physics!.map((r) => (r.id === "hairSway" ? { ...r, stiffness: k } : r)),
});

describe("simulatePhysics (headless)", () => {
  it("is deterministic", () => {
    expect(step(hero)).toEqual(step(hero));
  });

  it("produces a lagging, overshooting step response around input × weight × scale", () => {
    const soft = step(hero);
    const stiff = step(withStiffness(120));
    const final = soft.at(-1)![1];
    const peak = (xs: readonly (readonly [number, number])[]) => Math.max(...xs.map((x) => x[1]));
    // Lags: starts at rest, not at the target.
    expect(soft[1][1]).toBeLessThan(final);
    // Overshoots the settled value (underdamped spring).
    expect(peak(soft)).toBeGreaterThan(final);
    // Both settle near the same target (input × weight × scale).
    expect(stiff.at(-1)![1]).toBeCloseTo(final, 0);

    // Record the trajectories so docs can cite them as an observation.
    if (process.env.RECORD_OBSERVATIONS) {
      mkdirSync("observations", { recursive: true });
      writeFileSync(
        "observations/hair-sway-step.json",
        JSON.stringify({ input: "ParamAngleX 0→30 at t=0", soft_k30: soft.filter((_, i) => i % 6 === 0), stiff_k120: stiff.filter((_, i) => i % 6 === 0) }, null, 1),
      );
    }
  });
});
