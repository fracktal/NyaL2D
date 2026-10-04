// Stands in for the `claude` CLI in tests: prints a scripted stream-json run.
const mode = process.env.FAKE_CLAUDE_MODE ?? "ok";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
out({ type: "system", subtype: "init", mcp_servers: [{ name: "nyal2d", status: mode === "mcp-failed" ? "failed" : "connected" }] });
out({ type: "assistant", message: { content: [{ type: "text", text: "살펴볼게요." }, { type: "tool_use", id: "t1", name: "mcp__nyal2d__inspect_model", input: {} }] } });
if (mode === "crash") {
  process.stderr.write("boom\n");
  process.exit(3);
}
if (mode === "hang") setInterval(() => {}, 1000);
else if (mode === "error") out({ type: "result", subtype: "error_max_turns", is_error: true, session_id: "s-err" });
else {
  // A line split across two writes must still parse.
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "끝났어요." }] } }) + "\n";
  process.stdout.write(line.slice(0, 10));
  setTimeout(() => {
    process.stdout.write(line.slice(10));
    out({ type: "result", subtype: "success", is_error: false, session_id: "s-123", result: "끝났어요." });
  }, 20);
}
