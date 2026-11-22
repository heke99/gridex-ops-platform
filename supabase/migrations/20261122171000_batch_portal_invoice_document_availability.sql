create function public.gridex_portal_invoice_document_availability_v1(
  p_company_id uuid,
  p_invoice_id uuid,
  p_document_ids uuid[]
) returns table(document_id uuid, retired boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document uuid;
begin
  if p_company_id is null or p_invoice_id is null or p_document_ids is null
      or cardinality(p_document_ids) not between 1 and 1000 then
    raise exception 'invalid_invoice_document_batch' using errcode = '22023';
  end if;

  for document in
    select d.id
    from public.customer_invoice_documents d
    where d.company_id = p_company_id and d.invoice_id = p_invoice_id and d.id = any(p_document_ids)
  loop
    document_id := document;
    retired := false;
    begin
      perform public.ediel_require_invoice_file_copy_available_v1(
        p_company_id, 'customer_invoice_document_pdf_bytes', document
      );
    exception when check_violation then
      if sqlerrm <> 'invoice_file_copy_retention_tombstoned' then raise; end if;
      retired := true;
    end;
    return next;
  end loop;
end;
$$;

revoke all on function public.gridex_portal_invoice_document_availability_v1(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.gridex_portal_invoice_document_availability_v1(uuid, uuid, uuid[]) to service_role;
