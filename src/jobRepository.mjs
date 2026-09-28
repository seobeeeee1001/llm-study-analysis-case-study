import { randomUUID } from "node:crypto";

/**
 * PostgreSQL job ledger. db.query(sql, params) is injected so this excerpt does
 * not require a framework or a particular connection-pool package.
 */
export class JobRepository {
  constructor(db) { this.db = db; }

  async create({ id, userId, input }) {
    const result = await this.db.query(`
      INSERT INTO analysis_jobs (id, user_id, status, input_json)
      VALUES ($1, $2, 'queued', $3::jsonb)
      ON CONFLICT (id) DO NOTHING
      RETURNING id, user_id, status`, [id, userId, JSON.stringify(input)]);
    if (result.rows[0]) return result.rows[0];
    const existing = await this.getForUser(id, userId);
    if (!existing) throw new Error("Job ID belongs to another user");
    return existing;
  }

  async getForUser(id, userId) {
    const result = await this.db.query(`
      SELECT id, user_id, status, input_json, result_json, error,
             created_at, started_at, finished_at
      FROM analysis_jobs WHERE id = $1 AND user_id = $2`, [id, userId]);
    return result.rows[0] ?? null;
  }

  async claimNext() {
    const token = randomUUID();
    const result = await this.db.query(`
      WITH next_job AS (
        SELECT id FROM analysis_jobs WHERE status = 'queued'
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE analysis_jobs AS job
      SET status = 'running', claim_token = $1, started_at = now()
      FROM next_job
      WHERE job.id = next_job.id
      RETURNING job.id, job.user_id, job.input_json, job.claim_token`, [token]);
    return result.rows[0] ?? null;
  }

  async complete(id, claimToken, resultValue) {
    const result = await this.db.query(`
      UPDATE analysis_jobs
      SET status = 'done', result_json = $3::jsonb,
          claim_token = NULL, finished_at = now()
      WHERE id = $1 AND status = 'running' AND claim_token = $2
      RETURNING id`, [id, claimToken, JSON.stringify(resultValue)]);
    return result.rowCount === 1;
  }

  async fail(id, claimToken, message) {
    const result = await this.db.query(`
      UPDATE analysis_jobs
      SET status = 'failed', error = $3,
          claim_token = NULL, finished_at = now()
      WHERE id = $1 AND status = 'running' AND claim_token = $2
      RETURNING id`, [id, claimToken, message]);
    return result.rowCount === 1;
  }

  /** Called once at startup in the single-runner deployment shown here. */
  async recoverInterrupted() {
    const result = await this.db.query(`
      UPDATE analysis_jobs
      SET status = 'queued', claim_token = NULL, started_at = NULL
      WHERE status = 'running'
      RETURNING id`);
    return result.rows.map((row) => row.id);
  }
}
