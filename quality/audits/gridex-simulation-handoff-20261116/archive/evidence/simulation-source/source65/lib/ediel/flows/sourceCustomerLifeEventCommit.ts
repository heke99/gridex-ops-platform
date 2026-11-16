import type {EdielMessageRow} from '@/lib/ediel/types'
export type SourceCustomerLifeEventCommit=Readonly<{message:EdielMessageRow;actorUserId:string}>
export type SourceCustomerLifeEventCommitObserver=(commit:SourceCustomerLifeEventCommit)=>Promise<unknown>
const committed=new WeakSet<object>()
/** A transient handoff after the native whole-source customer transaction. */
export async function publishSourceCustomerLifeEventCommit(observer:SourceCustomerLifeEventCommitObserver|undefined,fields:SourceCustomerLifeEventCommit){
 if(!observer)return
 const capability=Object.freeze({...fields,message:structuredClone(fields.message)})
 committed.add(capability)
 try{await observer(capability)}catch{/* Source evidence remains explicitly unavailable. */}finally{committed.delete(capability)}
}
export function isSourceCustomerLifeEventCommit(value:unknown):value is SourceCustomerLifeEventCommit{return Boolean(value&&typeof value==='object'&&committed.has(value))}
