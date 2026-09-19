import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

type SittingRow = {
  id: string;
  goal: string;
  labId: string | null;
  payload: string;
  updatedAt: string;
};

export const upsertSitting = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { sitting: { id?: string; goal?: string; labId?: string } }) => {
    const sitting = input.sitting;
    if (!sitting?.id) throw new Error("Missing sitting");
    const payload = JSON.stringify(sitting);
    if (payload.length > 800_000) throw new Error("Sitting too large");
    return {
      id: String(sitting.id),
      goal: String(sitting.goal ?? "").slice(0, 800),
      labId: sitting.labId ? String(sitting.labId).slice(0, 40) : null,
      payload,
    };
  })
  .handler(async ({ data, context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`
      insert into chorus_sittings (user_id, id, goal, lab_id, payload, updated_at)
      values (${context.userId}, ${data.id}, ${data.goal}, ${data.labId}, ${data.payload}, now())
      on conflict (user_id, id) do update set
        goal = excluded.goal,
        lab_id = excluded.lab_id,
        payload = excluded.payload,
        updated_at = now()
    `;
    return { ok: true as const };
  });

export const listSittings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      goal: string;
      lab_id: string | null;
      payload: string;
      updated_at: string;
    }>`
      select id, goal, lab_id, payload, updated_at
      from chorus_sittings
      where user_id = ${context.userId}
      order by updated_at desc
      limit 24
    `;
    return rows.map(
      (row): SittingRow => ({
        id: row.id,
        goal: row.goal,
        labId: row.lab_id,
        payload: row.payload,
        updatedAt: row.updated_at,
      }),
    );
  });
