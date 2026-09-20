import type { Sql } from '../../db.ts';
import { readJsonLimited } from '../http-body.ts';
import { validSitId } from '../mcp-url.ts';
import { fixtureFor } from '../fixtures.ts';
import { ExperimentError,id,integer,makePlan,text } from './contracts.ts';
import { experimentsStore } from './storage.ts';
import { authorizeRunner,executeNext,runnerConfiguration } from './runner.ts';
export async function experimentHttp(request:Request,sql:Sql,env:Record<string,string|undefined>,transport:typeof fetch=fetch) {
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
  try {
    const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
    if (site==='cross-site'||site==='same-site'||(origin?origin!==new URL(request.url).origin:site!=='same-origin')) throw new ExperimentError('FORBIDDEN','Same-origin requests are required.',403);
    const store=experimentsStore(sql);
    if (request.method==='GET') return reply({runner:runnerConfiguration(env),retention:'Saved experiments have no automatic TTL. Keep a recovery-key backup.',publicPilot:true});
    if (request.method!=='POST') return reply({error:'Method not allowed'},405);
    const body=await readJsonLimited(request,2_100_000) as Record<string,unknown>;
    if (!body||typeof body!=='object'||Array.isArray(body)) throw new ExperimentError('INVALID_INPUT','Expected a JSON object.');
    if (body.action==='create_vault') return reply(await store.createVault(),201);
    const vault=await store.authenticate((request.headers.get('authorization')||'').replace(/^Bearer /,''));
    switch(body.action) {
      case 'list': return reply(await store.list(vault));
      case 'create': return reply(await store.create(vault,body),201);
      case 'detail': return reply(await store.detail(vault,id(body.experimentId),integer(body.after??0,'Cursor',0,Number.MAX_SAFE_INTEGER)));
      case 'checkpoint': return reply(await store.checkpoint(vault,id(body.experimentId),integer(body.checkpointId,'Checkpoint',1,Number.MAX_SAFE_INTEGER)));
      case 'save_client': return reply(await store.saveClient(vault,id(body.experimentId),body.snapshot));
      case 'pin': {
        const sit=text(body.sittingId,'Sitting',80);
        if (!validSitId(sit)) throw new ExperimentError('INVALID_SITTING','Use the full sitting identifier.');
        return reply(await store.pin(vault,id(body.experimentId),sit));
      }
      case 'child': {
        const lab=text(body.labId,'Lab',40);fixtureFor(lab);
        return reply(await store.child(vault,id(body.experimentId),lab),201);
      }
      case 'delete': { const experiment=id(body.experimentId); if(body.confirmation!==`DELETE ${experiment}`) throw new ExperimentError('CONFIRMATION_REQUIRED','Explicit experiment deletion confirmation is required.'); return reply(await store.remove(vault,experiment)); }
      case 'export': return reply(await store.export(vault,id(body.experimentId)));
      case 'create_comparison': {
        const policy=authorizeRunner(env,request.headers.get('x-chorus-execution-key'));
        return reply(await store.createComparison(vault,id(body.experimentId),makePlan(body,policy)),201);
      }
      case 'receipt': return reply(await store.receipt(vault,id(body.trialId)));
      case 'results': return reply(await store.results(vault,id(body.comparisonId)));
      case 'pause': await store.pause(vault,id(body.comparisonId));return reply({paused:true});
      case 'resume': authorizeRunner(env,request.headers.get('x-chorus-execution-key'));await store.resume(vault,id(body.comparisonId));return reply({resumed:true});
      case 'next_trial': {
        const policy=authorizeRunner(env,request.headers.get('x-chorus-execution-key'));
        return reply(await executeNext(sql,vault,id(body.comparisonId),policy,env.CHORUS_RUNNER_API_KEY!,integer(body.expectedOrdinal,'Trial ordinal',0,100),transport));
      }
      default: throw new ExperimentError('UNKNOWN_ACTION','Unsupported experiment action.');
    }
  } catch(err) {
    if (err instanceof ExperimentError) return reply({error:err.message,code:err.code},err.status);
    const message=err instanceof Error?err.message:'';
    if (message.startsWith('Saved checkpoint quota reached')) return reply({error:'Saved checkpoint quota reached. Existing data is preserved. Export and explicitly delete unneeded saved experiments to release space.',code:'STORAGE_LIMIT'},409);
    if (message.startsWith('Delete or export child experiments first')) return reply({error:'This experiment has children. Export and delete child experiments first.',code:'HAS_CHILDREN'},409);
    if (message.startsWith('Cannot delete an experiment with an unresolved active trial')) return reply({error:'An execution is unresolved. Inspect its receipts before deleting.',code:'ACTIVE_EXECUTION'},409);
    return reply({error:'Experiment operation failed; no success or score was assumed. Retry a read to inspect the stored state.',code:'STORAGE_OR_INPUT_ERROR'},500);
  }
}
