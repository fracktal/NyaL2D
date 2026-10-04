// Browser smoke test / experiment harness.
// Run via `npm run smoke` (builds first). Serves dist/ with
// `vite preview`, opens it in headless Chromium, and records observations
// that docs/iki/*.md cite as "Observed".
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 4179;
const OUT = process.env.SMOKE_OUT ?? "smoke-out";
mkdirSync(OUT, { recursive: true });

const env = { ...process.env, NYAL2D_LLM_PROVIDER: "mock" };
// The agent panel is exercised against the scripted (mock) LLM provider.
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "ignore", "inherit"],
  env,
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {}
  if (i > 100) throw new Error("preview server did not start");
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleLines = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));

const results = {};
try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.evaluate(() => window.nyal2d.ready);
  await page.waitForTimeout(500);

  // Capture through the app's own path and count non-transparent pixels.
  const frameStats = () =>
    page.evaluate(async () => {
      const blob = await window.nyal2d.runtime.captureFrame();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      let opaque = 0;
      let hash = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) opaque++;
        hash = (hash * 31 + data[i - 3] + data[i - 2] * 7 + data[i]) >>> 0;
      }
      return { width: bmp.width, height: bmp.height, opaque, hash, bytes: blob.size };
    });

  results.webgl2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
  results.snapshot = await page.evaluate(() => {
    const s = window.nyal2d.inspect();
    return { name: s.name, parameters: s.parameters.length, parts: s.parts.length, deformers: s.deformers.length, physics: s.physics.length };
  });
  results.drivenParameterIds = await page.evaluate(() => [...window.nyal2d.runtime.drivenParameterIds]);
  results.firstFrame = await frameStats();
  // Control: read the canvas from a timer instead of a rAF callback.
  results.captureOutsideRaf = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 50));
    const url = document.getElementById("canvas").toDataURL("image/png");
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    return { opaque };
  });
  await page.screenshot({ path: `${OUT}/01-loaded.png` });

  // Freeze motion so parameter experiments are deterministic.
  await page.evaluate(() => window.nyal2d.runtime.setMotionMode("off"));
  await page.waitForTimeout(100);
  results.restFrame = await frameStats();
  await page.evaluate(() => window.nyal2d.runtime.setParameter("ParamAngleX", 30));
  await page.waitForTimeout(100);
  results.angleX30Frame = await frameStats();
  await page.screenshot({ path: `${OUT}/02-angleX30.png` });
  await page.evaluate(() => window.nyal2d.runtime.setParameter("ParamAngleX", 0));

  // Idle motion: frames should differ over time.
  await page.evaluate(() => window.nyal2d.runtime.setMotionMode("idle"));
  const hashes = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(400);
    hashes.push((await frameStats()).hash);
  }
  results.idleFrameHashesDistinct = new Set(hashes).size;

  // Physics trajectory: step AngleX and sample the physics output over time.
  await page.evaluate(() => window.nyal2d.runtime.setMotionMode("off"));
  // In "physics" mode nothing else writes ParamAngleX, so the input is a clean step.
  const trajectory = async () =>
    page.evaluate(async () => {
      const rt = window.nyal2d.runtime;
      rt.setMotionMode("off");
      rt.setParameter("ParamAngleX", 0);
      rt.setParameter("ParamHairSwayX", 0);
      rt.setMotionMode("physics");
      await new Promise((r) => setTimeout(r, 300));
      rt.setParameter("ParamAngleX", 30);
      const samples = [];
      const t0 = performance.now();
      await new Promise((resolve) => {
        const step = () => {
          const t = performance.now() - t0;
          samples.push([Math.round(t), +rt.getParameter("ParamHairSwayX").toFixed(3)]);
          if (t < 2000) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      rt.setMotionMode("off");
      return samples.filter((_, i) => i % 6 === 0);
    });
  results.hairSwayStepResponse = await trajectory();

  // Reversible change through the UI: edit hairSway stiffness in the inspector.
  const stiffness = page.locator('input[aria-label="hairSway stiffness"]');
  await stiffness.fill("120");
  await stiffness.press("Tab");
  await page.waitForTimeout(300);
  results.afterEdit = await page.evaluate(() => {
    const s = window.nyal2d.session();
    return {
      changes: s.changes,
      currentStiffness: s.current.physics.find((r) => r.id === "hairSway").stiffness,
      originalStiffness: s.original.physics.find((r) => r.id === "hairSway").stiffness,
      runtimeStiffness: window.nyal2d.runtime.loadedModel.physics.find((r) => r.id === "hairSway").stiffness,
    };
  });
  results.hairSwayStepResponseStiff = await trajectory();
  await page.screenshot({ path: `${OUT}/03-after-edit.png` });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/04-after-edit-dark.png` });
  await page.emulateMedia({ colorScheme: "light" });
  await page.click("#undo");
  await page.waitForTimeout(300);
  results.afterUndo = await page.evaluate(() => ({
    changes: window.nyal2d.session().changes.length,
    runtimeStiffness: window.nyal2d.runtime.loadedModel.physics.find((r) => r.id === "hairSway").stiffness,
  }));

  // Agent tool layer, driven from the page like a future agent loop would.
  results.tools = await page.evaluate(async () => {
    const t = window.nyal2d.tools;
    const names = t.list().map((x) => x.name);
    const caps = await t.call("list_capabilities");
    const sim = await t.call("simulate_physics", { input: "ParamAngleX", to: 30, record: ["ParamHairSwayX"] });
    const edit = await t.call("edit_binding", { target: "deformer", id: "bodyDeformer", parameter: "ParamBreath", channel: "translateY", to: 2.3 });
    const mode = await t.call("set_motion_mode", { mode: "physics" });
    const shot = await t.call("capture_frame", { pose: { ParamAngleX: 20 } });
    const changes = await t.call("list_changes");
    const undo = await t.call("undo");
    const bad = await t.call("set_parameter", { id: "ParamAngleX" });
    return {
      names,
      runtime: caps.data.runtime.kind,
      peak: sim.data.outputs.ParamHairSwayX.peak,
      edited: edit.ok && edit.data.after.to,
      timelineSource: document.querySelector("#changes .node.latest .src")?.textContent,
      modeButton: document.querySelector('#motion-mode button[aria-pressed="true"]')?.dataset.mode,
      captureBytes: shot.ok ? shot.image.size : 0,
      changes: changes.data.applied.map((c) => `${c.label}·${c.source}`),
      undo: undo.ok,
      badArgs: bad.ok ? null : bad.error,
    };
  });
  await page.evaluate(() => window.nyal2d.tools.call("set_motion_mode", { mode: "idle" }));

  // Agent panel, driven through the UI against the mock provider.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.click('#panel-switch button[data-view="agent"]');
  await page.waitForSelector(".agent-status.mock");
  await page.click('.chip:has-text("숨 쉬는")');
  await page.waitForFunction(() => document.querySelectorAll(".step.ok").length >= 5 && !document.querySelector(".thinking"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/04b-agent-dark.png` });
  results.agent = await page.evaluate(() => ({
    status: document.querySelector(".agent-status")?.textContent,
    steps: [...document.querySelectorAll(".step")].map((s) => `${s.querySelector(".phase")?.textContent}:${s.classList.contains("ok") ? "ok" : "fail"}:${s.querySelector(".step-title")?.lastChild?.textContent}`),
    replies: [...document.querySelectorAll(".msg.assistant")].length,
    changes: window.nyal2d.session().changes.map((c) => `${c.label}·${c.source}`),
    timelineTags: [...document.querySelectorAll("#changes .src.agent")].map((n) => n.textContent),
  }));
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/04c-agent-light.png` });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => window.nyal2d.session().revertAll());
  await page.click('#panel-switch button[data-view="inspector"]');

  // Inspector tabs and the error state, for visual review.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.click('.tab:has-text("디포머")');
  await page.click('.tree-row:has-text("headDeformer")');
  await page.locator("#file-input").setInputFiles({ name: "broken.iki", mimeType: "application/json", buffer: Buffer.from('{"version":1,"name":"x","canvas":{"width":0,"height":10},"parameters":[],"parts":[]}') });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05-deformers-error-dark.png` });
  results.errorOverlay = await page.locator(".error-detail").textContent();

  // Runtime selection: the Ayagami slot with no URL uses the empty wrapper.
  await page.click('button[aria-label="이전 모델로 돌아가기"], .overlay-card button:has-text("돌아가기")').catch(() => {});
  await page.click("#settings");
  await page.click('.rt-card:has-text("Ayagami")');
  await page.click('.rt-card.selected button:has-text("연결 확인")');
  await page.waitForSelector(".rt-status.warn");
  results.wrapperStatus = await page.locator(".rt-card.selected .rt-status").textContent();
  await page.click('.modal button:has-text("적용")');
  await page.waitForSelector(".stage-overlay.unconnected");
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/06a-ayagami-unconnected-dark.png` });
  results.unconnected = await page.evaluate(() => ({
    kind: window.nyal2d.runtime?.kind,
    connected: window.nyal2d.runtime?.connected,
    title: document.querySelector("#overlay-card h3")?.textContent,
    badge: document.getElementById("runtime-badge").textContent,
    sampleDisabled: document.getElementById("load-sample").disabled,
    openDisabled: document.getElementById("file-input").disabled,
  }));

  // Then the same slot backed by the example adapter.
  await page.click("#settings");
  await page.click('.rt-card:has-text("Ayagami")');
  await page.click('button:has-text("예제 어댑터로 시험")');
  await page.waitForSelector(".rt-status.ok");
  results.adapterStatus = await page.locator(".rt-status").textContent();
  await page.screenshot({ path: `${OUT}/06-settings-dark.png` });
  await page.click('.modal button:has-text("적용")');
  await page.waitForFunction(() => window.nyal2d.runtime?.kind === "ayagami" && window.nyal2d.runtime.getParameters().length > 0);
  await page.waitForTimeout(400);
  results.external = await page.evaluate(async () => {
    const rt = window.nyal2d.runtime;
    rt.setParameter("ParamAngleX", 25);
    rt.setParameter("ParamMouthOpenY", 0.8);
    const blob = await rt.captureFrame();
    return {
      kind: rt.kind,
      label: rt.label,
      capabilities: rt.capabilities,
      parameters: rt.getParameters().map((p) => p.id),
      angleX: rt.getParameter("ParamAngleX"),
      clampedTo: (rt.setParameter("ParamAngleX", 999), rt.getParameter("ParamAngleX")),
      captureBytes: blob.size,
      exportDisabled: document.getElementById("export").disabled,
      motionButtons: [...document.querySelectorAll("#motion-mode button")].map((b) => [b.dataset.mode, b.disabled]),
    };
  });
  await page.evaluate(() => window.nyal2d.runtime.setParameter("ParamAngleX", 25));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/07-external-runtime-dark.png` });

  // And back to Iki.
  await page.click("#settings");
  await page.click('.rt-card:has-text("Iki")');
  await page.click('.modal button:has-text("적용")');
  await page.waitForFunction(() => window.nyal2d.runtime?.kind === "iki" && !!window.nyal2d.session());
  results.backToIki = await page.evaluate(() => ({ kind: window.nyal2d.runtime.kind, parts: window.nyal2d.inspect().parts.length }));

  results.console = consoleLines;
} finally {
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
  server.kill();
}
