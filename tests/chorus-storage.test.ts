import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { databaseAttempts } from "../src/lib/chorus/attempts.ts";
import { writeSnapshot } from "../src/lib/chorus/snapshot-store.ts";
import type { Sql } from "../src/lib/db.ts";

// Execute the production SQL and migrations, not the in-memory attempt test adapter.
const db = new PGlite();
const query = async <T>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows;
const sql = Object.assign(async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
  const text = strings.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
  return query<T>(text, values);
}, { query }) as Sql;
const binding = { labId: "prompt", level: 0, artifact: "Review each line for security issues." };

before(async () => {
  await db.exec(await readFile(new URL("../migrations/0003_mcp_sittings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0004_exam_attempts.sql", import.meta.url), "utf8"));
});
after(async () => { await db.close(); });

describe("durable production SQL replay protection", () => {
  it("allows exactly one consumer across independent adapter instances", async () => {
    const attempt = await databaseAttempts(sql).issue("sql-concurrent", binding);
    const results = await Promise.all(Array.from({ length: 16 }, () =>
      databaseAttempts(sql).consume("sql-concurrent", attempt.attemptId, binding)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await databaseAttempts(sql).consume("sql-concurrent", attempt.attemptId, binding), false);
  });
  it("binds session, artifact, lab, level and full custom test in SQL", async () => {
    const store = databaseAttempts(sql);
    const attempt = await store.issue("sql-bind", { ...binding, userTest: "private brought input" });
    for (const [session, changed] of [
      ["wrong-session", { ...binding, userTest: "private brought input" }],
      ["sql-bind", { ...binding, artifact: binding.artifact + ".", userTest: "private brought input" }],
      ["sql-bind", { ...binding, labId: "generic", userTest: "private brought input" }],
      ["sql-bind", { ...binding, level: 1, userTest: "private brought input" }],
      ["sql-bind", { ...binding, userTest: "substituted input" }],
    ] as const) assert.equal(await store.consume(session, attempt.attemptId, changed), false);
    assert.equal(await store.consume("sql-bind", attempt.attemptId, { ...binding, userTest: "private brought input" }), true);
  });
  it("enforces database expiration regardless of the caller's clock", async () => {
    const store = databaseAttempts(sql);
    const attempt = await store.issue("sql-expired", binding);
    await sql`update chorus_exam_attempts set expires_at = now() - interval '1 second' where id = ${attempt.attemptId}`;
    assert.equal(await store.consume("sql-expired", attempt.attemptId, binding), false);
  });
  it("reset invalidates outstanding attempts without deleting consumed evidence", async () => {
    const first = databaseAttempts(sql), second = databaseAttempts(sql);
    const attempt = await first.issue("sql-reset", binding);
    await second.invalidate("sql-reset");
    assert.equal(await first.consume("sql-reset", attempt.attemptId, binding), false);
    const rows = await sql<{ consumed: boolean }>`select consumed from chorus_exam_attempts where id = ${attempt.attemptId}`;
    assert.equal(rows[0].consumed, true);
  });
  it("rejects stale snapshot writes and preserves the newer recorded payload", async () => {
    const rev1 = await writeSnapshot(sql, "sql-revision", '{"score":0}', 0);
    assert.equal(rev1, 1);
    const rev2 = await writeSnapshot(sql, "sql-revision", '{"score":33}', rev1);
    assert.equal(rev2, 2);
    await assert.rejects(writeSnapshot(sql, "sql-revision", '{"score":100}', rev1), /concurrently/);
    const rows = await sql<{ payload: string }>`select payload from chorus_mcp_sittings where id = ${"sql-revision"}`;
    assert.equal(JSON.parse(rows[0].payload).score, 33);
  });
  it("does not resurrect an attempt when an old exam marker is written to a sitting", async () => {
    const store = databaseAttempts(sql);
    const attempt = await store.issue("sql-tombstone", binding);
    assert.equal(await store.consume("sql-tombstone", attempt.attemptId, binding), true);
    await writeSnapshot(sql, "sql-tombstone", JSON.stringify({ exam: attempt }), 0);
    assert.equal(await databaseAttempts(sql).consume("sql-tombstone", attempt.attemptId, binding), false);
  });
});
