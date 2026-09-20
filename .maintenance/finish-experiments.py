from pathlib import Path

def change(path,old,new):
 p=Path(path);s=p.read_text();assert s.count(old)==1,(path,s.count(old));p.write_text(s.replace(old,new))
change('src/lib/chorus/experiments/runner.ts',"prior.some(t=>t.status==='completed'&&t.response_model!==value.model)","prior.some((t: {status:string;response_model?:string})=>t.status==='completed'&&t.response_model!==value.model)")
change('src/lib/chorus/experiments/storage.ts',"where id=${id} and status='paused' and active_trial is null","where id=${id} and status='paused'")
change('src/lib/chorus/experiments/http.ts',
 "    if (err instanceof ExperimentError) return reply({error:err.message,code:err.code},err.status);",
 """    if (err instanceof ExperimentError) return reply({error:err.message,code:err.code},err.status);
    const message=err instanceof Error?err.message:'';
    if (message.startsWith('Saved checkpoint quota reached')) return reply({error:'Saved checkpoint quota reached. Existing data is preserved. Export and explicitly delete unneeded saved experiments to release space.',code:'STORAGE_LIMIT'},409);
    if (message.startsWith('Delete or export child experiments first')) return reply({error:'This experiment has children. Export and delete child experiments first.',code:'HAS_CHILDREN'},409);
    if (message.startsWith('Cannot delete an experiment with an unresolved active trial')) return reply({error:'An execution is unresolved. Inspect its receipts before deleting.',code:'ACTIVE_EXECUTION'},409);""")
p=Path('tests/experiments-storage.test.ts');p.write_text(p.read_text()+'''
it('recovers a paused abandoned lease without issuing another provider call',async()=>{
  const id=await fresh(),p=(await store.comparison(vault,id)).plan;
  await store.claim(vault,id,0,requestFor(p,0),10000,5_000_000);await store.pause(vault,id);
  await sql`update chorus_comparisons set lease_until=now()-interval '1 second' where id=${id}`;
  await store.resume(vault,id);let calls=0;
  const r=await executeNext(sql,vault,id,policy,'api-key-secret',1,async()=>{calls++;throw Error('must not execute');});
  assert.equal(calls,0);assert.equal(r.status,'needs_review');assert.equal(r.trials[0].status,'unknown');
});
''')
p=Path('src/lib/chorus/experiments/contracts.ts');s=p.read_text();s="import { readMerge } from '../artifact-text.ts';\n"+s;s+='''
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
''';p.write_text(s)
change('src/components/chorus/experiments.tsx',"import { PILOT_CASES, PILOT_VERSION } from '@/lib/chorus/experiments/pilot';","import { PILOT_CASES, PILOT_VERSION } from '@/lib/chorus/experiments/pilot';\nimport { checkpointArtifact } from '@/lib/chorus/experiments/contracts';")
change('src/components/chorus/experiments.tsx',"  const artifact=checkpoint?.payload?.current||checkpoint?.payload?.synthesis?.deliverable||checkpoint?.payload?.pastedArtifact||'';","  const artifact=checkpointArtifact(checkpoint?.payload);")
p=Path('src/components/chorus/experiments.tsx');s=p.read_text();assert s.count('maxLength={24000}')==2;s=s.replace('maxLength={24000}','');s=s.replace('baseline.length<8||candidate.length<8||hypothesis.trim().length<12','baseline.length<8||candidate.length<8||baseline.length>24000||candidate.length>24000||hypothesis.trim().length<12');p.write_text(s)
p=Path('src/lib/chorus/experiments.test.ts');p.write_text(p.read_text()+'''
import { checkpointArtifact } from './experiments/contracts.ts';
it('checkpoint extraction chooses the full new synthesis, not the old scored artifact',()=>{
 const full='Complete new rule '.repeat(600);
 assert.equal(checkpointArtifact({current:'old artifact',orchestra:{filled:{synthesizer:JSON.stringify({deliverable:full})}}}),full);
 assert.equal(checkpointArtifact({current:'old artifact',orchestra:{filled:{synthesizer:'{"deliverable":"incomplete'}}}), '');
 assert.equal(checkpointArtifact({merge:full}),full);
 assert.equal(checkpointArtifact({synthesis:{deliverable:full}}),full);
});
''')
