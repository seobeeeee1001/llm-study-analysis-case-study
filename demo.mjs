import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CheckpointStore } from "./src/checkpointStore.mjs";
import { runPlanFirstAnalysis, resumePlanFirstAnalysis } from "./src/planFirstAnalysis.mjs";

const root = await mkdtemp(path.join(tmpdir(), "study-analysis-demo-"));
const store = new CheckpointStore(root, "demo-job");
const document = { blocks: [
  { id: "b-1", text: "세포는 생명의 기본 단위다." },
  { id: "b-2", text: "세포막은 물질 출입을 조절한다." },
] };
const plan = { topics: [
  { id: "t-1", title: "세포", blockIds: ["b-1"] },
  { id: "t-2", title: "세포막", blockIds: ["b-2"] },
] };
const detail = (id, title, text, blockId) => ({ topic: {
  id, title, points: [{ id: `p-${id}`, text, evidenceBlockId: blockId }],
} });
try {
  const first = await runPlanFirstAnalysis({ document, store, maxAttempts: 1,
    request: async ({ onChunk }) => {
      onChunk(`{"plan":${JSON.stringify(plan)},"details":[${JSON.stringify(detail("t-1", "세포", "생명의 기본 단위", "b-1"))},{`);
      throw new Error("stream disconnected");
    },
    onReady: ({ topicId }) => console.log("첫 학습 주제 준비:", topicId),
  });
  console.log("연결 종료 후:", first.status, first.readyTopicIds);
  const resumed = await resumePlanFirstAnalysis({ store,
    request: async ({ phase, pendingPlan, onChunk }) => {
      console.log("재시도 대상:", phase, pendingPlan.map((topic) => topic.id));
      onChunk(JSON.stringify({ details: [detail("t-2", "세포막", "물질 출입 조절", "b-2")] }));
    },
    onReady: ({ topicId }) => console.log("다음 학습 주제 준비:", topicId),
  });
  console.log("복구 후:", resumed.status, resumed.readyTopicIds);
} finally {
  await rm(root, { recursive: true, force: true });
}
