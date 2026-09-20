from pathlib import Path

def change(path, old, new):
    p=Path(path);s=p.read_text();assert s.count(old)==1,(path,old[:80],s.count(old));p.write_text(s.replace(old,new))
change('migrations/0005_experiments.sql',
 'create index chorus_checkpoints_experiment on chorus_checkpoints(experiment_id, id);',
 '''create index chorus_checkpoints_experiment on chorus_checkpoints(experiment_id, id);
create unique index chorus_checkpoint_revision on chorus_checkpoints(sitting_id,revision) where sitting_id is not null;''')
change('migrations/0005_experiments.sql',
 "values(exp,new.id,new.revision,'server_observed_host_submission',new.payload::jsonb - 'lock');",
 "values(exp,new.id,new.revision,'server_observed_host_submission',new.payload::jsonb - 'lock') on conflict do nothing;")
change('src/lib/chorus/experiments/storage.ts',
 "      ) insert into chorus_checkpoints(experiment_id,sitting_id,revision,provenance,payload)\n        select ${experiment},s.id,s.revision,'server_observed_host_submission',s.payload::jsonb-'lock'\n        from chorus_mcp_sittings s join linked l on l.sitting_id=s.id returning id`;",
 "      ), recorded as (insert into chorus_checkpoints(experiment_id,sitting_id,revision,provenance,payload)\n        select ${experiment},s.id,s.revision,'server_observed_host_submission',s.payload::jsonb-'lock'\n        from chorus_mcp_sittings s join linked l on l.sitting_id=s.id on conflict do nothing returning id) select sitting_id from linked`;")
change('src/lib/chorus/experiments/storage.ts',
 "        select ${experiment},c.id,c.revision,'server_observed_host_submission',c.payload::jsonb from child c join linked l on c.id=l.sitting_id`;",
 "        select ${experiment},c.id,c.revision,'server_observed_host_submission',c.payload::jsonb from child c join linked l on c.id=l.sitting_id on conflict do nothing`;")
change('tests/experiments-storage.test.ts',
 "  it('does not let stale writes create false checkpoints',async()=>{",
 """  it('saving an already-linked revision is idempotent',async()=>{
    const child=await store.child(vault,experiment,'prompt');
    await store.pin(vault,experiment,child.sittingId);await store.pin(vault,experiment,child.sittingId);
    assert.equal((await sql`select id from chorus_checkpoints where sitting_id=${child.sittingId}`).length,1);
  });
  it('does not let stale writes create false checkpoints',async()=>{""")
change('migrations/0005_experiments.sql',
 'create function chorus_checkpoint_sitting() returns trigger language plpgsql as $$',
 '''-- Bound persistent snapshot storage without deleting records when a quota is reached.
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
create function chorus_checkpoint_sitting() returns trigger language plpgsql as $$''')
change('src/lib/chorus/experiments/runner.ts',
 "      const valid=choice?.finish_reason==='stop'&&assessment?.status==='scored'&&usageValid&&typeof value.id==='string'&&typeof value.model==='string';",
 """      const prior=(await store.results(vault,comparisonId)).trials;
      const modelChanged=prior.some(t=>t.status==='completed'&&t.response_model!==value.model);
      const valid=!modelChanged&&choice?.finish_reason==='stop'&&assessment?.status==='scored'&&usageValid&&typeof value.id==='string'&&typeof value.model==='string';""")
change('src/lib/chorus/experiments/runner.ts',
 "error:valid?null:assessment?.error||'Provider output was incomplete, refused, missing usage or incompatible with the frozen output protocol.'",
 "error:valid?null:modelChanged?'The provider-reported model changed within this frozen comparison. Review the receipts; no automatic continuation.':assessment?.error||'Provider output was incomplete, refused, missing usage or incompatible with the frozen output protocol.'")
change('tests/experiments-storage.test.ts',
 "  it('does not overwrite a completed receipt',async()=>{",
 """  it('halts if the provider changes its reported model between matched trials',async()=>{
    const id=await fresh();await executeNext(sql,vault,id,policy,'api-key-secret',0,synthetic);
    const changed:typeof fetch=async(...a)=>{const res=await synthetic(...a);const data=await res.json();data.model='unexpected-revision';return new Response(JSON.stringify(data));};
    const r=await executeNext(sql,vault,id,policy,'api-key-secret',1,changed);
    assert.equal(r.status,'needs_review');assert.equal(r.trials[1].status,'invalid');assert.match(r.trials[1].error,/model changed/);
  });
  it('does not overwrite a completed receipt',async()=>{""")
change('tests/experiments-storage.test.ts',
 "  it('keeps historical checkpoints even when the live sitting is explicitly removed',async()=>{",
 """  it('storage limits fail before a checkpoint write without removing existing data',async()=>{
    const [prior]=await sql<any>`select bytes from chorus_checkpoint_budget where singleton`;
    await sql`update chorus_checkpoint_budget set bytes=268435456 where singleton`;
    await assert.rejects(store.saveClient(vault,experiment,{artifact:'over quota'}),/quota reached/);
    await sql`update chorus_checkpoint_budget set bytes=${prior.bytes} where singleton`;
    assert.ok((await store.detail(vault,experiment)).checkpoints.length>0);
  });
  it('explicit saved-experiment deletion releases only its own snapshot allocation',async()=>{
    const e=(await store.create(vault,{name:'temporary'})).id;await store.saveClient(vault,e,{artifact:'delete deliberately'});
    const [before]=await sql<any>`select bytes from chorus_checkpoint_budget where singleton`;
    await store.remove(vault,e);const [after]=await sql<any>`select bytes from chorus_checkpoint_budget where singleton`;
    assert.ok(Number(after.bytes)<Number(before.bytes));assert.ok((await store.detail(vault,experiment)).id);
  });
  it('keeps historical checkpoints even when the live sitting is explicitly removed',async()=>{""")
p=Path('EXPERIMENTS.md');p.write_text(p.read_text()+'''\n### Storage and provider consistency limits\n\nSaved checkpoints are capped at 2,000 and 64 MiB per experiment, with a 256 MiB\nglobal checkpoint budget for this personal-workspace release. Reaching a quota\nrejects the new write; it never prunes existing saved work. Export and explicitly\ndelete unneeded saved experiments to release space. These limits concern\ncheckpoints; paid comparison receipts also have per-response, per-plan and\noperator spending limits. A provider-reported model change during a frozen\ncomparison stops it for review instead of mixing those trials as matched results.\n''')
