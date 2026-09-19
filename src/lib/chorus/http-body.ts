export async function readJsonLimited(request: Request, maxBytes = 200_000): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new Error("Content-Type must be application/json");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing JSON body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Payload too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export function browserOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}
