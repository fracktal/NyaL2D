// NyaL2D example runtime adapter (contract v1).
//
// A reference for adapter authors: it implements every contract function
// with a tiny Canvas 2D puppet, so the app's external-runtime path can be
// exercised end to end. It is not a real puppet renderer.
// Contract: docs/runtime/adapter-contract.md

export const nyal2dAdapter = 1;

export const meta = {
  name: "Example adapter",
  version: "1.0.0",
  accept: ".json",
  motionModes: ["idle"],
};

const PARAMS = [
  { id: "ParamAngleX", name: "Head Angle X", min: -30, max: 30, default: 0 },
  { id: "ParamAngleY", name: "Head Angle Y", min: -30, max: 30, default: 0 },
  { id: "ParamEyeLOpen", name: "Eye L", min: 0, max: 1, default: 1 },
  { id: "ParamEyeROpen", name: "Eye R", min: 0, max: 1, default: 1 },
  { id: "ParamMouthOpenY", name: "Mouth Open", min: 0, max: 1, default: 0 },
  { id: "ParamBreath", name: "Breath", min: 0, max: 1, default: 0 },
];

export async function create(canvas) {
  const ctx = canvas.getContext("2d");
  const values = new Map(PARAMS.map((p) => [p.id, p.default]));
  let name = "example";
  let mode = "off";
  let raf = 0;
  let t0 = performance.now();
  let color = "#f0a646";

  const draw = (now) => {
    if (mode === "idle") {
      const t = (now - t0) / 1000;
      values.set("ParamBreath", 0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / 3.5));
      const blink = t % 4 < 0.15 ? 0 : 1;
      values.set("ParamEyeLOpen", blink);
      values.set("ParamEyeROpen", blink);
    }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const v = (id) => values.get(id);
    const s = Math.min(w, h) / 500;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2 + 20 * s);
    // body
    const breath = v("ParamBreath") * 6 * s;
    ctx.fillStyle = "#3a3f4b";
    ctx.beginPath();
    ctx.ellipse(0, 170 * s - breath, 120 * s, 70 * s, 0, Math.PI, 0);
    ctx.fill();
    // head
    ctx.save();
    ctx.translate(v("ParamAngleX") * 2 * s, -v("ParamAngleY") * 1.5 * s - breath * 0.6);
    ctx.rotate((v("ParamAngleX") * Math.PI) / 900);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 110 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1b1d22";
    for (const [id, x] of [["ParamEyeROpen", -40], ["ParamEyeLOpen", 40]]) {
      ctx.beginPath();
      ctx.ellipse((x + v("ParamAngleX") * 0.8) * s, -15 * s, 11 * s, Math.max(1.5, 16 * v(id)) * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(v("ParamAngleX") * 0.8 * s, 45 * s, 26 * s, (3 + 22 * v("ParamMouthOpenY")) * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  return {
    async load(files) {
      // load([]) opens the adapter's built-in demo; a file may carry {"name","color"}.
      if (files.length) {
        const cfg = JSON.parse(await files[0].text());
        name = typeof cfg.name === "string" ? cfg.name : files[0].name;
        if (typeof cfg.color === "string") color = cfg.color;
      } else {
        name = "example puppet";
      }
      for (const p of PARAMS) values.set(p.id, p.default);
    },
    parameters: () => PARAMS.map((p) => ({ ...p })),
    getParameter: (id) => values.get(id) ?? 0,
    setParameter: (id, value) => {
      if (values.has(id)) values.set(id, value);
    },
    modelName: () => name,
    setMotionMode(m) {
      mode = m;
      t0 = performance.now();
    },
    drivenParameterIds: () => (mode === "idle" ? ["ParamBreath", "ParamEyeLOpen", "ParamEyeROpen"] : []),
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}
