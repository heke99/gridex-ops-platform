import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
export type RegistryDiffRecord={name:string;legalName?:string|null;market?:string|null;countryCode?:string|null;orgNumber?:string|null;edielId?:string|null;svkId?:string|null;eic?:string|null;roles:string[];routes:Array<Record<string,unknown>>}
export type RegistrySnapshot={snapshotHash:string;actors:Array<RegistryDiffRecord&{actorId:string}>}
const scalar=(v:unknown)=>v===undefined||v===null||v===''?null:v
const routeKeys=['messageFamily','environment','applicationReference','subaddress','communicationType','communicationAddress','partyId','interchangePartyId','partyIdQualifier','partyIdResponsible','interchangeIdQualifier','ediCharset','ediSyntax']
const route=(v:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(routeKeys.map(key=>[key,key==='environment'?v[key]??'production':scalar(v[key]) ])))
/** Source absence does not order deletion or unverify a manual route. Compare
 * specified source values and route identity/security fields, not import clocks
 * or readiness/metadata flags. Same names/organization numbers do not join. */
export function diffRegistryRecord(incoming:RegistryDiffRecord,current:RegistryDiffRecord):string[]{
 const changed:string[]=[]
 for(const key of ['name','market','countryCode','orgNumber','svkId','eic'] as const)if(scalar(incoming[key])!==null&&scalar(incoming[key])!==scalar(current[key]))changed.push(key)
 if(incoming.legalName&&incoming.legalName!==current.legalName)changed.push('legalName')
 const roles=new Set(current.roles)
 if(incoming.roles.some(role=>!roles.has(role)))changed.push('roles')
 const routes=new Set(current.routes.map(route))
 if(incoming.routes.some(r=>!routes.has(route(r))))changed.push('routes')
 return changed
}
export async function readRegistryPreviewSnapshot(actorUserId:string,edielIds:string[]):Promise<RegistrySnapshot>{
 const {data,error}=await supabaseService.rpc('ediel_read_registry_preview_snapshot_v1',{p_actor_user_id:actorUserId,p_ediel_ids:[...new Set(edielIds)]})
 if(error)throw error
 const v=data as RegistrySnapshot|null
 if(!v||!Array.isArray(v.actors)||!/^[a-f0-9]{64}$/.test(v.snapshotHash)||v.actors.some(a=>!a.actorId||!a.edielId||!Array.isArray(a.roles)||!Array.isArray(a.routes)))throw Error('ediel_registry_preview_snapshot_unconfirmed')
 // The native hash binds the PostgreSQL JSON representation; local hashing is
 // reserved for comparisons and is not a substitute for that private read.
 return v
}
export const registryDiffFingerprint=(value:RegistryDiffRecord)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
