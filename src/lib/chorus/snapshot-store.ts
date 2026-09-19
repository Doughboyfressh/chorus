import type { Sql } from "../db.ts";

export async function writeSnapshot(sql: Sql, id: string, payload: string, revision: number) {
  const rows = await sql<{ revision: number }>`
    insert into chorus_mcp_sittings (id, payload, revision, updated_at)
    values (${id}, ${payload}, 1, now())
    on conflict (id) do update set payload = excluded.payload,
      revision = chorus_mcp_sittings.revision + 1, updated_at = now()
    where chorus_mcp_sittings.revision = ${revision}
    returning revision
  `;
  if (rows.length !== 1) throw new Error("Sitting changed concurrently. Reload before retrying; no result was recorded.");
  return Number(rows[0].revision);
}
