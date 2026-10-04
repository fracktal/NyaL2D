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
