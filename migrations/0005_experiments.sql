-- Saved experiments are not subject to temporary-sitting retention or pruning.
create table chorus_vaults (
  id uuid primary key, key_hash text unique not null, created_at timestamptz not null default now()
);
create table chorus_experiments (
  id uuid primary key, vault_id uuid not null references chorus_vaults(id),
  name text not null, hypothesis text not null default '', parent_id uuid references chorus_experiments(id),
  created_at timestamptz not null default now(), archived boolean not null default false
);
create index chorus_experiments_vault on chorus_experiments(vault_id, created_at desc);
create table chorus_saved_sittings (
  sitting_id text primary key, experiment_id uuid not null references chorus_experiments(id), created_at timestamptz not null default now()
);
create table chorus_checkpoints (
  id bigserial primary key, experiment_id uuid not null references chorus_experiments(id),
  sitting_id text, revision integer, provenance text not null, payload jsonb not null,
  created_at timestamptz not null default now(), check (octet_length(payload::text) <= 3000000)
);
create index chorus_checkpoints_experiment on chorus_checkpoints(experiment_id, id);
create unique index chorus_checkpoint_revision on chorus_checkpoints(sitting_id,revision) where sitting_id is not null;
-- Bound persistent snapshot storage without deleting records when a quota is reached.
create table chorus_checkpoint_budget(singleton boolean primary key default true check(singleton), bytes bigint not null default 0);
insert into chorus_checkpoint_budget values(true,0);
create function chorus_checkpoint_quota() returns trigger language plpgsql as $$
declare used bigint; total bigint; items integer; incoming bigint;
begin
  select bytes into total from chorus_checkpoint_budget where singleton for update;
  if new.sitting_id is not null and exists(select 1 from chorus_checkpoints where sitting_id=new.sitting_id and revision=new.revision) then return null; end if;
  incoming=octet_length(new.payload::text);
  select coalesce(sum(octet_length(payload::text)),0),count(*) into used,items from chorus_checkpoints where experiment_id=new.experiment_id;
  if items>=2000 or used+incoming>67108864 or total+incoming>268435456 then
    raise exception 'Saved checkpoint quota reached. Export and explicitly delete unneeded saved records; existing data was preserved.';
  end if;
  update chorus_checkpoint_budget set bytes=bytes+incoming where singleton;
  return new;
end $$;
create trigger chorus_limit_checkpoint before insert on chorus_checkpoints for each row execute function chorus_checkpoint_quota();
create function chorus_checkpoint_released() returns trigger language plpgsql as $$
begin
  update chorus_checkpoint_budget set bytes=greatest(0,bytes-octet_length(old.payload::text)) where singleton;
  return old;
end $$;
create trigger chorus_release_checkpoint after delete on chorus_checkpoints for each row execute function chorus_checkpoint_released();
create function chorus_checkpoint_sitting() returns trigger language plpgsql as $$
declare exp uuid;
begin
  select experiment_id into exp from chorus_saved_sittings where sitting_id=new.id;
  if exp is not null then
    if (select count(*) from chorus_checkpoints where experiment_id=exp) >= 2000 then
      raise exception 'Saved experiment checkpoint limit reached. Export and start a child experiment; no data was deleted.';
    end if;
    insert into chorus_checkpoints(experiment_id,sitting_id,revision,provenance,payload)
      values(exp,new.id,new.revision,'server_observed_host_submission',new.payload::jsonb - 'lock') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger chorus_archive_sitting after insert or update on chorus_mcp_sittings for each row execute function chorus_checkpoint_sitting();

