import { SetDeformerBindings, SetPartBindings, SetPhysicsRig, type EditCommand } from "@ikijs/editor";
import type { IkiBinding, IkiDeformerBinding, IkiModel } from "@ikijs/format";
import { inspectModel } from "../inspection/inspect";
import type { ModelSession } from "../model/model-session";
import { simulatePhysics } from "../runtime/simulate";
import type { MotionMode, PuppetRuntime } from "../runtime/types";
import { validate, type JsonSchema } from "./schema";

/**
 * The agent's tool layer (docs/agent/first-capabilities.md).
 *
 * Each tool wraps one runtime or editor operation that already exists and is
 * covered by tests. Tools know nothing about any LLM: an agent loop (or a
 * person in the console) lists them as JSON, calls them by name with JSON
 * arguments and gets JSON back. Model edits go through ModelSession as
 * EditCommands, so they land in the same change list and undo stack as
 * edits made in the inspector, tagged with their source.
 */

/** What the tools act on. Read fresh for every call. */
export interface ToolContext {
  runtime?: PuppetRuntime;
  /** Editable model, present only for the Iki runtime with a model open. */
  session?: ModelSession;
  /** Whether the runtime has a model open (external runtimes have no session). */
  modelOpen: boolean;
  /** Recorded as the change source for edits; defaults to "agent". */
  source?: string;
}

export type ToolResult = { ok: true; data: unknown; image?: Blob } | { ok: false; error: string };

/** Provider-neutral tool description: map it onto any tool-calling API. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
}

interface Tool<A> extends ToolSpec {
  /** Whether the tool makes sense right now (runtime, model, capabilities). */
  available(ctx: ToolContext): boolean;
  run(args: A, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}

const ok = (data: unknown, image?: Blob): ToolResult => (image ? { ok: true, data, image } : { ok: true, data });
const fail = (error: string): ToolResult => ({ ok: false, error });
const noArgs = { type: "object", properties: {} } as const;
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

const hasModel = (c: ToolContext) => !!c.runtime && c.modelOpen;
const editable = (c: ToolContext) => !!c.session && !!c.runtime?.capabilities.editing;

function applyEdit(ctx: ToolContext, cmd: EditCommand) {
  const entry = ctx.session!.apply(cmd, ctx.source ?? "agent");
  return { change: entry };
}

// --- Observation -----------------------------------------------------------------

const listCapabilities: Tool<Record<string, never>> = {
  name: "list_capabilities",
  description: "현재 런타임, 모델 상태, 지금 쓸 수 있는 도구 목록을 돌려준다. 작업을 시작할 때 먼저 부른다.",
  inputSchema: noArgs,
  available: () => true,
  run: (_args, ctx) =>
    ok({
      runtime: ctx.runtime ? { kind: ctx.runtime.kind, label: ctx.runtime.label, capabilities: ctx.runtime.capabilities } : null,
      model: ctx.session ? { name: ctx.session.current.name, editable: true, changes: ctx.session.changes.length } : ctx.modelOpen ? { editable: false } : null,
      tools: availableTools(ctx).map((t) => t.name),
    }),
};

const inspect: Tool<Record<string, never>> = {
  name: "inspect_model",
  description:
    "모델 구조 요약: 파라미터(범위, usedBy=그 파라미터를 읽는 파트·디포머, drivenBy=그 파라미터를 쓰는 물리), 파트, 디포머(바인딩 포함), 물리 리그, 체인, 텍스처.",
  inputSchema: noArgs,
  available: (c) => !!c.session,
  run: (_args, ctx) => ok(inspectModel(ctx.session!.current)),
};

const getParameters: Tool<Record<string, never>> = {
  name: "get_parameters",
  description: "모든 파라미터의 현재 값과 범위. driven=true인 값은 런타임 자체 모션(Idle, 물리)이 매 프레임 덮어쓴다.",
  inputSchema: noArgs,
  available: hasModel,
  run: (_args, ctx) => {
    const rt = ctx.runtime!;
    const driven = new Set(rt.drivenParameterIds);
    return ok({
      motionMode: rt.motionMode,
      parameters: rt.getParameters().map((p) => ({ ...p, value: round(rt.getParameter(p.id)), driven: driven.has(p.id) })),
    });
  },
};

