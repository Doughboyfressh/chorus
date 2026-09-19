import { browserOriginAllowed, readJsonLimited } from "./http-body.ts";
import { dropSession, validSitId } from "./mcp-sitting.ts";
import { handleMcp, negotiateProtocol, type McpCtx } from "./mcp.ts";
import { clientKey, rateLimit } from "./limit.ts";

const cors: Record<string, string> = {
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "content-type, mcp-session-id, mcp-protocol-version, accept, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

function sittingFrom(request: Request, pathSit?: string) {
  const fromPath = pathSit?.trim() ?? "";
  const fromQuery = new URL(request.url).searchParams.get("sit")?.trim() ?? "";
  const fromHeader = request.headers.get("mcp-session-id")?.trim() ?? "";
  const sessionId = [fromPath, fromQuery, fromHeader].find(validSitId) ?? crypto.randomUUID();
  return { sessionId, clientSession: fromHeader && validSitId(fromHeader) ? fromHeader : "" };
}

function protocolFrom(request: Request, body?: unknown) {
  const header = request.headers.get("mcp-protocol-version")?.trim();
  const fromInit =
    body && typeof body === "object" && !Array.isArray(body)
      ? String(((body as { params?: { protocolVersion?: string } }).params?.protocolVersion ?? "") || "")
      : "";
  return negotiateProtocol(header || fromInit || undefined);
}

function headers(protocol: string, contentType: string, clientSession?: string) {
  return {
    ...cors,
    "content-type": contentType,
    "mcp-protocol-version": protocol,
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    ...(clientSession ? { "mcp-session-id": clientSession } : {}),
  };
}

function json(data: unknown, protocol: string, status = 200, clientSession?: string) {
  return new Response(JSON.stringify(data), {
    status,
    headers: headers(protocol, "application/json", clientSession),
  });
}

function sse(data: unknown, protocol: string, clientSession?: string) {
  const payload = `event: message\ndata: ${JSON.stringify(data)}\n\n`;
  return new Response(payload, {
    status: 200,
    headers: headers(protocol, "text/event-stream", clientSession),
  });
}

function wantsSseBody(request: Request) {
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  if (!accept.includes("text/event-stream")) return false;
  if (accept.includes("application/json")) return false;
  return true;
}

function acceptsSse(request: Request) {
  return (request.headers.get("accept") ?? "").toLowerCase().includes("text/event-stream");
}

function sseStream(protocol: string, request: Request, clientSession?: string) {
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
    headers: { ...headers(protocol, "text/event-stream", clientSession), connection: "keep-alive" },
  });
}

type Ctx = { request: Request; params?: { sit?: string } };

export const mcpHandlers = {
  OPTIONS: () => new Response(null, { status: 204, headers: cors }),
  GET: ({ request, params }: Ctx) => {
    const protocol = protocolFrom(request);
    const { clientSession } = sittingFrom(request, params?.sit);
    if (!acceptsSse(request)) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Not Acceptable: Client must accept text/event-stream" } },
        protocol,
        406,
        clientSession,
      );
    }
    return sseStream(protocol, request, clientSession);
  },
  DELETE: async ({ request, params }: Ctx) => {
    if (!browserOriginAllowed(request)) return new Response("Forbidden", { status: 403 });
    const { sessionId } = sittingFrom(request, params?.sit);
    await dropSession(sessionId);
    return new Response(null, { status: 204, headers: cors });
  },
  POST: async ({ request, params }: Ctx) => {
    if (!browserOriginAllowed(request)) return new Response("Forbidden", { status: 403 });
    const { sessionId, clientSession } = sittingFrom(request, params?.sit);
    const protocolHint = protocolFrom(request);
    if (!rateLimit(`mcp:${clientKey(request)}`, 120, 60_000)) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Slow down." } },
        protocolHint,
        429,
        clientSession,
      );
    }
    const len = Number(request.headers.get("content-length") || 0);
    if (len > 200_000) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Payload too large" } },
        protocolHint,
        413,
        clientSession,
      );
    }
    let body: unknown;
    try {
      body = await readJsonLimited(request);
    } catch (err) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: err instanceof Error ? err.message : "Parse error" } },
        protocolHint,
        err instanceof Error && err.message === "Payload too large" ? 413 : 400,
        clientSession,
      );
    }
    const protocol = protocolFrom(request, body);
    const ctx: McpCtx = { sessionId, protocol, writeKey: clientSession || undefined };
    const result = await handleMcp(body, ctx);
    if (result == null) {
      return new Response(null, { status: 202, headers: headers(protocol, "application/json", clientSession) });
    }
    if (wantsSseBody(request)) return sse(result, protocol, clientSession);
    return json(result, protocol, 200, clientSession);
  },
};