create table chorus_comparisons (
  id uuid primary key, experiment_id uuid not null references chorus_experiments(id), plan jsonb not null, plan_hash text not null,
  baseline_hash text not null, candidate_hash text not null,
  status text not null default 'ready' check(status in ('ready','running','paused','completed','needs_review','budget_exhausted')),
  next_ordinal integer not null default 0, reserved_micro bigint not null default 0,
  active_trial uuid, lease_until timestamptz, started_at timestamptz, finished_at timestamptz,
  reason text, created_at timestamptz not null default now(), check(next_ordinal>=0 and reserved_micro>=0)
);
create table chorus_trials (
  id uuid primary key, comparison_id uuid not null references chorus_comparisons(id), ordinal integer not null,
  case_id text not null, repetition integer not null, side text not null check(side in ('baseline','candidate')),
  status text not null check(status in ('reserved','completed','invalid','transport_error','unknown')),
  request jsonb not null, request_hash text not null, response_raw text, output text, output_hash text,
  response_id text, response_model text, usage jsonb, assessment jsonb, error text,
  reserved_micro bigint not null, observed_micro bigint, latency_ms integer,
  started_at timestamptz not null default now(), finished_at timestamptz,
  unique(comparison_id,ordinal), check (octet_length(coalesce(response_raw,'')) <= 1000000)
);
create table chorus_runner_days(day date primary key, reserved_micro bigint not null default 0, calls integer not null default 0);

-- One atomic claim reserves both the per-experiment and global budgets before any provider call.
create function chorus_claim_trial(p_vault uuid,p_comparison uuid,p_ordinal integer,p_trial uuid,p_request jsonb,p_hash text,p_reserve bigint,p_daily_limit bigint)
returns jsonb language plpgsql as $$
declare c chorus_comparisons; step jsonb; reserved bigint; result chorus_trials;
begin
  select j.* into c from chorus_comparisons j join chorus_experiments e on e.id=j.experiment_id
    where j.id=p_comparison and e.vault_id=p_vault for update of j;
  if not found then return null; end if;
  if c.active_trial is not null then
    if c.lease_until < now() then
      update chorus_trials set status='unknown',error='Execution interrupted; provider outcome is unknown. Not automatically retried.',finished_at=now()
        where id=c.active_trial and status='reserved';
      update chorus_comparisons set status='needs_review',active_trial=null,reason='Interrupted trial requires review. Fork for a new experiment.' where id=c.id;
    end if;
    return null;
  end if;
  if c.status not in ('ready','running') or c.next_ordinal<>p_ordinal or p_ordinal>=jsonb_array_length(c.plan->'schedule') then return null; end if;
  if p_reserve<=0 or p_daily_limit<=0 then raise exception 'Invalid budget reservation'; end if;
  if (c.started_at is not null and now()>=c.started_at+((c.plan->>'maxSeconds')::int * interval '1 second')) or
    c.reserved_micro+p_reserve > ceil((c.plan->>'maxUsd')::numeric*1000000) or p_ordinal >= (c.plan->>'maxCalls')::int then
    update chorus_comparisons set status='budget_exhausted',reason='Time, call or estimated spending limit reached; incomplete is not a pass.' where id=c.id;
    return null;
  end if;
  insert into chorus_runner_days(day,reserved_micro,calls) values((now() at time zone 'UTC')::date,p_reserve,1)
    on conflict(day) do update set reserved_micro=chorus_runner_days.reserved_micro+excluded.reserved_micro,calls=chorus_runner_days.calls+1
      where chorus_runner_days.reserved_micro+excluded.reserved_micro<=p_daily_limit
    returning reserved_micro into reserved;
  if reserved is null or reserved>p_daily_limit then
    -- The insert case must obey the cap too; rollback its reservation within this transaction.
    if reserved is not null then update chorus_runner_days set reserved_micro=reserved_micro-p_reserve,calls=calls-1 where day=(now() at time zone 'UTC')::date; end if;
    update chorus_comparisons set status='budget_exhausted',reason='Operator daily estimated spending limit reached.' where id=c.id;
    return null;
  end if;
  step=c.plan->'schedule'->p_ordinal;
  insert into chorus_trials(id,comparison_id,ordinal,case_id,repetition,side,status,request,request_hash,reserved_micro)
    values(p_trial,c.id,p_ordinal,c.plan->'cases'->((step->>'caseIndex')::int)->>'id',(step->>'repetition')::int,step->>'side','reserved',p_request,p_hash,p_reserve)
    returning * into result;
  update chorus_comparisons set active_trial=p_trial,lease_until=now()+interval '2 minutes',started_at=coalesce(started_at,now()),
    next_ordinal=next_ordinal+1,reserved_micro=reserved_micro+p_reserve,status='running' where id=c.id;
  return to_jsonb(result);
