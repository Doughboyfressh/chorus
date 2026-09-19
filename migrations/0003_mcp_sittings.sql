create table if not exists chorus_mcp_sittings (
  id         text primary key,
  payload    text not null,
  updated_at timestamptz not null default now()
);
