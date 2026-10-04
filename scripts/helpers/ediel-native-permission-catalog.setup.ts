import {execFileSync} from 'node:child_process'

// Disposable native stack only. The canonical clean replay deliberately skips
// legacy foundation files that seeded some permission catalog keys in hosted
// environments. Fixtures still grant every permission explicitly per actor;
// this only guarantees the referenced catalog keys exist (reference data,
// never a grant, role or authority row).
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const keys=['communication.read','communication.write','communication.send','contracts.read','contracts.write','customers.read','customers.write',
 'metering.read','metering.write','operations.read','operations.write','documents.read','cases.write']
if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_native_local_only')
execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{encoding:'utf8',timeout:10000,input:
 `INSERT INTO public.permissions(key,name,description,category) SELECT k,k,'Native fixture catalog key','native_fixture' FROM unnest(ARRAY[${keys.map(k=>`'${k}'`).join(',')}]) k
  WHERE NOT EXISTS(SELECT FROM public.permissions p WHERE p.key=k);`})
