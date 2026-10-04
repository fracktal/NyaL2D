import { readFileSync } from "node:fs";
import { SetDeformerBindings, SetPhysicsRig } from "@ikijs/editor";
import { loadIkiModel, type IkiMatrixDeformer } from "@ikijs/format";
import { describe, expect, it } from "vitest";
import { inspectModel } from "../src/inspection/inspect";
import { ModelSession } from "../src/model/model-session";

const hero = loadIkiModel(readFileSync(new URL("../public/models/hero.iki", import.meta.url), "utf8"));

describe("inspectModel", () => {
  it("summarizes the sample model from declared fields only", () => {
    const snap = inspectModel(hero);
    expect(snap.parameters).toHaveLength(16);
    expect(snap.parts).toHaveLength(15);
    expect(snap.deformers).toHaveLength(8);
    expect(snap.physics.map((p) => p.id)).toEqual(["hairSway", "hairTilt"]);
    const breath = snap.parameters.find((p) => p.id === "ParamBreath")!;
    expect(breath.usedBy).toEqual(expect.arrayContaining(["deformer:bodyDeformer", "deformer:headDeformer"]));
    const sway = snap.parameters.find((p) => p.id === "ParamHairSwayX")!;
    expect(sway.drivenBy).toEqual(["physics:hairSway"]);
    // Must stay JSON-serializable: it is the agent's observation format.
    expect(() => JSON.stringify(snap)).not.toThrow();
  });
});

describe("ModelSession", () => {
  const softerBreath = () => {
    const body = hero.deformers!.find((d) => d.id === "bodyDeformer") as IkiMatrixDeformer;
    return new SetDeformerBindings(
      "bodyDeformer",
      body.bindings!.map((b) => (b.parameter === "ParamBreath" ? { ...b, to: b.to / 2 } : b)),
    );
  };
  const bodyBreathTo = (s: ModelSession) =>
    (s.current.deformers!.find((d) => d.id === "bodyDeformer") as IkiMatrixDeformer).bindings!.find(
      (b) => b.parameter === "ParamBreath",
    )!.to;

  it("keeps the original intact and records changes", () => {
    const s = new ModelSession(hero);
    s.apply(softerBreath(), "test");
    expect(bodyBreathTo(s)).toBeCloseTo(2.3);
    expect(bodyBreathTo({ current: s.original } as ModelSession)).toBeCloseTo(4.6);
    expect(s.changes.map((c) => [c.seq, c.label, c.source])).toEqual([[1, "Set deformer bindings", "test"]]);
    expect(Object.isFrozen(s.original)).toBe(true);
  });

  it("undoes, redoes and reverts", () => {
    const s = new ModelSession(hero);
    s.apply(softerBreath());
    const rig = { ...structuredClone(hero.physics![0]), stiffness: 60 };
    s.apply(new SetPhysicsRig("hairSway", rig));
    s.undo();
    expect(s.current.physics![0].stiffness).toBe(30);
    expect(s.canRedo).toBe(true);
    s.redo();
    expect(s.current.physics![0].stiffness).toBe(60);
    s.revertAll();
    expect(s.changes).toHaveLength(0);
    expect(bodyBreathTo(s)).toBeCloseTo(4.6);
    expect(s.current.physics![0].stiffness).toBe(30);
  });

  it("rejects an invalid change without touching the model", () => {
    const s = new ModelSession(hero);
    const bad = { ...structuredClone(hero.physics![0]), mass: -1 };
    expect(() => s.apply(new SetPhysicsRig("hairSway", bad))).toThrow();
    expect(s.changes).toHaveLength(0);
    expect(s.current.physics![0].mass).toBe(1);
  });

  it("serializes a model that round-trips through the validator", () => {
    const s = new ModelSession(hero);
    s.apply(softerBreath());
    const back = loadIkiModel(s.serialize());
    expect(bodyBreathTo({ current: back } as ModelSession)).toBeCloseTo(2.3);
  });
});