end $$;

create function chorus_finish_trial(p_vault uuid,p_trial uuid,p_result jsonb) returns boolean language plpgsql as $$
declare c chorus_comparisons; t chorus_trials;
begin
  select j.* into c from chorus_comparisons j join chorus_trials x on x.comparison_id=j.id join chorus_experiments e on e.id=j.experiment_id
    where x.id=p_trial and e.vault_id=p_vault for update of j;
  if not found or c.active_trial is distinct from p_trial then return false; end if;
  select * into t from chorus_trials where id=p_trial for update;
  if t.status<>'reserved' then return false; end if;
  if p_result->>'status' not in ('completed','invalid','transport_error') then raise exception 'Invalid terminal status'; end if;
  update chorus_trials set status=p_result->>'status',response_raw=p_result->>'response_raw',output=p_result->>'output',
    output_hash=p_result->>'output_hash',response_id=p_result->>'response_id',response_model=p_result->>'response_model',
    usage=p_result->'usage',assessment=p_result->'assessment',error=p_result->>'error',observed_micro=(p_result->>'observed_micro')::bigint,
    latency_ms=(p_result->>'latency_ms')::int,finished_at=now() where id=p_trial;
  update chorus_comparisons set active_trial=null,lease_until=null,
    status=case when p_result->>'status'<>'completed' then 'needs_review'
      when coalesce((p_result->>'observed_micro')::bigint,0)>t.reserved_micro then 'needs_review'
      when c.next_ordinal>=jsonb_array_length(c.plan->'schedule') then 'completed'
      when c.status='paused' then 'paused' else 'ready' end,
    reason=case when p_result->>'status'<>'completed' then 'A trial failed or returned invalid output. No automatic retry or score substitution.'
      when coalesce((p_result->>'observed_micro')::bigint,0)>t.reserved_micro then 'Observed usage exceeded the conservative reservation. Review pricing before another run.' else null end,
    finished_at=case when c.next_ordinal>=jsonb_array_length(c.plan->'schedule') then now() else null end
    where id=c.id;
  return true;
end $$;

-- Storage-only vault creation also has a global daily abuse bound.
create table chorus_vault_days(day date primary key, created integer not null default 0);
create function chorus_create_vault(p_id uuid,p_hash text) returns boolean language plpgsql as $$
declare allowed integer;
begin
  insert into chorus_vault_days(day,created) values((now() at time zone 'UTC')::date,1)
  on conflict(day) do update set created=chorus_vault_days.created+1 where chorus_vault_days.created<100
  returning created into allowed;
  if allowed is null then return false; end if;
  insert into chorus_vaults(id,key_hash) values(p_id,p_hash);
  return true;
end $$;

-- Explicit deletion of a leaf experiment only. No cascading across children or live calls.
create function chorus_delete_experiment(p_vault uuid,p_experiment uuid) returns boolean language plpgsql as $$
begin
  perform 1 from chorus_experiments where id=p_experiment and vault_id=p_vault for update;
  if not found then return false; end if;
  if exists(select 1 from chorus_experiments where parent_id=p_experiment) then raise exception 'Delete or export child experiments first'; end if;
  perform 1 from chorus_comparisons where experiment_id=p_experiment for update;
  if exists(select 1 from chorus_comparisons where experiment_id=p_experiment and active_trial is not null) then raise exception 'Cannot delete an experiment with an unresolved active trial'; end if;
  delete from chorus_trials where comparison_id in(select id from chorus_comparisons where experiment_id=p_experiment);
  delete from chorus_comparisons where experiment_id=p_experiment;
  delete from chorus_checkpoints where experiment_id=p_experiment;
  delete from chorus_saved_sittings where experiment_id=p_experiment;
  delete from chorus_experiments where id=p_experiment;
  return true;
end $$;