const captureFrame: Tool<{ pose?: Record<string, number> }> = {
  name: "capture_frame",
  description: "현재 프레임을 PNG로 찍는다. pose를 주면 그 파라미터 값을 먼저 적용한다(포즈만 바뀌고 모델은 바뀌지 않는다).",
  inputSchema: {
    type: "object",
    properties: {
      pose: { type: "object", description: "파라미터 id → 값", properties: {}, additionalProperties: { type: "number" } },
    },
  },
  available: hasModel,
  async run(args, ctx) {
    const rt = ctx.runtime!;
    const unknown = Object.keys(args.pose ?? {}).filter((id) => !rt.getParameters().some((p) => p.id === id));
    if (unknown.length) return fail(`없는 파라미터: ${unknown.join(", ")}`);
    for (const [id, v] of Object.entries(args.pose ?? {})) rt.setParameter(id, v);
    const image = await rt.captureFrame("image/png");
    const overwritten = Object.keys(args.pose ?? {}).filter((id) => rt.drivenParameterIds.includes(id));
    return ok({ type: image.type, bytes: image.size, ...(overwritten.length ? { warning: `런타임 모션이 덮어쓰는 파라미터: ${overwritten.join(", ")}` } : {}) }, image);
  },
};

interface SimArgs {
  input: string;
  to: number;
  from?: number;
  durationMs?: number;
  record?: string[];
}

const simulate: Tool<SimArgs> = {
  name: "simulate_physics",
  description:
    "입력 파라미터를 from에서 to로 계단처럼 바꿨을 때 물리 출력이 어떻게 반응하는지 화면 없이 시뮬레이션한다. 출력마다 최대값, 오버슈트(계단 크기 대비 비율), 정착 시간(5% 이내), 최종값과 50ms 간격 궤적을 돌려준다. 결정적이라 편집 전후 비교에 쓴다.",
  inputSchema: {
    type: "object",
    properties: {
      input: { type: "string", description: "계단을 줄 파라미터 id (예: ParamAngleX)" },
      to: { type: "number", description: "계단 후 값" },
      from: { type: "number", description: "계단 전 값. 기본값은 파라미터 기본값" },
      durationMs: { type: "number", minimum: 100, maximum: 10000, description: "기본 2500" },
      record: { type: "array", items: { type: "string" }, maxItems: 16, description: "기록할 출력 id. 기본은 모든 물리 출력" },
    },
    required: ["input", "to"],
  },
  available: (c) => !!c.session && !!c.runtime?.capabilities.physicsSimulation,
  run(args, ctx) {
    const model = ctx.session!.current;
    const param = (id: string) => model.parameters.find((p) => p.id === id);
    const input = param(args.input);
    if (!input) return fail(`없는 파라미터: ${args.input}`);
    const record = args.record ?? physicsOutputs(model);
    const missing = record.filter((id) => !param(id));
    if (missing.length) return fail(`없는 파라미터: ${missing.join(", ")}`);
    if (!record.length) return fail("이 모델에는 물리 출력이 없습니다");
    const clamp = (v: number) => Math.min(input.max, Math.max(input.min, v));
    const from = clamp(args.from ?? input.default);
    const to = clamp(args.to);
    const samples = simulatePhysics(model, {
      durationMs: args.durationMs ?? 2500,
      inputs: (t) => ({ [input.id]: t > 0 ? to : from }),
      record,
    });
    return ok({
      input: { id: input.id, from, to },
      outputs: Object.fromEntries(record.map((id) => [id, summarize(samples.map((s) => [s.t, s.values[id]] as const))])),
    });
  },
};

function physicsOutputs(model: IkiModel): string[] {
  const ids = [
    ...(model.physics ?? []).map((r) => r.output.parameter),
    ...(model.physicsChains ?? []).flatMap((c) => c.segments.map((s) => s.output.parameter)),
  ];
  return [...new Set(ids)];
}

function summarize(series: readonly (readonly [number, number])[]) {
  const rest = series[0][1];
  const tail = series.slice(-10);
  const final = tail.reduce((a, [, v]) => a + v, 0) / tail.length;
  const step = final - rest;
  let peak = rest;
  let peakMs = 0;
  for (const [t, v] of series) {
    if (Math.abs(v - rest) > Math.abs(peak - rest)) {
      peak = v;
      peakMs = t;
    }
  }
  const band = Math.abs(step) * 0.05;
  let settleMs: number | null = null;
  if (Math.abs(step) > 1e-6) {
    for (let i = series.length - 1; i >= 0; i--) {
      if (Math.abs(series[i][1] - final) > band) {
        settleMs = i + 1 < series.length ? series[i + 1][0] : null;
        break;
      }
      if (i === 0) settleMs = 0;
    }
  }
  const trajectory: [number, number][] = [];
  let next = 0;
  for (const [t, v] of series) {
    if (t + 1e-6 >= next) {
      trajectory.push([Math.round(t), round(v)]);
      next += 50;
    }
  }
  return {
    rest: round(rest),
    final: round(final),
    peak: round(peak),
    peakMs: Math.round(peakMs),
    overshoot: Math.abs(step) > 1e-6 ? round(Math.max(0, (peak - final) / step)) : 0,
    settleMs: settleMs === null ? null : Math.round(settleMs),
    trajectory,
  };
}

