import { readFileSync } from "node:fs";
import { loadIkiModel, type IkiMatrixDeformer } from "@ikijs/format";
import { describe, expect, it } from "vitest";
import { callTool, listTools, type ToolContext } from "../src/agent/tools";
import { ModelSession } from "../src/model/model-session";
import type { MotionMode, PuppetRuntime, RuntimeCapabilities } from "../src/runtime/types";

const hero = loadIkiModel(readFileSync(new URL("../public/models/hero.iki", import.meta.url), "utf8"));

/** In-memory stand-in for a runtime: parameter store, motion mode, fixed capture. */
function fakeRuntime(caps: Partial<RuntimeCapabilities> = {}): PuppetRuntime {
  const params = hero.parameters.map((p) => ({ id: p.id, name: p.name, min: p.min, max: p.max, default: p.default }));
  const values = new Map(params.map((p) => [p.id, p.default]));
  let mode: MotionMode = "off";
  return {
    kind: "fake",
    label: "Fake",
    accept: "",
    capabilities: { editing: true, physicsSimulation: true, inspection: "full", motionModes: ["idle", "physics", "off"], ...caps },
    getParameters: () => params,
    getParameter: (id) => values.get(id) ?? 0,
    setParameter(id, v) {
      const p = params.find((x) => x.id === id)!;
      values.set(id, Math.min(p.max, Math.max(p.min, v)));
    },
    resetPose: () => params.forEach((p) => values.set(p.id, p.default)),
    get drivenParameterIds() {
      return mode === "idle" ? ["ParamBreath", "ParamAngleX"] : [];
    },
    setMotionMode: (m) => void (mode = m),
    get motionMode() {
      return mode;
    },
    onParameter: () => () => {},
    captureFrame: async () => new Blob([new Uint8Array(8)], { type: "image/png" }),
    destroy: () => {},
  };
}

const ikiCtx = (): ToolContext => ({ runtime: fakeRuntime(), session: new ModelSession(hero), modelOpen: true });
const names = (ctx: ToolContext) => listTools(ctx).map((t) => t.name);

describe("tool discovery", () => {
  it("offers every tool for an editable Iki model, as plain JSON", () => {
    const ctx = ikiCtx();
    expect(names(ctx)).toEqual([
      "list_capabilities", "inspect_model", "get_parameters", "capture_frame", "simulate_physics", "list_changes",
      "set_parameter", "set_motion_mode", "edit_physics_rig", "edit_binding", "undo", "revert_all",
    ]);
    expect(JSON.parse(JSON.stringify(listTools(ctx)))).toEqual(listTools(ctx));
  });

  it("offers only the parameter tools for a black-box runtime", () => {
    const ctx: ToolContext = { runtime: fakeRuntime({ editing: false, physicsSimulation: false, inspection: "parameters" }), modelOpen: true };
    expect(names(ctx)).toEqual(["list_capabilities", "get_parameters", "capture_frame", "set_parameter", "set_motion_mode"]);
  });

  it("offers almost nothing before a model is open", () => {
    expect(names({ runtime: fakeRuntime(), modelOpen: false })).toEqual(["list_capabilities", "set_motion_mode"]);
  });
});

