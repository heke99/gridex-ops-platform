create or replace function public.gridex_lock_signed_customer_contract()
 returns trigger
 language plpgsql
 set search_path to 'public','pg_catalog','pg_temp'
as $function$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_immutable_keys text[] := array[
    'company_id','customer_id','contract_name','contract_type',
    'energy_direction','site_id','customer_site_id','metering_point_id',
    'contract_offer_id','public_contract_offer_id','offer_reference',
    'quote_reference','contract_product_id','contract_product_version_id',
    'contract_publication_version_id','price_plan_id',
    'price_plan_version_id','price_book_id','legal_bundle_version_id',
    'contract_price_snapshot_id','commercial_snapshot','legal_snapshot',
    'legal_versions_snapshot','tenant_communication_snapshot',
    'tenant_communication_snapshot_sha256','tenant_legal_party_snapshot',
    'signature_snapshot','signature_snapshot_sha256',
    'price_snapshot','campaign_snapshot','fixed_price_ore_per_kwh',
    'spot_markup_ore_per_kwh','variable_fee_ore_per_kwh',
    'markup_ore_per_kwh','monthly_fee_sek','invoice_fee_sek',
    'discount_value','discount_unit','start_fee_sek','admin_fee_sek',
    'break_fee_sek','vat_rate','green_fee_mode','green_fee_value',
    'binding_months','notice_months','optional_fee_lines','starts_at',
    'expected_start_at','ends_at','auto_renew_enabled',
    'auto_renew_term_months','terms_version','terms_signed_version',
    'signed_version','signed_at','signed_ip_hash','signed_user_agent'
  ];
  v_key text;
begin
  if tg_op='DELETE' then
    if old.status in ('signed','active','terminated','cancelled','expired')
       or old.signed_at is not null or old.locked_at is not null then
      raise exception using errcode='55000',message='signed_customer_contract_delete_forbidden';
    end if;
    return old;
  end if;

  if old.status in ('signed','active','terminated','cancelled','expired')
     or old.signed_at is not null or old.locked_at is not null then
    foreach v_key in array v_immutable_keys loop
      if v_new->v_key is distinct from v_old->v_key then
        raise exception using errcode='55000',message='signed_customer_contract_immutable:'||v_key;
      end if;
    end loop;

    if new.document_sha256 is distinct from old.document_sha256 then
      if old.document_sha256 is not null
         or coalesce(new.document_sha256,'') !~ '^[0-9a-f]{64}$'
         or not exists(
           select 1 from public.customer_contract_documents d
           where d.company_id=old.company_id
             and d.customer_contract_id=old.id
             and d.document_type='signed_contract_pdf'
             and d.document_sha256=new.document_sha256
             and d.verified_at is not null
         ) then
        raise exception using errcode='55000',message='signed_customer_contract_document_hash_binding_invalid';
      end if;
    end if;

    new.locked_at:=coalesce(old.locked_at,old.signed_at,now());
  elsif new.signed_at is not null or new.status in ('signed','active') then
    new.locked_at:=coalesce(new.locked_at,new.signed_at,now());
  end if;
  return new;
end
$function$;
