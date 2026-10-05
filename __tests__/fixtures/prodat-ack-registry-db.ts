/** Mock only database boundary. Real derive, source owners, resolution and both
 * persistence payloads execute. No live tenant or provider data. */
export function registryDatabase(writes:{table:string;body:Record<string,unknown>}[],rules:Record<string,unknown>[]=[]){
 return (table:string)=>{
  let single=false
  const q:Record<string,unknown>={then:(done:(v:unknown)=>unknown)=>done({data:single?{id:'synthetic-validation'}:table==='ediel_aperak_error_rules'?rules:[],error:null})}
  for(const op of ['select','limit','eq','in','order','or','is','upsert','maybeSingle'])q[op]=(...args:unknown[])=>{if(op==='maybeSingle')single=true;if(op==='upsert')writes.push({table,body:args[0] as Record<string,unknown>});return q}
  return q
 }
}
