import {supabaseService} from '@/lib/supabase/service'
import type {EdielBusinessExpectation,EdielBusinessExpectationScope} from '@/lib/ediel/businessExpectations'
export {EDIEL_METERING_METHOD_EXPECTATION_CONSTRAINTS,prepareEdielMeteringMethodExpectationPlan,type EdielMeteringMethodExpectationPlan} from '@/lib/ediel/meteringMethodExpectationPolicy'

async function methodExpectations(input:EdielBusinessExpectationScope & {action:'register'|'read'|'observe'|'expire';messageId?:string;limit?:number}):Promise<EdielBusinessExpectation[]> {
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name:'gridex_ediel_metering_method_expectations_v1',args:{p_input:Record<string,unknown>}) => PromiseLike<{data:unknown;error:{message:string}|null}>
  const {data,error} = await rpc('gridex_ediel_metering_method_expectations_v1',{p_input:input})
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('ediel_metering_method_expectation_result_invalid')
  return data as EdielBusinessExpectation[]
}
export function registerEdielMeteringMethodExpectation(input:EdielBusinessExpectationScope & {messageId:string}) {return methodExpectations({...input,action:'register'})}
export function readEdielMeteringMethodExpectations(input:EdielBusinessExpectationScope & {messageId?:string;limit?:number}) {return methodExpectations({...input,action:'read'})}
export function observeEdielMeteringMethodExpectations(input:EdielBusinessExpectationScope & {messageId:string}) {return methodExpectations({...input,action:'observe'})}
export function expireEdielMeteringMethodExpectations(input:EdielBusinessExpectationScope & {limit?:number}) {return methodExpectations({...input,action:'expire'})}