describe("callTool", () => {
  it("rejects unknown tools, unavailable tools and bad arguments without throwing", async () => {
    const ctx = ikiCtx();
    expect(await callTool("nope", {}, ctx)).toEqual({ ok: false, error: "없는 도구: nope" });
    expect((await callTool("inspect_model", {}, { modelOpen: false })).ok).toBe(false);
    const bad = await callTool("set_parameter", { id: 3 }, ctx);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/input.value: 필수.*input.id: 문자열/);
    expect(!(await callTool("set_parameter", { id: "ParamAngleX", value: 1, extra: 1 }, ctx)).ok).toBe(true);
  });

  it("sets parameters with clamping and warns when motion overwrites them", async () => {
    const ctx = ikiCtx();
    expect(await callTool("set_parameter", { id: "ParamAngleX", value: 99 }, ctx)).toEqual({
      ok: true,
      data: { id: "ParamAngleX", value: 30, clamped: true },
    });
    await callTool("set_motion_mode", { mode: "idle" }, ctx);
    const r = await callTool("set_parameter", { id: "ParamBreath", value: 0.5 }, ctx);
    expect(r.ok && (r.data as { warning?: string }).warning).toMatch(/idle/);
  });

  it("simulates the hair rig deterministically, matching the recorded observation", async () => {
    const ctx = ikiCtx();
    const r = await callTool("simulate_physics", { input: "ParamAngleX", to: 30, record: ["ParamHairSwayX"] }, ctx);
    expect(r.ok).toBe(true);
    const out = (r as { data: { outputs: Record<string, { peak: number; peakMs: number; final: number; overshoot: number }> } }).data.outputs.ParamHairSwayX;
    // app/observations/hair-sway-step.json: peak ≈ 7.0 near 600 ms, settling near 5.
    expect(out.peak).toBeGreaterThan(6.5);
    expect(out.peak).toBeLessThan(7.5);
    expect(out.peakMs).toBeGreaterThan(400);
    expect(out.peakMs).toBeLessThan(800);
    expect(out.overshoot).toBeGreaterThan(0);
    const again = await callTool("simulate_physics", { input: "ParamAngleX", to: 30, record: ["ParamHairSwayX"] }, ctx);
    expect(again).toEqual(r);
  });

  it("edits a rig through the change list, and stiffer damping reduces overshoot", async () => {
    const ctx = ikiCtx();
    const sim = async () =>
      ((await callTool("simulate_physics", { input: "ParamAngleX", to: 30, record: ["ParamHairSwayX"] }, ctx)) as {
        data: { outputs: { ParamHairSwayX: { overshoot: number } } };
      }).data.outputs.ParamHairSwayX.overshoot;
    const before = await sim();
    const r = await callTool("edit_physics_rig", { rig: "hairSway", damping: 8 }, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.session!.changes.map((c) => [c.label, c.source])).toEqual([["Set physics rig", "agent"]]);
    expect(await sim()).toBeLessThan(before);
    expect(ctx.session!.original.physics![0].damping).toBe(3);

    expect((await callTool("edit_physics_rig", { rig: "hairSway", mass: -1 }, ctx)).ok).toBe(false);
    expect((await callTool("edit_physics_rig", { rig: "nope", mass: 2 }, ctx)).ok).toBe(false);
    expect(ctx.session!.changes).toHaveLength(1);

    expect((await callTool("undo", {}, ctx)).ok).toBe(true);
    expect(ctx.session!.current.physics![0].damping).toBe(3);
  });

  it("softens breathing by editing a deformer binding (worked example 1)", async () => {
    const ctx = ikiCtx();
    const r = await callTool("edit_binding", { target: "deformer", id: "bodyDeformer", parameter: "ParamBreath", channel: "translateY", to: 2.3 }, ctx);
    expect(r).toMatchObject({ ok: true, data: { before: { to: 4.6 }, after: { to: 2.3 } } });
    const body = ctx.session!.current.deformers!.find((d) => d.id === "bodyDeformer") as IkiMatrixDeformer;
    expect(body.bindings!.find((b) => b.parameter === "ParamBreath")!.to).toBe(2.3);

    // A new binding needs both ends; removing a missing one fails cleanly.
    expect((await callTool("edit_binding", { target: "deformer", id: "bodyDeformer", parameter: "ParamAngleX", channel: "rotate", to: 3 }, ctx)).ok).toBe(false);
    expect((await callTool("edit_binding", { target: "deformer", id: "bodyDeformer", parameter: "ParamAngleX", channel: "rotate", remove: true }, ctx)).ok).toBe(false);
    expect((await callTool("revert_all", {}, ctx))).toEqual({ ok: true, data: { dropped: 1 } });
  });

  it("captures a frame after applying a pose", async () => {
    const ctx = ikiCtx();
    const r = await callTool("capture_frame", { pose: { ParamMouthOpenY: 1 } }, ctx);
    expect(r.ok && r.image?.type).toBe("image/png");
    expect(ctx.runtime!.getParameter("ParamMouthOpenY")).toBe(1);
    expect((await callTool("capture_frame", { pose: { Nope: 1 } }, ctx)).ok).toBe(false);
  });
});