const listChanges: Tool<Record<string, never>> = {
  name: "list_changes",
  description: "원본 이후 적용된 변경(seq, label, source)과 redo로 되살릴 수 있는 변경 목록.",
  inputSchema: noArgs,
  available: (c) => !!c.session,
  run: (_args, ctx) => ok({ applied: [...ctx.session!.changes], redoable: [...ctx.session!.redoable] }),
};

// --- Action ------------------------------------------------------------------------

const setParameter: Tool<{ id: string; value: number }> = {
  name: "set_parameter",
  description: "파라미터 값을 바꾼다(범위로 클램프). 포즈만 바뀌고 모델은 바뀌지 않으며 변경 기록에 남지 않는다.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" }, value: { type: "number" } },
    required: ["id", "value"],
  },
  available: hasModel,
  run(args, ctx) {
    const rt = ctx.runtime!;
    if (!rt.getParameters().some((p) => p.id === args.id)) return fail(`없는 파라미터: ${args.id}`);
    rt.setParameter(args.id, args.value);
    const value = round(rt.getParameter(args.id));
    return ok({
      id: args.id,
      value,
      ...(value !== round(args.value) ? { clamped: true } : {}),
      ...(rt.drivenParameterIds.includes(args.id) ? { warning: `현재 모션 모드(${rt.motionMode})가 이 값을 매 프레임 덮어씁니다` } : {}),
    });
  },
};

const setMotionMode: Tool<{ mode: MotionMode }> = {
  name: "set_motion_mode",
  description: "런타임 자체 모션: idle(깜빡임·호흡·시선 + 물리), physics(물리만, 머리 각도는 직접 조작), off(정지).",
  inputSchema: {
    type: "object",
    properties: { mode: { type: "string", enum: ["idle", "physics", "off"] } },
    required: ["mode"],
  },
  available: (c) => !!c.runtime,
  run(args, ctx) {
    const rt = ctx.runtime!;
    if (!rt.capabilities.motionModes.includes(args.mode)) return fail(`이 런타임이 지원하는 모드: ${rt.capabilities.motionModes.join(", ")}`);
    rt.setMotionMode(args.mode);
    return ok({ mode: rt.motionMode });
  },
};

interface RigArgs {
  rig: string;
  mass?: number;
  stiffness?: number;
  damping?: number;
  inputWeight?: number;
  outputScale?: number;
}

const editPhysicsRig: Tool<RigArgs> = {
  name: "edit_physics_rig",
  description:
    "물리 리그(스프링)의 값을 바꾼다. 준 필드만 바뀐다. stiffness↑ 빠르게 따라옴, damping↑ 덜 출렁임, mass↑ 느리고 묵직함, inputWeight 입력 반영 비율, outputScale 출력 크기. 변경 기록에 남고 undo로 되돌릴 수 있다.",
  inputSchema: {
    type: "object",
    properties: {
      rig: { type: "string", description: "리그 id (inspect_model의 physics[].id)" },
      mass: { type: "number", minimum: 0.0001 },
      stiffness: { type: "number", minimum: 0.0001 },
      damping: { type: "number", minimum: 0 },
      inputWeight: { type: "number" },
      outputScale: { type: "number" },
    },
    required: ["rig"],
  },
  available: (c) => editable(c) && !!c.session!.current.physics?.length,
  run(args, ctx) {
    const before = ctx.session!.current.physics?.find((r) => r.id === args.rig);
    if (!before) return fail(`없는 물리 리그: ${args.rig}`);
    const after = structuredClone(before);
    if (args.mass !== undefined) after.mass = args.mass;
    if (args.stiffness !== undefined) after.stiffness = args.stiffness;
    if (args.damping !== undefined) after.damping = args.damping;
    if (args.inputWeight !== undefined) after.input.weight = args.inputWeight;
    if (args.outputScale !== undefined) after.output.scale = args.outputScale;
    if (JSON.stringify(after) === JSON.stringify(before)) return fail("바뀌는 값이 없습니다");
    const snapshot = structuredClone(before);
    return ok({ ...applyEdit(ctx, new SetPhysicsRig(args.rig, after)), before: snapshot, after });
  },
};

interface BindingArgs {
  target: "part" | "deformer";
  id: string;
  parameter: string;
  channel: string;
  from?: number;
  to?: number;
  remove?: boolean;
}

