/**
 * Page side of the character library (server/library.ts): the model and
 * layered-art files kept on this machine, listed so one can be picked and
 * opened instead of browsed for each time.
 */

export interface LibraryEntry {
  file: string;
  kind: "model" | "psd" | "image";
  size: number;
  modified: number;
}

const API = "./llm/library";

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  let detail = `HTTP ${res.status}`;
  try {
    detail = ((await res.json()) as { error?: string }).error ?? detail;
  } catch {
    // Not JSON: keep the status.
  }
  throw new Error(detail);
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  return (await (await check(await fetch(API))).json()) as LibraryEntry[];
}

/** Where a library file is served; also usable as `?open=`. */
export function libraryFileUrl(file: string): string {
  return `${API}/file?name=${encodeURIComponent(file)}`;
}

export async function loadLibraryFile(file: string): Promise<File> {
  const blob = await (await check(await fetch(libraryFileUrl(file)))).blob();
  return new File([blob], file);
}

export async function saveToLibrary(file: string, data: Blob): Promise<LibraryEntry> {
  return (await (await check(await fetch(libraryFileUrl(file), { method: "PUT", body: data }))).json()) as LibraryEntry;
}

export async function removeFromLibrary(file: string): Promise<void> {
  await check(await fetch(libraryFileUrl(file), { method: "DELETE" }));
}

/** File types the library keeps. */
export function isLibraryFile(name: string): boolean {
  return /\.(iki|json|psd|png|webp)$/i.test(name);
}
