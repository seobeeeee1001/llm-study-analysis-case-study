import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptAnalysis, readAnalysis, runNextAnalysis } from "../src/jobService.mjs";

class FakeJobs {
  jobs = new Map();
  sequence = 0;
  async create({ id, userId, input }) {
    if (!this.jobs.has(id)) this.jobs.set(id, { id, user_id: userId, status: "queued", input_json: input });
    return this.jobs.get(id);
  }
  async getForUser(id, userId) {
    const job = this.jobs.get(id);
    return job?.user_id === userId ? job : null;
  }
  async claimNext() {
    const job = [...this.jobs.values()].find((item) => item.status === "queued");
    if (!job) return null;
    job.status = "running";
    job.claim_token = `claim-${++this.sequence}`;
    return { ...job };
  }
  async complete(id, token, result) {
    const job = this.jobs.get(id);
    if (job.status !== "running" || job.claim_token !== token) return false;
    job.status = "done";
    job.result_json = result;
    return true;
  }
  async fail(id, token, error) {
    const job = this.jobs.get(id);
    if (job.status !== "running" || job.claim_token !== token) return false;
    job.status = "failed";
    job.error = error;
    return true;
  }
  recoverInterrupted() {
    for (const job of this.jobs.values()) if (job.status === "running") {
      job.status = "queued";
      job.claim_token = null;
    }
  }
}

test("the client can reconnect with the job ID, and an old claim cannot commit", async () => {
  const jobs = new FakeJobs();
  const accepted = await acceptAnalysis({ id: "job-1", userId: "user-1",
    inputReference: { objectKey: "uploads/job-1" }, jobs });
  assert.equal(accepted.httpStatus, 202);
  assert.equal((await readAnalysis({ id: "job-1", userId: "user-1", jobs })).status, "queued");
  assert.equal((await readAnalysis({ id: "job-1", userId: "other-user", jobs })).httpStatus, 404);
  const interrupted = await jobs.claimNext();
  jobs.recoverInterrupted();
  const completed = await runNextAnalysis({ jobs,
    loadInput: async (reference) => reference,
    analyze: async () => ({ topics: ["프로세스"] }),
  });
  assert.equal(completed, true);
  assert.equal(await jobs.complete(interrupted.id, interrupted.claim_token, { topics: [] }), false);
  assert.deepEqual((await readAnalysis({ id: "job-1", userId: "user-1", jobs })).result,
    { topics: ["프로세스"] });
});
