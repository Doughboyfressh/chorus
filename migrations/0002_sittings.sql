create table if not exists chorus_sittings (
  user_id    text not null,
  id         text not null,
  goal       text not null default '',
  lab_id     text,
  payload    text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists chorus_sittings_user_updated_idx on chorus_sittings (user_id, updated_at desc);
