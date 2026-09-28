import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { validateDocument, validateDetail, validatePlan } from "./planValidation.mjs";

const active = new Set();
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const missing = (error) => error?.code === "ENOENT";

async function atomicJsonWrite(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally { await file.close(); }
  try {
    await rename(temporary, filename);
    const directory = await open(path.dirname(filename), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await unlink(temporary).catch((error) => { if (!missing(error)) throw error; });
  }
}

/** Local checkpoint adapter for the runnable example. The DB job store is separate. */
export class CheckpointStore {
  constructor(root, jobId) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(jobId)) throw new Error("Invalid job ID");
    this.directory = path.resolve(root, jobId);
  }

  async exclusive(operation) {
    if (active.has(this.directory)) throw new Error("Job is already running in this process");
    active.add(this.directory);
    try { return await operation(); }
    finally { active.delete(this.directory); }
  }

  async saveDocument(document) {
    validateDocument(document);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const filename = path.join(this.directory, "document.json");
    try {
      const saved = JSON.parse(await readFile(filename, "utf8"));
      if (hash(saved) !== hash(document)) throw new Error("Source changed for this job ID");
    } catch (error) {
      if (!missing(error)) throw error;
      await atomicJsonWrite(filename, document);
    }
  }

  async readDocument() {
    return validateDocument(JSON.parse(await readFile(path.join(this.directory, "document.json"), "utf8")));
  }

  async load(document) {
    let state;
    try { state = JSON.parse(await readFile(path.join(this.directory, "state.json"), "utf8")); }
    catch (error) { if (missing(error)) return null; throw error; }
    if (state?.sourceHash !== hash(document)) throw new Error("Checkpoint source changed");
    validatePlan(document, state.plan);
    if (!state.ready || typeof state.ready !== "object" || Array.isArray(state.ready)) {
      throw new Error("Invalid checkpoint results");
    }
    for (const [id, detail] of Object.entries(state.ready)) {
      const spec = state.plan.topics.find((topic) => topic.id === id);
      if (!spec) throw new Error("Checkpoint contains an unplanned topic");
      validateDetail(spec, detail);
    }
    return state;
  }

  async save(document, plan, ready) {
    validatePlan(document, plan);
    await atomicJsonWrite(path.join(this.directory, "state.json"), {
      sourceHash: hash(document), plan, ready,
    });
  }
}
