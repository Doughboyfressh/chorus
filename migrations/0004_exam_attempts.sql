create table if not exists chorus_exam_attempts (
  id text primary key,
  sitting_id text not null,
  context_key text not null,
  expires_at timestamptz not null,
  consumed boolean not null default false
);
create index if not exists chorus_exam_attempts_sitting on chorus_exam_attempts(sitting_id);
create index if not exists chorus_exam_attempts_expiry on chorus_exam_attempts(expires_at);

alter table chorus_mcp_sittings add column if not exists revision bigint not null default 0;
