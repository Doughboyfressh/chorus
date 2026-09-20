import { createFileRoute } from '@tanstack/react-router';
import { experimentHttp } from '@/lib/chorus/experiments/http';
import { requireDurableDatabase } from '@/lib/chorus/durable-storage';
async function handler({request}:{request:Request}) {
  try {
    requireDurableDatabase(process.env);
    const {getSql}=await import('@/lib/db');
    return await experimentHttp(request,await getSql(),process.env);
  } catch {
    return new Response(JSON.stringify({error:'Durable experiment storage is unavailable. Nothing was reported saved.'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
}
export const Route=createFileRoute('/api/experiments')({server:{handlers:{GET:handler,POST:handler}}});
