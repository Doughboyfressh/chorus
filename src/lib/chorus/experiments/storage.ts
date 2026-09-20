import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from '../../db.ts';
import { canonical, ExperimentError, WORKSPACE_KEY, text, safeSnapshot, type ComparisonPlan } from './contracts.ts';
import { comparisonReport } from './pilot.ts';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function experimentsStore(sql: Sql) {
  const owned = async (vault: string, experiment: string) => {
    const [row]=await sql<any>`select * from chorus_experiments where id=${experiment} and vault_id=${vault}`;
    if (!row) throw new ExperimentError('NOT_FOUND','Experiment not found in this vault.',404);
    return row;
  };
  const comparison = async (vault: string, id: string) => {
    const [row]=await sql<any>`select c.* from chorus_comparisons c join chorus_experiments e on e.id=c.experiment_id where c.id=${id} and e.vault_id=${vault}`;
    if (!row) throw new ExperimentError('NOT_FOUND','Comparison not found in this vault.',404);
    return row;
  };
  return {
    async createVault() {
      const id=crypto.randomUUID(), key='cv_'+randomBytes(32).toString('hex');
      // Creation is storage-only and can never authorize paid execution.
      const [created]=await sql<{ok:boolean}>`select chorus_create_vault(${id}::uuid,${hash(key)}) as ok`;
      if (!created?.ok) throw new ExperimentError('RATE_LIMIT','Daily vault creation limit reached. Restore an existing vault.',429);
      return {id,key};
    },
    async authenticate(key: string) {
      if (!WORKSPACE_KEY.test(key)) throw new ExperimentError('UNAUTHORIZED','Unlock your experiment vault first.',401);
      const [row]=await sql<{id:string}>`select id from chorus_vaults where key_hash=${hash(key)}`;
      if (!row) throw new ExperimentError('UNAUTHORIZED','Invalid vault recovery key.',401);
      return row.id;
    },
    async list(vault: string) { return sql`select id,name,hypothesis,parent_id,created_at,archived from chorus_experiments where vault_id=${vault} order by created_at desc limit 100`; },
    async create(vault: string, args: Record<string,unknown>) {
      const name=text(args.name,'Name',120), hypothesis=text(args.hypothesis??'','Hypothesis',2000,0), id=crypto.randomUUID();
      if (args.parentId) await owned(vault,String(args.parentId));
      const rows=await sql`insert into chorus_experiments(id,vault_id,name,hypothesis,parent_id)
        select ${id},id,${name},${hypothesis},${args.parentId??null}::uuid from chorus_vaults where id=${vault}
        and (select count(*) from chorus_experiments where vault_id=${vault})<100 returning id`;
      if (!rows.length) throw new ExperimentError('LIMIT','Vault experiment limit reached. Export before creating another.');
      return {id};
    },
    async detail(vault: string, experiment: string, after=0) {
      const row=await owned(vault,experiment);
      const checkpoints=await sql`select id,sitting_id,revision,provenance,created_at from chorus_checkpoints where experiment_id=${experiment} and id>${after} order by id limit 100`;
      const sittings=await sql`select sitting_id,created_at from chorus_saved_sittings where experiment_id=${experiment} order by created_at`;
      const comparisons=await sql`select id,status,reason,created_at,next_ordinal,plan_hash,reserved_micro,plan->>'maxCalls' as planned_calls from chorus_comparisons where experiment_id=${experiment} order by created_at desc`;
      return {...row,checkpoints,sittings,comparisons};
    },
    async checkpoint(vault: string, experiment: string, checkpointId: number) {
      await owned(vault,experiment);
      const [row]=await sql`select * from chorus_checkpoints where experiment_id=${experiment} and id=${checkpointId}`;
      if (!row) throw new ExperimentError('NOT_FOUND','Checkpoint not found.',404);
      return {...row,sha256:hash(canonical((row as any).payload))};
    },
    async saveClient(vault: string, experiment: string, value: unknown) {
      await owned(vault,experiment);
      const payload=safeSnapshot(value);
      const rows=await sql`insert into chorus_checkpoints(experiment_id,provenance,payload) select ${experiment},'client_supplied_unverified',${payload}::jsonb
        where (select count(*) from chorus_checkpoints where experiment_id=${experiment})<2000 returning id`;
      if (!rows.length) throw new ExperimentError('LIMIT','Checkpoint limit reached. Export and start a child experiment.');
      return rows;
    },
    async pin(vault: string, experiment: string, sitting: string) {
      await owned(vault,experiment);
      // Sitting IDs remain bearer capabilities. The link prevents cross-vault adoption after saving.
      const rows=await sql`with linked as (
        insert into chorus_saved_sittings(sitting_id,experiment_id)
        select id,${experiment}::uuid from chorus_mcp_sittings where id=${sitting}
        on conflict(sitting_id) do update set experiment_id=chorus_saved_sittings.experiment_id
          where chorus_saved_sittings.experiment_id=excluded.experiment_id returning sitting_id
      ), recorded as (insert into chorus_checkpoints(experiment_id,sitting_id,revision,provenance,payload)
        select ${experiment},s.id,s.revision,'server_observed_host_submission',s.payload::jsonb-'lock'
        from chorus_mcp_sittings s join linked l on l.sitting_id=s.id on conflict do nothing returning id) select sitting_id from linked`;
      if (!rows.length) throw new ExperimentError('CANNOT_ATTACH','Sitting is missing or already saved to another experiment.',409);
      return {saved:true};
    },
    async child(vault: string, experiment: string, labId: string) {
      await owned(vault,experiment);
      const sitting=crypto.randomUUID();
      // The snapshot is copied in this statement; later changes are captured by the trigger.
      await sql`with child as (
        insert into chorus_mcp_sittings(id,payload,revision) values(${sitting},${JSON.stringify({id:sitting,labId,level:0,scores:[],pairs:[]})},1) returning id,payload,revision
      ), linked as (
        insert into chorus_saved_sittings(sitting_id,experiment_id) select id,${experiment} from child returning sitting_id
      ) insert into chorus_checkpoints(experiment_id,sitting_id,revision,provenance,payload)
        select ${experiment},c.id,c.revision,'server_observed_host_submission',c.payload::jsonb from child c join linked l on c.id=l.sitting_id on conflict do nothing`;
      return {sittingId:sitting};
    },
    async export(vault: string, experiment: string) {
      const row=await owned(vault,experiment);
      const checkpoints=await sql<any>`select id,sitting_id,revision,provenance,created_at from chorus_checkpoints where experiment_id=${experiment} order by id`;
      const comparisons=await sql<any>`select id,status,plan_hash,created_at from chorus_comparisons where experiment_id=${experiment} order by created_at`;
      return {version:1,exportedAt:new Date().toISOString(),experiment:row,checkpoints,comparisons,
        note:'Private backup manifest. Fetch each checkpoint and receipt for a complete backup. Contains saved sitting capabilities; no clean-training authorization.'};
    },
    async receipt(vault: string, trialId: string) {
      const [row]=await sql<any>`select t.* from chorus_trials t join chorus_comparisons c on c.id=t.comparison_id join chorus_experiments e on e.id=c.experiment_id
        where t.id=${trialId} and e.vault_id=${vault}`;
      if (!row) throw new ExperimentError('NOT_FOUND','Receipt not found.',404);
      return row;
    },
    async remove(vault: string, experiment: string) {
      await owned(vault,experiment);
      const [row]=await sql<{ok:boolean}>`select chorus_delete_experiment(${vault}::uuid,${experiment}::uuid) as ok`;
      if(!row?.ok) throw new ExperimentError('NOT_FOUND','Experiment not found.',404);
      return {deleted:true};
    },
    async createComparison(vault: string, experiment: string, plan: ComparisonPlan) {
      await owned(vault,experiment);
      const id=crypto.randomUUID();
      const rows=await sql`insert into chorus_comparisons(id,experiment_id,plan,plan_hash,baseline_hash,candidate_hash)
        select ${id},${experiment},${JSON.stringify(plan)}::jsonb,${hash(canonical(plan))},${hash(plan.baseline)},${hash(plan.candidate)}
        where (select count(*) from chorus_comparisons where experiment_id=${experiment})<50 returning id`;
      if (!rows.length) throw new ExperimentError('LIMIT','Comparison limit reached. Start a child experiment.');
      return {id};
    },
    comparison,
    async results(vault: string, id: string) {
      const row=await comparison(vault,id);
      const trials=await sql<any>`select id,comparison_id,ordinal,case_id,repetition,side,status,request_hash,output_hash,response_id,response_model,usage,assessment,error,reserved_micro,observed_micro,latency_ms,started_at,finished_at from chorus_trials where comparison_id=${id} order by ordinal`;
      return {...row,trials,report:comparisonReport(trials,row.plan.maxCalls)};
    },
    async pause(vault: string,id: string) {
      await comparison(vault,id);
      await sql`update chorus_comparisons set status='paused' where id=${id} and status in ('ready','running')`;
    },
    async resume(vault: string,id: string) {
      await comparison(vault,id);
      await sql`update chorus_comparisons set status='ready' where id=${id} and status='paused'`;
    },
    async claim(vault: string,comparisonId: string,ordinal: number,request: unknown,reserved: number,dailyLimit: number) {
      const [row]=await sql<{trial:any}>`select chorus_claim_trial(${vault}::uuid,${comparisonId}::uuid,${ordinal},${crypto.randomUUID()}::uuid,
        ${JSON.stringify(request)}::jsonb,${hash(canonical(request))},${reserved}::bigint,${dailyLimit}::bigint) as trial`;
      return row?.trial??null;
    },
    async finish(vault: string,trialId: string,result: unknown) {
      const [row]=await sql<{ok:boolean}>`select chorus_finish_trial(${vault}::uuid,${trialId}::uuid,${JSON.stringify(result)}::jsonb) as ok`;
      if (!row?.ok) throw new ExperimentError('STALE_RESULT','The trial is already terminal or its execution lease was lost. No record was overwritten.',409);
    },
  };
}
