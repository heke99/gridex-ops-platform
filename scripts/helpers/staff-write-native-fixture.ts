import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export function staffWriteNativeFixture() {
  const companyId=randomUUID(),foreignCompanyId=randomUUID(),actorId=randomUUID(),foreignActorId=randomUUID(),clientId=randomUUID(),foreignClientId=randomUUID(),customerId=randomUUID(),foreignCustomerId=randomUUID(),caseId=randomUUID()
  const seed=`INSERT INTO public.companies(id,name,status) VALUES('${companyId}','Synthetic staff work','active'),('${foreignCompanyId}','Synthetic foreign work','active');
    INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES('${actorId}','authenticated','authenticated','${actorId}@example.invalid','{}','{}',now(),now(),false,false),
      ('${foreignActorId}','authenticated','authenticated','${foreignActorId}@example.invalid','{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES('${actorId}','${actorId}@example.invalid','Synthetic staff','active'),('${foreignActorId}','${foreignActorId}@example.invalid','Synthetic foreign staff','active')
      ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at,joined_at,role,role_key)
      VALUES('${companyId}','${actorId}','company_admin','active',true,now(),now(),'company_admin','company_admin'),
      ('${foreignCompanyId}','${foreignActorId}','company_admin','active',true,now(),now(),'company_admin','company_admin');
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT '${actorId}','${companyId}',id,key FROM public.permissions WHERE key IN('masterdata.write','customers.write','cases.write');
    INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,scopes)
      VALUES('${clientId}','${companyId}','Synthetic staff key','synthetic-${clientId}','synthetic-no-real-key',ARRAY['staff_cases.write','staff_customers.write']),
      ('${foreignClientId}','${foreignCompanyId}','Synthetic foreign key','synthetic-${foreignClientId}','synthetic-no-real-key',ARRAY['staff_cases.write']);
    INSERT INTO public.customers(id,company_id,full_name,status,email,created_at)
      VALUES('${customerId}','${companyId}','Synthetic special % search','active','${customerId}@example.invalid',now()-interval '2 days'),
      ('${foreignCustomerId}','${foreignCompanyId}','Synthetic special % foreign','active','${foreignCustomerId}@example.invalid',now());
    INSERT INTO public.customer_cases(id,company_id,customer_id,title,source,metadata)
      VALUES('${caseId}','${companyId}','${customerId}','Synthetic support','tenant_support_staff_api','{"support_case":true}');`
  const run=(body:string)=>{
    if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('staff_write_native_local_only')
    execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{
      input:`BEGIN;${seed}\n${body}\nROLLBACK;`,encoding:'utf8',timeout:30000,maxBuffer:2_000_000,
    })
  }
  return {companyId,foreignCompanyId,actorId,foreignActorId,clientId,foreignClientId,customerId,foreignCustomerId,caseId,seed,run}
}
