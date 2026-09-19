# Chorus

Recursive self-improvement lab. Bring a model. The loop is ours.

## Deploy (Vercel + Neon)

1. Create a free Postgres database at [neon.tech](https://neon.tech). Copy `DATABASE_URL`.
2. In the Vercel project, set env `DATABASE_URL` for Production, Preview, and Development.
3. Deploy. Open `/lab`. Score gen 0. Copy the MCP URL into Grok.

Without `DATABASE_URL`, the lab still runs. MCP sittings will not survive serverless restarts.
