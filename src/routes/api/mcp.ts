import { createFileRoute } from "@tanstack/react-router";
import { dropSession, validSitId } from "@/lib/chorus/mcp-sitting";
import { handleMcp, negotiateProtocol, type McpCtx } from "@/lib/chorus/mcp";
import { clientKey, rateLimit } from "@/lib/chorus/limit";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, mcp-session-id, mcp-protocol-version, accept, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

function sittingIds(request: Request) {
  const sit = new URL(request.url).searchParams.get("sit")?.trim() ?? "";
  const write = request.headers.get("mcp-session-id")?.trim() ?? "";
  const sessionId = sit && validSitId(sit) ? sit : write && validSitId(write) ? write : crypto.randomUUID();
  const writeKey = write && validSitId(write) ? write : undefined;
  return { sessionId, writeKey };
}

function protocolFrom(request: Request, body?: unknown) {
  const header = request.headers.get("mcp-protocol-version")?.trim();
  const fromInit =
    body && typeof body === "object" && !Array.isArray(body)
      ? String(((body as { params?: { protocolVersion?: string } }).params?.protocolVersion ?? "") || "")
      : "";
  return negotiateProtocol(header || fromInit || undefined);
}

function headers(sessionId: string, protocol: string, contentType: string) {
  return {
    ...cors,
    "content-type": contentType,
    "mcp-protocol-version": protocol,
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    // Stateless: sitting is ?sit=. Emitting a different session id breaks Grok.
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  };
}

function json(data: unknown, sessionId: string, protocol: string, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: headers(sessionId, protocol, "application/json"),
  });
}

function sse(data: unknown, sessionId: string, protocol: string) {
  const payload = `event: message\ndata: ${JSON.stringify(data)}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: headers(sessionId, protocol, "text/event-stream"),
  });
}

function wantsSse(request: Request) {
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  if (!accept.includes("text/event-stream")) return false;
  if (accept.includes("application/json")) return false;
  return true;
}

function sseStream(sessionId: string, protocol: string, request: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": chorus\n\n"));
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          clearInterval(ping);
        }
      }, 15000);
      const close = () => {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", close);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: headers(sessionId, protocol, "text/event-stream"),
  });
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
      GET: ({ request }) => {
        const { sessionId } = sittingIds(request);
        const protocol = protocolFrom(request);
        return sseStream(sessionId, protocol, request);
      },
      DELETE: async ({ request }) => {
        const { sessionId } = sittingIds(request);
        await dropSession(sessionId);
        return new Response(null, { status: 204, headers: cors });
      },
      POST: async ({ request }) => {
        const { sessionId, writeKey } = sittingIds(request);
        if (!rateLimit(`mcp:${clientKey(request)}`, 120, 60_000)) {
          return json(
            { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Slow down." } },
            sessionId,
            protocolFrom(request),
            429,
          );
        }
        const len = Number(request.headers.get("content-length") || 0);
        if (len > 200_000) {
          return json(
            { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Payload too large" } },
            sessionId,
            protocolFrom(request),
            413,
          );
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json(
            { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
            sessionId,
            protocolFrom(request),
            400,
          );
        }
        const protocol = protocolFrom(request, body);
        const ctx: McpCtx = { sessionId, protocol, writeKey };
        const result = await handleMcp(body, ctx);
        if (result == null) {
          return new Response(null, { status: 202, headers: headers(sessionId, protocol, "application/json") });
        }
        if (wantsSse(request)) return sse(result, sessionId, protocol);
        return json(result, sessionId, protocol);
      },
    },
  },
});
