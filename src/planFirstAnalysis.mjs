import { createPlanStreamScanner } from "./planStreamScanner.mjs";
import { validateDetail, validatePlan } from "./planValidation.mjs";

class CheckpointError extends Error {
  constructor(cause) { super("Checkpoint result is uncertain; reload before retrying", { cause }); }
}

/**
 * request receives {phase, pendingPlan, onChunk} and streams text into onChunk.
 * Its first response is {"plan":{...},"details":[...]}; a resumed response has
 * only {"details":[...]}. This is the small, provider-independent core.
 */
export async function runPlanFirstAnalysis({ document, store, request, onReady = () => {}, maxAttempts = 3 }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("Invalid attempt count");
  return store.exclusive(async () => {
    await store.saveDocument(document);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let state = await store.load(document);
      if (state && state.plan.topics.every((spec) => state.ready[spec.id])) break;
      const phase = state ? "resume" : "combined";
      const pendingPlan = state?.plan.topics.filter((spec) => !state.ready[spec.id]) ?? null;
      let writes = Promise.resolve();
      let writeError = null;
      const enqueue = (work) => {
        writes = writes.then(async () => {
          if (!writeError) await work();
        }).catch((error) => { writeError = error; });
      };
      const scanner = createPlanStreamScanner(phase === "combined",
        (rawPlan) => enqueue(async () => {
          const plan = validatePlan(document, rawPlan);
          try { await store.save(document, plan, {}); }
          catch (error) { throw new CheckpointError(error); }
          state = { plan, ready: {} };
        }),
        (rawDetail, index) => enqueue(async () => {
          if (!state) throw new Error("Detail arrived before the plan was saved");
          const spec = (pendingPlan ?? state.plan.topics)[index];
          if (!spec || state.ready[spec.id]) throw new Error("Unexpected or duplicate detail");
          const detail = validateDetail(spec, rawDetail);
          const nextReady = { ...state.ready, [spec.id]: detail };
          try { await store.save(document, state.plan, nextReady); }
          catch (error) { throw new CheckpointError(error); }
          state = { ...state, ready: nextReady };
          try { await onReady({ topicId: spec.id, detail, attempt }); }
          catch { /* A missed notification can be replayed from the checkpoint. */ }
        }));
      let requestError = null;
      try {
        await request({ phase, pendingPlan, attempt, onChunk: scanner.push });
        scanner.finish();
      } catch (error) { requestError = error; }
      await writes;
      if (writeError instanceof CheckpointError) throw writeError;
      if (writeError) requestError = writeError;
      const saved = await store.load(document);
      if (!requestError && saved?.plan.topics.every((spec) => saved.ready[spec.id])) break;
    }
    const saved = await store.load(document);
    return {
      status: saved?.plan.topics.every((spec) => saved.ready[spec.id]) ? "complete" : "partial",
      plan: saved?.plan ?? null,
      readyTopicIds: saved?.plan.topics.filter((spec) => saved.ready[spec.id]).map((spec) => spec.id) ?? [],
    };
  });
}

export async function resumePlanFirstAnalysis({ store, ...options }) {
  return runPlanFirstAnalysis({ ...options, store, document: await store.readDocument() });
}
