import { createFileRoute } from "@tanstack/react-router";
import { sittingPairs, sittingToRun, validSitId } from "@/lib/chorus/mcp-sitting";

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
    },
  },
});
