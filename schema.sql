-- Small schema excerpt for the job lifecycle shown in this repository.
-- The uploaded bytes live in durable object storage; input_json records their keys.
CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  input_json JSONB NOT NULL,
  result_json JSONB,
  error TEXT,
  claim_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX analysis_jobs_queue_idx
  ON analysis_jobs (created_at, id) WHERE status = 'queued';

CREATE INDEX analysis_jobs_user_idx ON analysis_jobs (user_id, created_at DESC);
