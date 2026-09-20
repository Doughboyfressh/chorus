import { timingSafeEqual } from 'node:crypto';
import { canonical, ExperimentError, requestFor, reservationMicro, type RunnerPolicy, type ComparisonPlan } from './contracts.ts';
import { assessPilot } from './pilot.ts';
import { experimentsStore, hash } from './storage.ts';
import type { Sql } from '../../db.ts';
export const PROVIDER_URL='https://api.openai.com/v1/chat/completions';
export const RUNNER_ENV=['CHORUS_RUNNER_API_KEY','CHORUS_RUNNER_ACCESS_KEY','CHORUS_RUNNER_MODEL','CHORUS_RUNNER_INPUT_USD_PER_MILLION','CHORUS_RUNNER_OUTPUT_USD_PER_MILLION','CHORUS_RUNNER_DAILY_USD'] as const;
export function runnerConfiguration(env: Record<string,string|undefined>) {
  const missing=RUNNER_ENV.filter(key=>!env[key]?.trim());
  if (env.CHORUS_RUNNER_ENABLED!=='true') missing.unshift('CHORUS_RUNNER_ENABLED' as typeof RUNNER_ENV[number]);
  const numeric=(name:string)=>Number(env[name]);
  const policy:RunnerPolicy={model:env.CHORUS_RUNNER_MODEL?.trim()||'',outputTokens:1200,
    inputUsdPerMillion:numeric('CHORUS_RUNNER_INPUT_USD_PER_MILLION'),outputUsdPerMillion:numeric('CHORUS_RUNNER_OUTPUT_USD_PER_MILLION'),
    dailyUsd:numeric('CHORUS_RUNNER_DAILY_USD'),timeoutMs:40000};
  const valid= !missing.length && (env.CHORUS_RUNNER_ACCESS_KEY?.length??0)>=32 && (env.CHORUS_RUNNER_API_KEY?.length??0)>=16 &&
    /^[a-zA-Z0-9._:-]{1,120}$/.test(policy.model) && [policy.inputUsdPerMillion,policy.outputUsdPerMillion,policy.dailyUsd].every(n=>Number.isFinite(n)&&n>0&&n<=1000);
  return {ready:valid,missing,policy:valid?policy:null};
}
export function authorizeRunner(env: Record<string,string|undefined>,key: string|null): RunnerPolicy {
  const config=runnerConfiguration(env);
  if (!config.ready||!config.policy) throw new ExperimentError('RUNNER_NOT_CONFIGURED','Controlled execution is disabled until the operator configures a provider, access key and budgets. Saving works independently.',503);
  const actual=env.CHORUS_RUNNER_ACCESS_KEY!;
  if (!key||Buffer.byteLength(key)!==Buffer.byteLength(actual)||!timingSafeEqual(Buffer.from(key),Buffer.from(actual))) throw new ExperimentError('RUNNER_FORBIDDEN','An operator execution key is required for paid model calls.',403);
  return config.policy;
}
async function limitedBody(response: Response) {
  if (!response.body) return '';
  const reader=response.body.getReader(); const parts: Uint8Array[]=[];let total=0;
  try { for (;;) { const {done,value}=await reader.read(); if (done) break; total+=value.length;
    if (total>1_000_000) {await reader.cancel();throw new Error('Provider response exceeded the 1 MB receipt limit. No output was scored.');} parts.push(value);
  } } finally {reader.releaseLock();}
  const data=new Uint8Array(total);let at=0;for (const part of parts){data.set(part,at);at+=part.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(data);
}
/** No caller can supply results to this runner. It records the direct provider response once. */
export async function executeNext(sql: Sql,vault: string,comparisonId: string,policy: RunnerPolicy,apiKey: string,expectedOrdinal: number,transport: typeof fetch=fetch) {
  const store=experimentsStore(sql), comparison=await store.comparison(vault,comparisonId), plan=comparison.plan as ComparisonPlan;
  if (canonical(plan.policy)!==canonical(policy)) throw new ExperimentError('POLICY_CHANGED','The operator policy changed. Preserve this comparison and create a new one; its conditions cannot be relabeled.',409);
  if (hash(canonical(plan))!==comparison.plan_hash) throw new ExperimentError('PLAN_CHANGED','The frozen plan no longer matches its digest.',409);
  const ordinal=comparison.next_ordinal;
  if (ordinal!==expectedOrdinal) return store.results(vault,comparisonId);
  // Claim also detects abandoned leases. Completed comparisons never call a provider.
  const request=ordinal<plan.schedule.length?requestFor(plan,ordinal):{};
  const reserved=reservationMicro(request,policy);
  const trial=await store.claim(vault,comparisonId,ordinal,request,reserved,Math.floor(policy.dailyUsd*1e6));
  if (!trial) return store.results(vault,comparisonId);
  const started=Date.now(); let raw:string|null=null;
  let result: Record<string,unknown>={status:'transport_error',error:'Execution did not finish.'};
  try {
    const response=await transport(PROVIDER_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(policy.timeoutMs),
      headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},body:canonical(request)});
    raw=await limitedBody(response);
    // Never persist a credential accidentally echoed by a provider error.
    raw=raw.split(apiKey).join('[REDACTED_CREDENTIAL]');
    if (!response.ok) result={status:'transport_error',error:`Provider returned HTTP ${response.status}. The call is retained, not retried.`};
    else {
      const value=JSON.parse(raw), choice=value.choices?.[0], output=choice?.message?.content;
      const usage=value.usage;
      const usageValid=usage&&Number.isSafeInteger(usage.prompt_tokens)&&usage.prompt_tokens>=0&&Number.isSafeInteger(usage.completion_tokens)&&usage.completion_tokens>=0;
      const assessment=typeof output==='string'?assessPilot(plan.cases[plan.schedule[ordinal].caseIndex],output):null;
      const prior=(await store.results(vault,comparisonId)).trials;
      const modelChanged=prior.some((t: {status:string;response_model?:string})=>t.status==='completed'&&t.response_model!==value.model);
      const valid=!modelChanged&&choice?.finish_reason==='stop'&&assessment?.status==='scored'&&usageValid&&typeof value.id==='string'&&typeof value.model==='string';
      result={status:valid?'completed':'invalid',output:typeof output==='string'?output:null,output_hash:typeof output==='string'?hash(output):null,
        response_id:typeof value.id==='string'?value.id:null,response_model:typeof value.model==='string'?value.model:null,
        usage:usageValid?{prompt_tokens:usage.prompt_tokens,completion_tokens:usage.completion_tokens}:null,assessment,
        observed_micro:usageValid?Math.ceil(usage.prompt_tokens*policy.inputUsdPerMillion+usage.completion_tokens*policy.outputUsdPerMillion):null,
        error:valid?null:modelChanged?'The provider-reported model changed within this frozen comparison. Review the receipts; no automatic continuation.':assessment?.error||'Provider output was incomplete, refused, missing usage or incompatible with the frozen output protocol.'};
    }
  } catch(err) {
    result={status:'transport_error',error:err instanceof Error?err.message.split(apiKey).join('[REDACTED_CREDENTIAL]'):'Provider request failed. Outcome may be unknown.'};
  }
  // A storage failure is surfaced. Its lease becomes unknown; it is never silently executed twice.
  await store.finish(vault,trial.id,{...result,response_raw:raw,latency_ms:Date.now()-started});
  return store.results(vault,comparisonId);
}
