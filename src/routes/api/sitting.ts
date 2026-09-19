import { readJsonLimited } from "@/lib/chorus/http-body";
import { createFileRoute } from "@tanstack/react-router";
import { applySittingUpdate, resetSitting, sittingFor, sittingPairs, sittingToRun, validSitId } from "@/lib/chorus/mcp-sitting";

function sameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  return site === "same-origin";
}

export const Route = createFileRoute("/api/sitting")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!sameOrigin(request)) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }
        const sit = new URL(request.url).searchParams.get("sit")?.trim() ?? "";
        if (!validSitId(sit)) {
          return new Response(JSON.stringify({ error: "Missing sit" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const run = await sittingToRun(sit);
        const pairs = await sittingPairs(sit);
        return new Response(JSON.stringify({ run, pairs }), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
      POST: async ({ request }) => {
        if (!sameOrigin(request)) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }
        const sit = new URL(request.url).searchParams.get("sit")?.trim() ?? "";
        if (!validSitId(sit)) {
          return new Response(JSON.stringify({ error: "Missing sit" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        let body: { labId?: string; reset?: boolean; conduct?: boolean; goal?: string; pasted?: string } = {};
        try {
          body = (await readJsonLimited(request)) as typeof body;
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid JSON object");
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body; no state changed" }), { status: 400, headers: { "content-type": "application/json" } });
        }
        if (!body.conduct && body.reset !== true) {
          return new Response(JSON.stringify({ error: "Explicit reset:true is required" }), { status: 400, headers: { "content-type": "application/json" } });
        }
        if (body.conduct) {
          const sitting = await applySittingUpdate(sit, {
            conduct: true,
            labId: typeof body.labId === "string" ? body.labId : undefined,
            goal: body.goal,
            pasted: body.pasted,
          });
          return new Response(JSON.stringify({ id: sitting.id, labId: sitting.labId, orchestra: true }), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
        const labId = typeof body.labId === "string" && body.labId.trim() ? body.labId.trim() : "";
        const existing = await sittingFor(sit);
        const sitting = await resetSitting(sit, labId || existing.labId || "rsi");
        return new Response(
          JSON.stringify({ id: sitting.id, labId: sitting.labId, generations: 0, pairCount: 0 }),
          { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
        );
      },
    },
  },
});
