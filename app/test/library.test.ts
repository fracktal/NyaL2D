import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLibrary, libraryFileName, LibraryError } from "../server/library.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nyal2d-lib-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("character library", () => {
  it("lists model and art files newest first, ignoring others", async () => {
    const lib = createLibrary(dir);
    lib.save("a.psd", Buffer.from("psd"));
    await new Promise((r) => setTimeout(r, 20));
    lib.save("b.iki", Buffer.from("{}"));
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, ".hidden.iki"), "x");
    expect(lib.list().map((e) => [e.file, e.kind, e.size])).toEqual([
      ["b.iki", "model", 2],
      ["a.psd", "psd", 3],
    ]);
  });

  it("reads back, replaces and removes a file", () => {
    const lib = createLibrary(dir);
    lib.save("c.png", Buffer.from("one"));
    lib.save("c.png", Buffer.from("two"));
    expect(lib.read("c.png").toString()).toBe("two");
    lib.remove("c.png");
    expect(lib.list()).toEqual([]);
    expect(() => lib.read("c.png")).toThrow(LibraryError);
  });

  it("lists nothing when the folder does not exist yet", () => {
    expect(createLibrary(join(dir, "missing")).list()).toEqual([]);
  });

  it.each(["../x.iki", "a/b.iki", "a\\b.iki", ".env", "x.txt", "", "x.exe"])("refuses the name %j", (name) => {
    expect(() => libraryFileName(name)).toThrow(LibraryError);
  });

  it("accepts plain names with a known extension, any language", () => {
    expect(libraryFileName("ずんだもん 立ち絵.PSD")).toBe("ずんだもん 立ち絵.PSD");
  });
});
