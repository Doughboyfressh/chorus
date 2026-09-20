import { createFileRoute } from '@tanstack/react-router';
import { ExperimentsApp } from '@/components/chorus/experiments';
export const Route=createFileRoute('/experiments')({component:ExperimentsApp,head:()=>({meta:[{title:'Experiments · Chorus'},{name:'referrer',content:'no-referrer'}]})});
