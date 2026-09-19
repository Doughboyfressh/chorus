import { requireDurableDatabase } from "./durable-storage.ts";
import { boundedText, MAX_ARTIFACT, MAX_USER_TEST } from "./integrity.ts";
import type { Sql } from "../db.ts";

export type ExamBinding = { labId: string; level: number; artifact: string; userTest?: string };
export const EXAM_TTL_MS = 10 * 60_000;
const memory = new Map<string, { sitting: string; key: string; expiresAt: number; consumed: boolean }>();
const contextKey = (b: ExamBinding) => {
  boundedText(b.artifact, "artifact", MAX_ARTIFACT, 8);
  boundedText(b.userTest ?? "", "userTest", MAX_USER_TEST);
  return JSON.stringify([2, b.labId, b.level, b.artifact, b.userTest ?? ""]);
};

export function databaseAttempts(sql: Sql) {
  return {
    async issue(sitting: string, binding: ExamBinding) {
      const attemptId = crypto.randomUUID();
      const expiresAt = Date.now() + EXAM_TTL_MS;
      const key = contextKey(binding);
      await sql`insert into chorus_exam_attempts (id, sitting_id, context_key, expires_at)
        values (${attemptId}, ${sitting}, ${key}, ${new Date(expiresAt).toISOString()})`;
      // Only expire by time: resetting the score ledger must never resurrect a used nonce.
      await sql`delete from chorus_exam_attempts where expires_at < now() - interval '1 day'`;
      return { attemptId, expiresAt };
    },
    async consume(sitting: string, attemptId: string, binding: ExamBinding) {
      const key = contextKey(binding);
      const rows = await sql<{ id: string }>`update chorus_exam_attempts set consumed = true
        where id = ${attemptId} and sitting_id = ${sitting} and context_key = ${key}
        and consumed = false and expires_at > now() returning id`;
      return rows.length === 1;
    },
    async invalidate(sitting: string) {
      await sql`update chorus_exam_attempts set consumed = true where sitting_id = ${sitting}`;
    },
  };
}

async function store() {
  if (typeof process !== "undefined" && process.env.NODE_TEST_CONTEXT) {
    return {
      async issue(sitting: string, binding: ExamBinding) {
        for (const [id, row] of memory) if (row.expiresAt <= Date.now()) memory.delete(id);
        if (memory.size >= 1000) throw new Error("Too many outstanding test attempts.");
        const attemptId = crypto.randomUUID();
        const expiresAt = Date.now() + EXAM_TTL_MS;
        memory.set(attemptId, { sitting, key: contextKey(binding), expiresAt, consumed: false });
        return { attemptId, expiresAt };
      },
      async consume(sitting: string, attemptId: string, binding: ExamBinding) {
        const row = memory.get(attemptId);
        if (!row || row.consumed || row.expiresAt <= Date.now() || row.sitting !== sitting || row.key !== contextKey(binding)) return false;
        row.consumed = true; // Before any await: concurrent submissions get exactly one success.
        return true;
      },
      async invalidate(sitting: string) {
        for (const row of memory.values()) if (row.sitting === sitting) row.consumed = true;
      },
    };
  }
  // Production never silently falls back to process-local, replayable storage.
  requireDurableDatabase(process.env);
  const { getSql } = await import("../db.ts");
  return databaseAttempts(await getSql());
}

export async function issueAttempt(sitting: string, binding: ExamBinding) {
  return (await store()).issue(sitting, binding);
}
export async function consumeAttempt(sitting: string, attemptId: string, binding: ExamBinding) {
  return (await store()).consume(sitting, attemptId, binding);
}
export async function invalidateAttempts(sitting: string) { await (await store()).invalidate(sitting); }
