/**
 * The character library: model and layered-art files (.iki, .psd, layer
 * images) kept in one folder on this machine, so the page can list them and
 * open one by picking it instead of browsing for the file each time.
 *
 * The folder defaults to `app/public/local/`, which git ignores: third-party
 * art people try the app with stays on their machine.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_LIBRARY_DIR = fileURLToPath(new URL("../public/local", import.meta.url));

const KINDS: Record<string, LibraryEntry["kind"]> = { ".iki": "model", ".json": "model", ".psd": "psd", ".png": "image", ".webp": "image" };

export interface LibraryEntry {
  file: string;
  kind: "model" | "psd" | "image";
  size: number;
  /** Last modified, ms since epoch. */
  modified: number;
}

export interface Library {
  readonly dir: string;
  list(): LibraryEntry[];
  read(file: string): Buffer;
  save(file: string, data: Buffer): LibraryEntry;
  remove(file: string): void;
}

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A plain file name in the library with a known extension, or a LibraryError. */
export function libraryFileName(name: string | null | undefined): string {
  const file = (name ?? "").trim();
  if (!file || file !== basename(file) || file.includes("\\") || file.startsWith(".")) throw new LibraryError(`쓸 수 없는 파일 이름: ${file || "(없음)"}`, 400);
  if (!KINDS[extname(file).toLowerCase()]) throw new LibraryError(`라이브러리에 넣을 수 없는 형식: ${file} (.iki, .psd, .png, .webp)`, 400);
  return file;
}

export function createLibrary(dir: string = DEFAULT_LIBRARY_DIR): Library {
  const entry = (file: string): LibraryEntry => {
    const s = statSync(join(dir, file));
    return { file, kind: KINDS[extname(file).toLowerCase()], size: s.size, modified: s.mtimeMs };
  };
  return {
    dir,
    list() {
      let files: string[];
      try {
        files = readdirSync(dir);
      } catch {
        return [];
      }
      return files
        .filter((f) => !f.startsWith(".") && KINDS[extname(f).toLowerCase()])
        .map(entry)
        .sort((a, b) => b.modified - a.modified);
    },
    read(file) {
      try {
        return readFileSync(join(dir, libraryFileName(file)));
      } catch (err) {
        if (err instanceof LibraryError) throw err;
        throw new LibraryError(`라이브러리에 없는 파일: ${file}`, 404);
      }
    },
    save(file, data) {
      const name = libraryFileName(file);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), data);
      return entry(name);
    },
    remove(file) {
      rmSync(join(dir, libraryFileName(file)), { force: true });
    },
  };
}
