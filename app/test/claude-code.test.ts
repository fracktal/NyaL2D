import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../src/agent/protocol";
import { runClaude } from "../server/providers/claude-code";

const fake = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

async function run(mode: string, abortAfterMs?: number): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  const abort = new AbortController();
  process.env.FAKE_CLAUDE_MODE = mode;
  if (abortAfterMs !== undefined) setTimeout(() => abort.abort(), abortAfterMs);
  await runClaude(process.execPath, [fake], process.cwd(), abort.signal, (e) => events.push(e), "fallback-id");
  return events;
}

describe("runClaude stream-json parsing", () => {
  it("streams text blocks and ends with the CLI's session id", async () => {
    expect(await run("ok")).toEqual([
      { type: "text", text: "살펴볼게요." },
      { type: "text", text: "끝났어요." },
      { type: "done", sessionId: "s-123" },
    ]);
  });

  it("reports a tool server that did not connect", async () => {
    const events = await run("mcp-failed");
    expect(events[0]).toEqual({ type: "text", text: "(NyaL2D 도구 서버 상태: failed)" });
  });

  it("turns an unsuccessful result into an error", async () => {
    const events = await run("error");
    expect(events.at(-1)).toMatchObject({ type: "error", error: expect.stringContaining("error_max_turns") });
  });

  it("includes stderr when the CLI exits abnormally", async () => {
    const events = await run("crash");
    expect(events.at(-1)).toMatchObject({ type: "error", error: expect.stringMatching(/코드 3.*boom/) });
  });

  it("stops the CLI when aborted", async () => {
    const events = await run("hang", 300);
    expect(events.at(-1)).toEqual({ type: "done", sessionId: "fallback-id", note: "중단했습니다." });
  });

  it("emits exactly one terminal event", async () => {
    const events = await run("ok");
    expect(events.filter((e) => e.type !== "text")).toHaveLength(1);
  });
});

describe("finding the Claude Code CLI", () => {
  it("finds it in ~/.local/bin when PATH lacks it, and skips Windows folders under WSL", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { findClaude } = await import("../server/providers/claude-code");
    const home = mkdtempSync(join(tmpdir(), "nyal2d-home-"));
    const win = join(home, "mnt-like");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const exe = join(home, ".local", "bin", "claude");
    writeFileSync(exe, "#!/bin/sh\n");
    chmodSync(exe, 0o755);
    expect(findClaude({ PATH: `/mnt/c/Users/x/AppData/Roaming/npm:${win}` }, home)).toBe(exe);
  });

  it("finds an nvm-installed CLI", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { findClaude } = await import("../server/providers/claude-code");
    const home = mkdtempSync(join(tmpdir(), "nyal2d-home-"));
    const bin = join(home, ".nvm", "versions", "node", "v22.23.3", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
    chmodSync(join(bin, "claude"), 0o755);
    expect(findClaude({ PATH: "" }, home)).toBe(join(bin, "claude"));
  });
});

describe("finding the Claude Code CLI through asdf", () => {
  it("uses the asdf shim when PATH lacks it", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { findClaude } = await import("../server/providers/claude-code");
    const home = mkdtempSync(join(tmpdir(), "nyal2d-home-"));
    const shims = join(home, ".asdf", "shims");
    mkdirSync(shims, { recursive: true });
    writeFileSync(join(shims, "claude"), "#!/bin/sh\n");
    chmodSync(join(shims, "claude"), 0o755);
    expect(findClaude({ PATH: "/usr/bin" }, home)).toBe(join(shims, "claude"));
  });
});
