import { readMerge } from '../artifact-text.ts';
import { PILOT_CASES, PILOT_VERSION, PILOT_GRADER, PILOT_PROTOCOL } from './pilot.ts';
export const EXPERIMENT_VERSION = 1;
export const WORKSPACE_KEY = /^cv_[a-f0-9]{64}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ExperimentError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status=400) { super(message); this.code=code; this.status=status; }
}
export function text(value: unknown, label: string, max: number, min=1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new ExperimentError('INVALID_INPUT', `${label} must contain ${min}–${max} characters.`);
  return value;
}
export function id(value: unknown) { if (typeof value !== 'string' || !UUID.test(value)) throw new ExperimentError('INVALID_ID','Invalid experiment identifier.'); return value; }
export function integer(value: unknown, label: string, min: number, max: number) {
  if (!Number.isInteger(value) || Number(value)<min || Number(value)>max) throw new ExperimentError('INVALID_INPUT',`${label} must be an integer from ${min} to ${max}.`);
  return Number(value);
}
export type RunnerPolicy = { model: string; outputTokens: number; inputUsdPerMillion: number; outputUsdPerMillion: number; dailyUsd: number; timeoutMs: number };
export type ComparisonPlan = { v: 1; datasetVersion: string; graderVersion: string; exposure: 'public'; protocol: string;
  baseline: string; candidate: string; hypothesis: string; repeats: number; maxCalls: number; maxUsd: number; maxSeconds: number; policy: RunnerPolicy;
  cases: typeof PILOT_CASES; schedule: { caseIndex: number; repetition: number; side: 'baseline' | 'candidate' }[] };
export function makePlan(args: Record<string, unknown>, policy: RunnerPolicy): ComparisonPlan {
  const baseline=text(args.baseline,'Baseline',24000,8), candidate=text(args.candidate,'Candidate',24000,8);
  if (baseline.normalize('NFKC').replace(/\s+/g,' ').trim() === candidate.normalize('NFKC').replace(/\s+/g,' ').trim()) throw new ExperimentError('IDENTICAL_ARTIFACTS','Use two different artifact versions.');
  const repeats=integer(args.repeats??1,'Repetitions',1,3), maxSeconds=integer(args.maxSeconds??1800,'Time budget',60,21600);
  const maxUsd=Number(args.maxUsd??1);
  if (!Number.isFinite(maxUsd)||maxUsd<=0||maxUsd>25) throw new ExperimentError('INVALID_BUDGET','Estimated spending limit must be above $0 and at most $25.');
  const schedule: ComparisonPlan['schedule']=[];
  for (let r=0;r<repeats;r++) PILOT_CASES.forEach((_,caseIndex) => {
    const sides = (r+caseIndex)%2 ? ['candidate','baseline'] as const : ['baseline','candidate'] as const;
    sides.forEach(side=>schedule.push({caseIndex,repetition:r+1,side}));
  });
  return { v:1,datasetVersion:PILOT_VERSION,graderVersion:PILOT_GRADER,exposure:'public',protocol:PILOT_PROTOCOL,baseline,candidate,
    hypothesis:text(args.hypothesis,'Change hypothesis',2000,12), repeats, maxCalls:schedule.length, maxUsd,maxSeconds,policy,cases:PILOT_CASES,schedule };
}
export function requestFor(plan: ComparisonPlan, ordinal: number) {
  const trial=plan.schedule[ordinal];
  if (!trial) throw new ExperimentError('COMPLETE','No further trial is scheduled.',409);
  return { model:plan.policy.model, messages:[{role:'system',content:plan[trial.side]}, {role:'user',content:`${plan.protocol}\n\nSOURCE:\n${plan.cases[trial.caseIndex].code}`}],
    max_completion_tokens:plan.policy.outputTokens, store:false, stream:false, n:1, service_tier:'default' };
}
export function reservationMicro(request: unknown, policy: RunnerPolicy) {
  // Deliberately conservative byte-based estimate, not a promise about provider billing.
  const inputBound=new TextEncoder().encode(JSON.stringify(request)).length+4096;
  return Math.ceil(inputBound*policy.inputUsdPerMillion+policy.outputTokens*policy.outputUsdPerMillion);
}
export function redactSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSnapshot);
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(apiKey|token|authorization|password|secret|lock|accessKey|recoveryKey)$/i.test(key)).map(([key,v])=>[key,redactSnapshot(v)]));
  return value;
}
export function safeSnapshot(value: unknown) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ExperimentError('INVALID_SNAPSHOT','Expected a saved run object.');
  const payload=JSON.stringify(redactSnapshot(value));
  if (new TextEncoder().encode(payload).length>2_000_000) throw new ExperimentError('TOO_LARGE','Snapshot exceeds 2 MB.');
  return payload;
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}

/** Return a complete current deliverable, never a repaired fragment or a stale scored predecessor. */
export function checkpointArtifact(payload: unknown): string {
  if (!payload||typeof payload!=='object'||Array.isArray(payload)) return '';
  const p=payload as Record<string,any>;
  if (typeof p.orchestra?.filled?.synthesizer==='string') {
    try {return readMerge(p.orchestra.filled.synthesizer).deliverable;} catch {return '';}
  }
  const value=p.synthesis?.deliverable||p.merge||p.current||p.pastedArtifact;
  return typeof value==='string'&&value.length<=24000?value:'';
}
