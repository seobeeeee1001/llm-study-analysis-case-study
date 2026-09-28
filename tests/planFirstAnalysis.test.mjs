import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CheckpointStore } from "../src/checkpointStore.mjs";
import { runPlanFirstAnalysis, resumePlanFirstAnalysis } from "../src/planFirstAnalysis.mjs";
import { createPlanStreamScanner } from "../src/planStreamScanner.mjs";

const document = { blocks: [
  { id: "b-1", text: "프로세스는 실행 중인 프로그램이다." },
  { id: "b-2", text: "스케줄러는 CPU 실행 순서를 정한다." },
] };
const plan = { topics: [
  { id: "t-1", title: "프로세스", blockIds: ["b-1"] },
  { id: "t-2", title: "스케줄링", blockIds: ["b-2"] },
] };
const details = [
  { topic: { id: "t-1", title: "프로세스", points: [
    { id: "p-1", text: "실행 중인 프로그램", evidenceBlockId: "b-1" },
  ] } },
  { topic: { id: "t-2", title: "스케줄링", points: [
    { id: "p-2", text: "CPU 실행 순서 결정", evidenceBlockId: "b-2" },
  ] } },
];
const combined = () => JSON.stringify({ plan, details });
const temporaryStore = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "case-study-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new CheckpointStore(root, "sample-job");
};

test("arbitrary chunk boundaries preserve plan and topic objects", () => {
  const found = [];
  const scanner = createPlanStreamScanner(true,
    (value) => found.push(value), (value) => found.push(value));
  for (const character of combined()) scanner.push(character);
  scanner.finish();
  assert.deepEqual(found, [plan, ...details]);
  const truncated = createPlanStreamScanner(true, () => {}, () => {});
  truncated.push(combined().slice(0, -1));
  assert.throws(() => truncated.finish());
});

test("a complete topic is saved and announced before the response ends", async (t) => {
  const store = await temporaryStore(t);
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  let responseEnded = false;
  const result = await runPlanFirstAnalysis({ document, store,
    request: async ({ onChunk }) => {
      onChunk(`{"plan":${JSON.stringify(plan)},"details":[${JSON.stringify(details[0])}`);
      await ready;
      onChunk(`,${JSON.stringify(details[1])}]}`);
      responseEnded = true;
    },
    onReady: async ({ topicId }) => {
      const saved = JSON.parse(await readFile(path.join(store.directory, "state.json"), "utf8"));
      assert.deepEqual(saved.ready[topicId], details[topicId === "t-1" ? 0 : 1]);
      if (topicId === "t-1") {
        assert.equal(responseEnded, false);
        release();
      }
    },
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.readyTopicIds, ["t-1", "t-2"]);
});

test("after a broken stream, resume keeps the plan and first topic", async (t) => {
  const store = await temporaryStore(t);
  const first = await runPlanFirstAnalysis({ document, store, maxAttempts: 1,
    request: async ({ onChunk }) => {
      onChunk(`{"plan":${JSON.stringify(plan)},"details":[${JSON.stringify(details[0])},{"topic":`);
      throw new Error("LLM connection dropped");
    },
  });
  assert.equal(first.status, "partial");
  assert.deepEqual(first.readyTopicIds, ["t-1"]);
  const before = await store.load(document);
  const second = await resumePlanFirstAnalysis({ store,
    request: async ({ phase, pendingPlan, onChunk }) => {
      assert.equal(phase, "resume");
      assert.deepEqual(pendingPlan.map((topic) => topic.id), ["t-2"]);
      onChunk(JSON.stringify({ details: [details[1]] }));
    },
  });
  const after = await store.load(document);
  assert.equal(second.status, "complete");
  assert.deepEqual(after.plan, before.plan);
  assert.deepEqual(after.ready["t-1"], before.ready["t-1"]);
});

test("invalid coverage is rejected before any topic can be published", async (t) => {
  const store = await temporaryStore(t);
  const invalid = { topics: [{ id: "t-1", title: "프로세스", blockIds: ["b-1"] }] };
  let published = 0;
  const result = await runPlanFirstAnalysis({ document, store, maxAttempts: 1,
    request: async ({ onChunk }) => onChunk(JSON.stringify({ plan: invalid, details: [details[0]] })),
    onReady: () => { published++; },
  });
  assert.equal(result.status, "partial");
  assert.equal(result.plan, null);
  assert.equal(published, 0);
});

test("a changed topic ID or out-of-range evidence cannot overwrite saved work", async (t) => {
  const store = await temporaryStore(t);
  const bad = structuredClone(details[1]);
  bad.topic.points[0].evidenceBlockId = "b-1";
  const first = await runPlanFirstAnalysis({ document, store, maxAttempts: 1,
    request: async ({ onChunk }) => onChunk(JSON.stringify({ plan, details: [details[0], bad] })),
  });
  assert.deepEqual(first.readyTopicIds, ["t-1"]);
  const second = await resumePlanFirstAnalysis({ store, maxAttempts: 1,
    request: async ({ onChunk }) => onChunk(JSON.stringify({ details: [details[1]] })),
  });
  assert.equal(second.status, "complete");
});
