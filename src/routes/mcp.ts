import { createFileRoute } from "@tanstack/react-router";
import { mcpHandlers } from "@/lib/chorus/mcp-http";

export const Route = createFileRoute("/mcp")({
  server: { handlers: mcpHandlers },
});
