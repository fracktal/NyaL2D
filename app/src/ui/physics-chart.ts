import type { IkiModel, IkiPhysics } from "@ikijs/format";
import { simulatePhysics } from "../runtime/simulate";

export interface StepResponse {
  t: number[];
  y: number[];
  /** Value the spring settles toward for this step. */
  target: number;
  rest: number;
  peak: number;
  /** Peak past the target, as a fraction of the step size. */
  overshoot: number;
  /** First time after which |y - target| stays within 5% of the step. */
  settleMs: number | null;
}

const DURATION_MS = 2500;

/**
 * Step the rig's input from its default to its maximum and record the output.
 * Runs the real Iki physics driver headlessly (see runtime/simulate.ts).
 */
export function stepResponse(model: IkiModel, rig: IkiPhysics): StepResponse {
  const input = model.parameters.find((p) => p.id === rig.input.parameter)!;
  const output = model.parameters.find((p) => p.id === rig.output.parameter)!;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const inRest = clamp(input.default, input.min, input.max);
  const rest = clamp(output.default, output.min, output.max);
  const samples = simulatePhysics(model, {
    durationMs: DURATION_MS,
    inputs: (t) => ({ [input.id]: t > 0 ? input.max : inRest }),
    record: [output.id],
  });
  const t = samples.map((s) => s.t);
  const y = samples.map((s) => s.values[output.id]);
  // Signed-normalized input at max is +1 (when max is the wider side) — read it
  // off the simulation's tail rather than re-deriving the engine's formula.
  const tail = y.slice(-20);
  const target = tail.reduce((a, b) => a + b, 0) / tail.length;
  const step = target - rest || 1e-9;
  const peak = y.reduce((m, v) => (Math.abs(v - rest) > Math.abs(m - rest) ? v : m), rest);
  const overshoot = Math.max(0, (peak - target) / step);
  let settleMs: number | null = null;
  for (let i = y.length - 1; i >= 0; i--) {
    if (Math.abs(y[i] - target) > Math.abs(step) * 0.05) {
      settleMs = i + 1 < t.length ? t[i + 1] : null;
      break;
    }
    if (i === 0) settleMs = 0;
  }
  return { t, y, target, rest, peak, overshoot, settleMs };
}

/** SVG line chart of a step response, with an optional "original" ghost. */
export function responseChart(cur: StepResponse, ghost?: StepResponse): SVGSVGElement {
  const W = 300;
  const H = 86;
  const pad = { l: 6, r: 6, t: 8, b: 14 };
  const all = [...cur.y, cur.rest, cur.target, ...(ghost?.y ?? [])];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-6) hi = lo + 1;
  const m = (hi - lo) * 0.08;
  lo -= m;
  hi += m;
  const tMax = cur.t.at(-1) || 1;
  const x = (t: number) => pad.l + (t / tMax) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = (r: StepResponse) => r.t.map((t, i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(r.y[i]).toFixed(1)}`).join("");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `계단 입력 응답: 최대 ${cur.peak.toFixed(2)}, 수렴값 ${cur.target.toFixed(2)}`);
  const ticks = [0, 500, 1000, 1500, 2000].filter((v) => v < tMax);
  svg.innerHTML = `
    ${ticks.map((v) => `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${pad.t}" y2="${H - pad.b}" opacity=".5"/><text x="${x(v) + 2}" y="${H - 3}">${v / 1000}s</text>`).join("")}
    <line class="target" x1="${pad.l}" x2="${W - pad.r}" y1="${y(cur.target)}" y2="${y(cur.target)}"/>
    ${ghost ? `<path class="ghost" d="${line(ghost)}"/>` : ""}
    <path class="area" d="${line(cur)}L${x(tMax)},${y(cur.rest)}L${x(0)},${y(cur.rest)}Z" opacity=".6"/>
    <path class="curve" d="${line(cur)}"/>`;
  return svg;
}