const editBinding: Tool<BindingArgs> = {
  name: "edit_binding",
  description:
    "파트나 디포머의 바인딩 하나(parameter + channel)를 바꾸거나 추가하거나 지운다. 파라미터가 min→max로 갈 때 channel 값이 from→to로 선형 변한다. 없던 바인딩을 추가할 때는 from과 to가 모두 필요하다. 변경 기록에 남고 undo로 되돌릴 수 있다.",
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", enum: ["part", "deformer"] },
      id: { type: "string", description: "파트 또는 디포머 id" },
      parameter: { type: "string" },
      channel: {
        type: "string",
        enum: ["translateX", "translateY", "rotate", "scaleX", "scaleY", "opacity"],
        description: "디포머는 opacity를 쓸 수 없다",
      },
      from: { type: "number" },
      to: { type: "number" },
      remove: { type: "boolean" },
    },
    required: ["target", "id", "parameter", "channel"],
  },
  available: editable,
  run(args, ctx) {
    const model = ctx.session!.current;
    const owner = args.target === "part" ? model.parts.find((p) => p.id === args.id) : model.deformers?.find((d) => d.id === args.id);
    if (!owner) return fail(`없는 ${args.target === "part" ? "파트" : "디포머"}: ${args.id}`);
    if ((owner as { kind?: string }).kind === "warp") return fail("워프 디포머에는 바인딩이 없습니다");
    const bindings = structuredClone(((owner as { bindings?: IkiBinding[] }).bindings ?? []) as IkiBinding[]);
    const i = bindings.findIndex((b) => b.parameter === args.parameter && b.channel === args.channel);
    const before = i >= 0 ? { ...bindings[i] } : null;
    if (args.remove) {
      if (i < 0) return fail("지울 바인딩이 없습니다");
      bindings.splice(i, 1);
    } else if (i >= 0) {
      if (args.from === undefined && args.to === undefined) return fail("from 또는 to가 필요합니다");
      if (args.from !== undefined) bindings[i].from = args.from;
      if (args.to !== undefined) bindings[i].to = args.to;
    } else {
      if (args.from === undefined || args.to === undefined) return fail("새 바인딩에는 from과 to가 모두 필요합니다");
      bindings.push({ parameter: args.parameter, channel: args.channel as IkiBinding["channel"], from: args.from, to: args.to });
    }
    const after = args.remove ? null : bindings.find((b) => b.parameter === args.parameter && b.channel === args.channel)!;
    const cmd =
      args.target === "part" ? new SetPartBindings(args.id, bindings) : new SetDeformerBindings(args.id, bindings as IkiDeformerBinding[]);
    return ok({ ...applyEdit(ctx, cmd), before, after: after && { ...after } });
  },
};

const undo: Tool<Record<string, never>> = {
  name: "undo",
  description: "마지막 모델 변경을 되돌린다.",
  inputSchema: noArgs,
  available: (c) => editable(c),
  run(_args, ctx) {
    const s = ctx.session!;
    const last = s.changes.at(-1);
    if (!last) return fail("되돌릴 변경이 없습니다");
    s.undo();
    return ok({ undone: last, remaining: s.changes.length });
  },
};

const revertAll: Tool<Record<string, never>> = {
  name: "revert_all",
  description: "모든 변경을 버리고 원본 모델로 돌아간다.",
  inputSchema: noArgs,
  available: (c) => editable(c),
  run(_args, ctx) {
    const dropped = ctx.session!.changes.length;
    ctx.session!.revertAll();
    return ok({ dropped });
  },
};

// --- Registry ----------------------------------------------------------------------

const TOOLS: readonly Tool<never>[] = [
  listCapabilities,
  inspect,
  getParameters,
  captureFrame,
  simulate,
  listChanges,
  setParameter,
  setMotionMode,
  editPhysicsRig,
  editBinding,
  undo,
  revertAll,
] as unknown as Tool<never>[];

function availableTools(ctx: ToolContext): readonly Tool<never>[] {
  return TOOLS.filter((t) => t.available(ctx));
}

/** Tools usable right now, as plain JSON specs. */
export function listTools(ctx: ToolContext): ToolSpec[] {
  return availableTools(ctx).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/**
 * Call a tool by name. Never throws: unknown tools, unavailable tools, bad
 * arguments and rejected edits all come back as `{ ok: false, error }`, which
 * an agent can read and react to.
 */
export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`없는 도구: ${name}`);
  if (!tool.available(ctx)) return fail(`${name}은(는) 지금 쓸 수 없습니다 (런타임이나 모델 상태를 list_capabilities로 확인하세요)`);
  const input = args ?? {};
  const problems = validate(tool.inputSchema, input);
  if (problems.length) return fail(`잘못된 인자: ${problems.join("; ")}`);
  try {
    return await tool.run(input as never, ctx);
  } catch (err) {
    return fail((err as Error).message);
  }
}
