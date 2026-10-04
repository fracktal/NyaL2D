import { EditorDocument, type EditCommand } from "@ikijs/editor";
import type { IkiModel } from "@ikijs/format";

export interface ChangeEntry {
  /** 1-based sequence number, stable for the life of the session. */
  seq: number;
  label: string;
  /** Who asked for the change (the UI today, an agent later). */
  source: string;
}

type Listener = (session: ModelSession) => void;

/**
 * Original model + an ordered stack of reversible changes on top of it.
 *
 * The original is deep-cloned and frozen at construction and is never
 * mutated; every change goes through an `@ikijs/editor` {@link EditCommand},
 * which validates before mutating and can be inverted. Iki's
 * `EditorDocument` owns the undo/redo mechanics; this class only adds the
 * pieces it does not expose: an inspectable change list, change provenance,
 * a "revert to original", and change notifications for the runtime to
 * reload from.
 */
export class ModelSession {
  readonly original: Readonly<IkiModel>;
  private doc: EditorDocument;
  private applied: ChangeEntry[] = [];
  private undone: { entry: ChangeEntry; cmd: EditCommand }[] = [];
  private commands: EditCommand[] = [];
  private nextSeq = 1;
  private listeners = new Set<Listener>();

  constructor(original: IkiModel) {
    this.original = deepFreeze(structuredClone(original));
    this.doc = new EditorDocument(structuredClone(original));
  }

  /** Live working model. Read-only: mutate through {@link apply}. */
  get current(): IkiModel {
    return this.doc.getModel();
  }

  get changes(): readonly ChangeEntry[] {
    return this.applied;
  }

  get canUndo(): boolean {
    return this.applied.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Apply a command. Throws (leaving the model untouched) if it is invalid. */
  apply(cmd: EditCommand, source = "user"): ChangeEntry {
    this.doc.execute(cmd);
    const entry = { seq: this.nextSeq++, label: cmd.label, source };
    this.applied.push(entry);
    this.commands.push(cmd);
    this.undone = [];
    this.emit();
    return entry;
  }

  undo(): void {
    const entry = this.applied.pop();
    const cmd = this.commands.pop();
    if (!entry || !cmd) return;
    this.doc.undo();
    this.undone.push({ entry, cmd });
    this.emit();
  }

  redo(): void {
    const next = this.undone.pop();
    if (!next) return;
    this.doc.redo();
    this.applied.push(next.entry);
    this.commands.push(next.cmd);
    this.emit();
  }

  /** Drop every change and return to the original model. */
  revertAll(): void {
    this.doc = new EditorDocument(structuredClone(this.original) as IkiModel);
    this.applied = [];
    this.commands = [];
    this.undone = [];
    this.emit();
  }

  /** Validated `.iki` JSON of the current model. */
  serialize(): string {
    return this.doc.serialize();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l(this);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
