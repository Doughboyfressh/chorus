import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { SiteFooter, SiteHeader } from './chrome';
import { adoptMcpSit, loadMcpSit } from '@/lib/chorus/mcp-url';
import { loadSession, useChorus } from '@/lib/chorus/store';
import { PILOT_CASES, PILOT_VERSION } from '@/lib/chorus/experiments/pilot';
import { checkpointArtifact } from '@/lib/chorus/experiments/contracts';

const VAULT='chorus.experiment.vault.v1';
const field='mt-2 min-h-11 w-full rounded-xl border border-border bg-bg p-3 text-sm text-fg';
const button='min-h-11 rounded-xl border border-border px-4 py-2 text-sm text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40';
const card='min-w-0 rounded-3xl bg-surface p-5 shadow-[var(--shadow-border)] sm:p-6';
function download(name:string,value:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function ExperimentsApp() {
  const navigate=useNavigate();
  const [key,setKey]=useState(''),[keyDraft,setKeyDraft]=useState(''),[rows,setRows]=useState<any[]>([]),[selected,setSelected]=useState<any>(null);
  const [checkpoint,setCheckpoint]=useState<any>(null),[comparison,setComparison]=useState<any>(null),[config,setConfig]=useState<any>(null);
  const [name,setName]=useState('Prompt review experiment'),[hypothesis,setHypothesis]=useState(''),[baseline,setBaseline]=useState(''),[candidate,setCandidate]=useState('');
  const [repeats,setRepeats]=useState(1),[usd,setUsd]=useState('1'),[executionKey,setExecutionKey]=useState(''),[lab,setLab]=useState('prompt');
  const [busy,setBusy]=useState(false),[running,setRunning]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const guard=useRef(false),stop=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;try {setKey(localStorage.getItem(VAULT)||'');}catch{}
    void fetch('/api/experiments').then(r=>r.json()).then(setConfig).catch(()=>setError('Experiment service could not be reached.'));
    return ()=>{mounted.current=false;stop.current=true;};},[]);
  async function api(action:string,body:Record<string,unknown>={},credential=key) {
    const res=await fetch('/api/experiments',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${credential}`,...(executionKey?{'x-chorus-execution-key':executionKey}:{})},body:JSON.stringify({action,...body})});
    const data=await res.json();if (!res.ok) throw new Error(data.error||`Request failed (${res.status}).`);return data;
  }
  async function refresh(credential=key) {setRows(await api('list',{},credential));}
  useEffect(()=>{if (key) void refresh(key).catch(e=>setError(e.message));},[key]); // credential is the only vault identity
  async function work(fn:()=>Promise<void>) {if (guard.current) return;guard.current=true;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Request failed.');}finally{guard.current=false;if(mounted.current)setBusy(false);}}
  async function exportExperiment() {
    const data=await api('export',{experimentId:selected.id});
    const checkpoints=[];
    for(const row of data.checkpoints) checkpoints.push(await api('checkpoint',{experimentId:selected.id,checkpointId:row.id}));
    const comparisons=[];
    for(const row of data.comparisons) {
      const value=await api('results',{comparisonId:row.id}); const receipts=[];
      for(const trial of value.trials) receipts.push(await api('receipt',{trialId:trial.id}));
      comparisons.push({...value,trials:receipts});
    }
    const payload={...data,checkpoints,comparisons,note:'Complete private snapshot backup at export time. Keep sitting capabilities private. No clean-training authorization.'};
    download('chorus-experiment.json',payload);
  }
  async function detail(id:string) {setSelected(await api('detail',{experimentId:id}));setCheckpoint(null);setComparison(null);}
  function remember(value:string) {setKey(value);setKeyDraft('');try{localStorage.setItem(VAULT,value);}catch{setMessage('Browser storage is unavailable. Download the recovery key now; it will not survive closing this page.');}}
  async function continueRun() {
    if (!comparison||guard.current) return;
    guard.current=true;stop.current=false;setRunning(true);setError('');
    try {
      await api('resume',{comparisonId:comparison.id});
      let current=await api('results',{comparisonId:comparison.id});
      while (!stop.current&&mounted.current&&['ready','running'].includes(current.status)) {
        const prior=current.next_ordinal;
        current=await api('next_trial',{comparisonId:current.id,expectedOrdinal:prior});
        if(mounted.current)setComparison(current);
        if(current.next_ordinal===prior) break; // another request owns the lease or a budget stopped execution
      }
      if(stop.current) await api('pause',{comparisonId:comparison.id});
    } catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Execution interrupted. Reload results before resuming.');}
    finally{guard.current=false;if(mounted.current)setRunning(false);}
  }
  function openSitting(sit:string) {adoptMcpSit(sit);useChorus.getState().setLane('mcp');useChorus.getState().bumpMcpSit();void navigate({to:'/lab'});}
  const artifact=checkpointArtifact(checkpoint?.payload);
  const runnerReady=Boolean(config?.runner?.ready);
  const disabled=busy||running;
  return <div className="min-h-dvh bg-bg text-fg">
    <SiteHeader active="experiments" />
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <header className="max-w-3xl"><p className="font-mono text-xs uppercase tracking-widest text-accent">Saved experiments · Controlled comparisons</p>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">Keep the work. Measure the change.</h1>
        <p className="mt-4 text-muted">Save a sitting without resetting it. Compare two frozen prompts with full receipts, a fixed test plan and explicit spending limits.</p></header>
      {error?<p role="alert" className="rounded-xl border border-warn p-4 text-warn">{error}</p>:null}
      {message?<p role="status" className="rounded-xl border border-border p-4">{message}</p>:null}
      {!key?<section className={card}>
        <h2 className="font-display text-2xl">Your experiment vault</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">A private recovery key protects your saved experiments. Keep it outside this browser to reopen your work on another device. It is not a public sharing link or an account password.</p>
        <div className="mt-4 flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={()=>void work(async()=>{const vault=await api('create_vault');remember(vault.key);setMessage('Vault created. Download the recovery key before relying on this browser.');})}>Create private vault</button></div>
        <label className="mt-5 block max-w-xl text-sm">Restore with recovery key<input type="password" autoComplete="off" className={field} value={keyDraft} onChange={e=>setKeyDraft(e.target.value)} placeholder="cv_…" /></label>
        <button className={`${button} mt-3`} disabled={busy||!keyDraft} onClick={()=>void work(async()=>{await api('list',{},keyDraft.trim());remember(keyDraft.trim());})}>Unlock saved experiments</button>
      </section>:<>
        <div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-muted">Vault unlocked on this browser</span>
          <button className={button} disabled={disabled} onClick={()=>download('chorus-vault-recovery.json',{recoveryKey:key,warning:'Private access credential. Do not share or commit this file.'})}>Download recovery key</button>
          <button className={button} disabled={disabled} onClick={()=>{localStorage.removeItem(VAULT);setKey('');setRows([]);setSelected(null);setComparison(null);setExecutionKey('');}}>Lock this browser</button></div>
        <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className={`${card} space-y-5`}>
            <h2 className="font-display text-2xl">Experiments</h2>
            <label className="block text-sm">Name<input className={field} value={name} onChange={e=>setName(e.target.value)} maxLength={120} /></label>
            <button className={button} disabled={disabled||!name.trim()} onClick={()=>void work(async()=>{const e=await api('create',{name});await refresh();await detail(e.id);})}>New saved experiment</button>
            <div className="space-y-2">{rows.map(row=><button key={row.id} disabled={disabled} className={`block w-full break-words rounded-xl border p-3 text-left text-sm ${selected?.id===row.id?'border-accent bg-surface-2':'border-border'}`} onClick={()=>void work(()=>detail(row.id))}>{row.name}<span className="mt-1 block text-xs text-muted">{new Date(row.created_at).toLocaleDateString()}</span></button>)}</div>
          </aside>
          <div className="min-w-0 space-y-6">
          {!selected?<section className={card}><h2 className="font-display text-2xl">Start with saved work</h2><p className="mt-2 text-muted">Choose or create an experiment. Saved sittings are exempt from temporary retention limits; their checkpoints remain after an explicit sitting reset.</p></section>:<>
            <section className={card}><h2 className="break-words font-display text-2xl">{selected.name}</h2>
              <p className="mt-2 text-sm text-muted">No automatic deletion. Server-observed host submissions are not verified model executions. Older truncated evidence cannot be reconstructed.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button className={button} disabled={disabled} onClick={()=>void work(async()=>{await api('pin',{experimentId:selected.id,sittingId:loadMcpSit()});await detail(selected.id);setMessage('Current MCP sitting saved. Future confirmed changes are checkpointed automatically.');})}>Save current MCP sitting</button>
                <button className={button} disabled={disabled} onClick={()=>void work(async()=>{const snapshot=useChorus.getState().run||loadSession();if(!snapshot)throw new Error('There is no browser run to save.');await api('save_client',{experimentId:selected.id,snapshot});await detail(selected.id);setMessage('Browser snapshot saved as client-supplied, unverified data.');})}>Save browser snapshot</button>
                <button className={button} disabled={disabled} onClick={()=>void work(exportExperiment)}>Export complete experiment</button>
                <button className={button} disabled={disabled} onClick={()=>void work(async()=>{const child=await api('create',{name:`${selected.name} · next` .slice(0,120),parentId:selected.id});await refresh();await detail(child.id);})}>New child experiment</button>
              </div>
              <details className="mt-4 text-sm text-muted"><summary className="cursor-pointer">Delete this saved experiment</summary><p className="mt-2">Export first. Deletion is permanent, removes saved receipts and unpins linked sittings. It does not reset the live sittings. Experiments with children or an unresolved active call cannot be deleted.</p><button className={`${button} mt-3`} disabled={disabled} onClick={()=>void work(async()=>{if(window.prompt('Type DELETE to permanently remove this saved experiment.')!=='DELETE')return;await api('delete',{experimentId:selected.id,confirmation:`DELETE ${selected.id}`});setSelected(null);setComparison(null);await refresh();})}>Permanently delete saved experiment</button></details>
              <div className="mt-5 flex flex-wrap items-end gap-3"><label className="text-sm">New child sitting<select className={field} value={lab} onChange={e=>setLab(e.target.value)}>{['prompt','rsi','eval','stress','data','generic'].map(x=><option key={x}>{x}</option>)}</select></label>
                <button className={button} disabled={disabled} onClick={()=>void work(async()=>{const child=await api('child',{experimentId:selected.id,labId:lab});openSitting(child.sittingId);})}>Create without wiping</button></div>
              <div className="mt-5 space-y-2">{selected.sittings?.map((s:any)=><div key={s.sitting_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-bg p-3 text-sm"><span>Saved sitting · {s.sitting_id.slice(0,8)}</span><button className={button} disabled={disabled} onClick={()=>openSitting(s.sitting_id)}>Resume sitting</button></div>)}</div>
              <details className="mt-5"><summary className="cursor-pointer text-sm">Recorded checkpoints ({selected.checkpoints?.length}{selected.checkpoints?.length===100?'+':''})</summary>
                <div className="mt-3 max-h-64 space-y-2 overflow-auto">{selected.checkpoints?.map((c:any)=><button key={c.id} className={`${button} block w-full text-left`} disabled={disabled} onClick={()=>void work(async()=>setCheckpoint(await api('checkpoint',{experimentId:selected.id,checkpointId:c.id})))}>#{c.id} · {c.provenance==='client_supplied_unverified'?'Browser snapshot':'Host checkpoint'} · {new Date(c.created_at).toLocaleString()}</button>)}</div>
                {selected.checkpoints?.length===100?<button className={`${button} mt-3`} disabled={disabled} onClick={()=>void work(async()=>setSelected(await api('detail',{experimentId:selected.id,after:selected.checkpoints.at(-1).id})))}>Next checkpoint page</button>:null}
              </details>
              {checkpoint?<div className="mt-4"><div className="flex flex-wrap gap-3"><button disabled={disabled||!artifact} className={button} onClick={()=>setBaseline(artifact)}>Use artifact as baseline</button><button disabled={disabled||!artifact} className={button} onClick={()=>setCandidate(artifact)}>Use artifact as candidate</button><button className={button} onClick={()=>download('chorus-checkpoint.json',checkpoint)}>Download checkpoint</button></div><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-bg p-3 text-xs">{JSON.stringify(checkpoint.payload,null,2)}</pre></div>:null}
            </section>
            <section className={card}>
              <h2 className="font-display text-2xl">Prompt A/B pilot</h2>
              <p className="mt-2 text-sm text-muted">{PILOT_CASES.length} public calibration cases: vulnerable code, clean controls and missing context. Both prompts receive the same protocol and cases. No tools or user-submitted code are executed. This is not a private holdout.</p>
              <p className="mt-3 rounded-xl bg-bg p-3 text-sm">{runnerReady?`Controlled runner configured: ${config.runner.policy.model}`:'Paid execution is disabled. Saved experiments still work.'}</p>
              {!runnerReady?<details className="mt-3 text-sm text-muted"><summary className="cursor-pointer">Operator setup required</summary><p className="mt-2">Set the server-only runner configuration described in EXPERIMENTS.md. Do not paste an API key into a prompt or commit it.</p><pre className="mt-2 overflow-auto whitespace-pre-wrap">{config?.runner?.missing?.join('\n')||config?.error||'Loading configuration…'}</pre></details>:null}
              <div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-sm">Original artifact<textarea className={`${field} min-h-40`} value={baseline} onChange={e=>setBaseline(e.target.value)} /><span className="text-xs text-muted">{baseline.length.toLocaleString()} / 24,000 characters</span></label><label className="text-sm">Revised artifact<textarea className={`${field} min-h-40`} value={candidate} onChange={e=>setCandidate(e.target.value)} /><span className="text-xs text-muted">{candidate.length.toLocaleString()} / 24,000 characters</span></label></div>
              <label className="mt-4 block text-sm">What should this change improve?<textarea className={field} value={hypothesis} onChange={e=>setHypothesis(e.target.value)} placeholder="Reduce unsupported findings without increasing missed vulnerabilities." maxLength={2000}/></label>
              <div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="text-sm">Repetitions per case<select className={field} value={repeats} onChange={e=>setRepeats(Number(e.target.value))}>{[1,2,3].map(n=><option key={n}>{n}</option>)}</select></label><label className="text-sm">Estimated spending limit (USD)<input className={field} type="number" min="0.01" max="25" step="0.01" value={usd} onChange={e=>setUsd(e.target.value)}/></label><label className="text-sm">Operator execution key<input type="password" autoComplete="off" className={field} value={executionKey} onChange={e=>setExecutionKey(e.target.value)}/></label></div>
              <p className="mt-3 text-xs text-muted">Plan: {PILOT_CASES.length*2*repeats} calls, 1,200 output tokens per call, 30-minute wall-clock limit. Dollar reservations use operator-supplied prices and conservative estimates, not a provider invoice guarantee. Errors stop the comparison; no best-of-many retries.</p>
              <button className={`${button} mt-4`} disabled={disabled||!runnerReady||!executionKey||baseline.length<8||candidate.length<8||baseline.length>24000||candidate.length>24000||hypothesis.trim().length<12} onClick={()=>void work(async()=>{const created=await api('create_comparison',{experimentId:selected.id,baseline,candidate,hypothesis,repeats,maxUsd:Number(usd),maxSeconds:1800});setComparison(await api('results',{comparisonId:created.id}));setSelected(await api('detail',{experimentId:selected.id}));setMessage('Plan frozen. No model call has been made. Review it, then explicitly start.');})}>Freeze comparison plan · no calls yet</button>
              <details className="mt-5 text-sm"><summary className="cursor-pointer">Inspect public calibration inputs · {PILOT_VERSION}</summary>{PILOT_CASES.map(c=><pre key={c.id} className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-bg p-3 text-xs">{c.id}{'\n'}{c.code}</pre>)}</details>
            </section>
            <section className={card}><h2 className="font-display text-2xl">Comparison records</h2>
              <div className="mt-4 flex flex-wrap gap-2">{selected.comparisons?.map((c:any)=><button key={c.id} className={button} disabled={disabled} onClick={()=>void work(async()=>setComparison(await api('results',{comparisonId:c.id})))}>{c.status} · {c.next_ordinal}/{c.planned_calls}</button>)}</div>
              {comparison?<div className="mt-5 space-y-4"><p className="text-sm">State: <strong>{comparison.status}</strong> · {comparison.report.recorded}/{comparison.report.planned} trials recorded</p>
                <details className="text-sm"><summary className="cursor-pointer">Inspect frozen artifacts and plan</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-bg p-3 text-xs">{JSON.stringify({baseline:comparison.plan.baseline,candidate:comparison.plan.candidate,hypothesis:comparison.plan.hypothesis,policy:comparison.plan.policy,planHash:comparison.plan_hash,baselineHash:comparison.baseline_hash,candidateHash:comparison.candidate_hash},null,2)}</pre></details>
                <p className="text-sm text-muted">{comparison.reason||comparison.report.conclusion}</p>
                <div className="grid gap-3 sm:grid-cols-2">{['baseline','candidate'].map(side=><div key={side} className="rounded-xl bg-bg p-4"><h3 className="capitalize">{side}</h3><p className="mt-2 text-2xl">{comparison.report[side].exactCases}/{comparison.report[side].trials} exact agreements</p><p className="mt-1 text-xs text-muted">{comparison.report[side].fp} false-positive labels · {comparison.report[side].fn} missed labels · {comparison.report[side].tokens} tokens</p></div>)}</div>
                <p className="text-sm">Paired wins / losses / ties: {comparison.report.paired.wins} / {comparison.report.paired.losses} / {comparison.report.paired.ties}. Clean training eligibility: <strong>unavailable</strong>.</p>
                <p className="text-xs text-muted">Metric: {comparison.report.metric} Invalid outputs are not zeros. Reported provider models and complete responses are retained in the export.</p>
                <div className="flex flex-wrap gap-3"><button className={button} disabled={disabled||!runnerReady||!executionKey||!['ready','running','paused'].includes(comparison.status)} onClick={()=>{if(window.confirm(`Authorize this controlled comparison, up to ${comparison.plan.maxCalls} calls and the stated $${comparison.plan.maxUsd} estimated limit?`))void continueRun();}}>Start / resume paid evaluation</button>
                  <button className={button} disabled={!running} onClick={()=>{stop.current=true;void api('pause',{comparisonId:comparison.id}).catch(e=>setError(e.message));}}>Pause after active call</button>
                  <button className={button} disabled={disabled} onClick={()=>void work(async()=>setComparison(await api('results',{comparisonId:comparison.id})))}>Reload receipts</button>
                  <button className={button} disabled={disabled} onClick={()=>void work(async()=>{const data=await api('results',{comparisonId:comparison.id});const receipts=[];for(const t of data.trials)receipts.push(await api('receipt',{trialId:t.id}));download('chorus-comparison-receipts.json',{...data,trials:receipts});})}>Download receipts</button></div>
                <p className="text-xs text-muted">Closing this page stops dispatching new calls. An in-flight call may still finish. An interrupted lease is marked unknown, never automatically replayed. Reopen this vault to inspect and resume.</p>
              </div>:<p className="mt-3 text-sm text-muted">No comparison selected. Saved plans and receipts can be reopened from any device using your recovery key.</p>}
            </section>
          </>}
          </div>
        </div>
      </>}
    </main><SiteFooter/>
  </div>;
}
