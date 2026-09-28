/** HTTP admission and LLM execution are intentionally separate entry points. */
export async function acceptAnalysis({ id, userId, inputReference, jobs }) {
  // inputReference points at bytes already saved in durable object storage.
  const job = await jobs.create({ id, userId, input: inputReference });
  return { httpStatus: 202, jobId: job.id, status: job.status };
}

export async function readAnalysis({ id, userId, jobs }) {
  const job = await jobs.getForUser(id, userId);
  if (!job) return { httpStatus: 404 };
  return {
    httpStatus: 200,
    jobId: job.id,
    status: job.status,
    ...(job.status === "done" ? { result: job.result_json } : {}),
    ...(job.status === "failed" ? { error: job.error } : {}),
  };
}

export async function runNextAnalysis({ jobs, loadInput, analyze }) {
  const job = await jobs.claimNext();
  if (!job) return false;
  try {
    const input = await loadInput(job.input_json);
    const result = await analyze(input, job.id);
    return jobs.complete(job.id, job.claim_token, result);
  } catch (error) {
    await jobs.fail(job.id, job.claim_token, error instanceof Error ? error.message : String(error));
    return false;
  }
}
