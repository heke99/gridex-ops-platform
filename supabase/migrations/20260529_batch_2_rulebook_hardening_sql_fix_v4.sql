-- Batch 2 SQL compatibility fix v4
-- Run this INSTEAD OF earlier fix files (v1/v2/v3), before re-running:
-- 20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql
--
-- Purpose:
-- - Existing live Batch 2 tables may have been created by older/partial migrations.
-- - CREATE TABLE IF NOT EXISTS does not add missing columns to existing tables.
-- - This fix adds missing compatibility columns before normalize/update statements run.
-- - It also safely converts json/jsonb/text list columns to text[] after dropping incompatible defaults.

create extension if not exists pgcrypto;

create or replace function public.gridex_jsonb_to_text_array(value jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(item), '{}'::text[])
  from jsonb_array_elements_text(
    case
      when value is null then '[]'::jsonb
      when jsonb_typeof(value) = 'array' then value
      when jsonb_typeof(value) = 'string' then jsonb_build_array(value #>> '{}')
      else '[]'::jsonb
    end
  ) as x(item)
$$;

create or replace function public.gridex_text_to_text_array(value text)
returns text[]
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return '{}'::text[];
  end if;

  if left(btrim(value), 1) = '[' then
    return public.gridex_jsonb_to_text_array(value::jsonb);
  end if;

  if left(btrim(value), 1) = '{' and right(btrim(value), 1) = '}' then
    return value::text[];
  end if;

  return string_to_array(value, ',');
exception when others then
  return array[value];
end;
$$;

create or replace function public.gridex_text_to_jsonb(value text)
returns jsonb
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return '{}'::jsonb;
  end if;

  return value::jsonb;
exception when others then
  return jsonb_build_object('raw', value);
end;
$$;

-- Helper: convert a metadata/json column to jsonb if an older migration made it text/json.
do $$
declare
  column_data_type text;
begin
  -- ediel_field_rules compatibility columns
  if to_regclass('public.ediel_field_rules') is not null then
    alter table public.ediel_field_rules add column if not exists rule_key text;
    alter table public.ediel_field_rules add column if not exists message_family text;
    alter table public.ediel_field_rules add column if not exists message_code text;
    alter table public.ediel_field_rules add column if not exists field_key text;
    alter table public.ediel_field_rules add column if not exists field_name text;
    alter table public.ediel_field_rules add column if not exists segment_path text;
    alter table public.ediel_field_rules add column if not exists requirement text default 'optional';
    alter table public.ediel_field_rules add column if not exists condition text;
    alter table public.ediel_field_rules add column if not exists error_code_if_missing text;
    alter table public.ediel_field_rules add column if not exists error_code_if_invalid text;
    alter table public.ediel_field_rules add column if not exists valid_from date;
    alter table public.ediel_field_rules add column if not exists valid_to date;
    alter table public.ediel_field_rules add column if not exists is_active boolean default true;
    alter table public.ediel_field_rules add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.ediel_field_rules add column if not exists created_by uuid;
    alter table public.ediel_field_rules add column if not exists updated_by uuid;
    alter table public.ediel_field_rules add column if not exists created_at timestamptz default now();
    alter table public.ediel_field_rules add column if not exists updated_at timestamptz default now();

    select data_type into column_data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'ediel_field_rules' and column_name = 'metadata';

    if column_data_type is not null and column_data_type <> 'jsonb' then
      alter table public.ediel_field_rules alter column metadata drop default;
      alter table public.ediel_field_rules alter column metadata drop not null;
      alter table public.ediel_field_rules
        alter column metadata type jsonb
        using public.gridex_text_to_jsonb(metadata::text);
      alter table public.ediel_field_rules alter column metadata set default '{}'::jsonb;
    end if;
  end if;

  -- ediel_code_rules compatibility columns
  if to_regclass('public.ediel_code_rules') is not null then
    alter table public.ediel_code_rules add column if not exists code_list text;
    alter table public.ediel_code_rules add column if not exists description text;
    alter table public.ediel_code_rules add column if not exists is_active boolean default true;
    alter table public.ediel_code_rules add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.ediel_code_rules add column if not exists created_by uuid;
    alter table public.ediel_code_rules add column if not exists updated_by uuid;
    alter table public.ediel_code_rules add column if not exists created_at timestamptz default now();
    alter table public.ediel_code_rules add column if not exists updated_at timestamptz default now();

    select data_type into column_data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'ediel_code_rules' and column_name = 'metadata';

    if column_data_type is not null and column_data_type <> 'jsonb' then
      alter table public.ediel_code_rules alter column metadata drop default;
      alter table public.ediel_code_rules alter column metadata drop not null;
      alter table public.ediel_code_rules
        alter column metadata type jsonb
        using public.gridex_text_to_jsonb(metadata::text);
      alter table public.ediel_code_rules alter column metadata set default '{}'::jsonb;
    end if;
  end if;

  -- ediel_test_data_sets compatibility columns
  if to_regclass('public.ediel_test_data_sets') is not null then
    alter table public.ediel_test_data_sets add column if not exists title text;
    alter table public.ediel_test_data_sets add column if not exists file_name text;
    alter table public.ediel_test_data_sets add column if not exists source_type text;
    alter table public.ediel_test_data_sets add column if not exists row_count integer default 0;
    alter table public.ediel_test_data_sets add column if not exists raw_text_preview text;
    alter table public.ediel_test_data_sets add column if not exists metadata jsonb default '{}'::jsonb;
    alter table public.ediel_test_data_sets add column if not exists created_by uuid;
    alter table public.ediel_test_data_sets add column if not exists created_at timestamptz default now();

    select data_type into column_data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'ediel_test_data_sets' and column_name = 'metadata';

    if column_data_type is not null and column_data_type <> 'jsonb' then
      alter table public.ediel_test_data_sets alter column metadata drop default;
      alter table public.ediel_test_data_sets alter column metadata drop not null;
      alter table public.ediel_test_data_sets
        alter column metadata type jsonb
        using public.gridex_text_to_jsonb(metadata::text);
      alter table public.ediel_test_data_sets alter column metadata set default '{}'::jsonb;
    end if;
  end if;
end $$;

-- Convert list columns to text[] safely, regardless of older jsonb/json/text defaults.
do $$
declare
  column_data_type text;
  column_udt_name text;
begin
  -- ediel_field_rules.allowed_values
  if to_regclass('public.ediel_field_rules') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'ediel_field_rules' and column_name = 'allowed_values'
    ) then
      alter table public.ediel_field_rules add column allowed_values text[] default '{}'::text[];
    else
      select data_type, udt_name into column_data_type, column_udt_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'ediel_field_rules' and column_name = 'allowed_values';

      if not (column_data_type = 'ARRAY' and column_udt_name = '_text') then
        alter table public.ediel_field_rules alter column allowed_values drop default;
        alter table public.ediel_field_rules alter column allowed_values drop not null;

        if column_data_type = 'jsonb' then
          alter table public.ediel_field_rules
            alter column allowed_values type text[]
            using public.gridex_jsonb_to_text_array(allowed_values);
        elsif column_data_type = 'json' then
          alter table public.ediel_field_rules
            alter column allowed_values type text[]
            using public.gridex_jsonb_to_text_array(allowed_values::jsonb);
        elsif column_data_type = 'text' then
          alter table public.ediel_field_rules
            alter column allowed_values type text[]
            using public.gridex_text_to_text_array(allowed_values);
        else
          alter table public.ediel_field_rules
            alter column allowed_values type text[]
            using '{}'::text[];
        end if;
      end if;

      update public.ediel_field_rules set allowed_values = '{}'::text[] where allowed_values is null;
      alter table public.ediel_field_rules alter column allowed_values set default '{}'::text[];
      alter table public.ediel_field_rules alter column allowed_values set not null;
    end if;
  end if;

  -- ediel_code_rules.allowed_values
  if to_regclass('public.ediel_code_rules') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'ediel_code_rules' and column_name = 'allowed_values'
    ) then
      alter table public.ediel_code_rules add column allowed_values text[] default '{}'::text[];
    else
      select data_type, udt_name into column_data_type, column_udt_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'ediel_code_rules' and column_name = 'allowed_values';

      if not (column_data_type = 'ARRAY' and column_udt_name = '_text') then
        alter table public.ediel_code_rules alter column allowed_values drop default;
        alter table public.ediel_code_rules alter column allowed_values drop not null;

        if column_data_type = 'jsonb' then
          alter table public.ediel_code_rules
            alter column allowed_values type text[]
            using public.gridex_jsonb_to_text_array(allowed_values);
        elsif column_data_type = 'json' then
          alter table public.ediel_code_rules
            alter column allowed_values type text[]
            using public.gridex_jsonb_to_text_array(allowed_values::jsonb);
        elsif column_data_type = 'text' then
          alter table public.ediel_code_rules
            alter column allowed_values type text[]
            using public.gridex_text_to_text_array(allowed_values);
        else
          alter table public.ediel_code_rules
            alter column allowed_values type text[]
            using '{}'::text[];
        end if;
      end if;

      update public.ediel_code_rules set allowed_values = '{}'::text[] where allowed_values is null;
      alter table public.ediel_code_rules alter column allowed_values set default '{}'::text[];
      alter table public.ediel_code_rules alter column allowed_values set not null;
    end if;
  end if;

  -- ediel_test_data_sets.headers
  if to_regclass('public.ediel_test_data_sets') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'ediel_test_data_sets' and column_name = 'headers'
    ) then
      alter table public.ediel_test_data_sets add column headers text[] default '{}'::text[];
    else
      select data_type, udt_name into column_data_type, column_udt_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'ediel_test_data_sets' and column_name = 'headers';

      if not (column_data_type = 'ARRAY' and column_udt_name = '_text') then
        alter table public.ediel_test_data_sets alter column headers drop default;
        alter table public.ediel_test_data_sets alter column headers drop not null;

        if column_data_type = 'jsonb' then
          alter table public.ediel_test_data_sets
            alter column headers type text[]
            using public.gridex_jsonb_to_text_array(headers);
        elsif column_data_type = 'json' then
          alter table public.ediel_test_data_sets
            alter column headers type text[]
            using public.gridex_jsonb_to_text_array(headers::jsonb);
        elsif column_data_type = 'text' then
          alter table public.ediel_test_data_sets
            alter column headers type text[]
            using public.gridex_text_to_text_array(headers);
        else
          alter table public.ediel_test_data_sets
            alter column headers type text[]
            using '{}'::text[];
        end if;
      end if;

      update public.ediel_test_data_sets set headers = '{}'::text[] where headers is null;
      alter table public.ediel_test_data_sets alter column headers set default '{}'::text[];
      alter table public.ediel_test_data_sets alter column headers set not null;
    end if;
  end if;
end $$;

-- Add missing compatibility columns that older partial Batch 2 migrations may not have.
alter table if exists public.ediel_test_suites add column if not exists suite_code text;
alter table if exists public.ediel_test_suites add column if not exists title text;
alter table if exists public.ediel_test_suites add column if not exists description text;
alter table if exists public.ediel_test_suites add column if not exists role_code text;
alter table if exists public.ediel_test_suites add column if not exists is_active boolean default true;
alter table if exists public.ediel_test_suites add column if not exists metadata jsonb default '{}'::jsonb;
alter table if exists public.ediel_test_suites add column if not exists created_at timestamptz default now();
alter table if exists public.ediel_test_suites add column if not exists updated_at timestamptz default now();

alter table if exists public.ediel_test_cases add column if not exists suite_code text;
alter table if exists public.ediel_test_cases add column if not exists test_case_code text;
alter table if exists public.ediel_test_cases add column if not exists title text;
alter table if exists public.ediel_test_cases add column if not exists role_code text;
alter table if exists public.ediel_test_cases add column if not exists message_family text;
alter table if exists public.ediel_test_cases add column if not exists message_code text;
alter table if exists public.ediel_test_cases add column if not exists subtype text;
alter table if exists public.ediel_test_cases add column if not exists process_group text;
alter table if exists public.ediel_test_cases add column if not exists expected_contrl text;
alter table if exists public.ediel_test_cases add column if not exists expected_aperak text;
alter table if exists public.ediel_test_cases add column if not exists expected_utilts_err text;
alter table if exists public.ediel_test_cases add column if not exists mandatory boolean default true;
alter table if exists public.ediel_test_cases add column if not exists is_active boolean default true;
alter table if exists public.ediel_test_cases add column if not exists metadata jsonb default '{}'::jsonb;
alter table if exists public.ediel_test_cases add column if not exists created_at timestamptz default now();
alter table if exists public.ediel_test_cases add column if not exists updated_at timestamptz default now();

alter table if exists public.ediel_rule_versions add column if not exists previous_version_code text;
alter table if exists public.ediel_rule_versions add column if not exists latest_change_at timestamptz default now();
alter table if exists public.ediel_rule_versions add column if not exists last_regression_run_id uuid;
alter table if exists public.ediel_rule_versions add column if not exists last_regression_status text;
alter table if exists public.ediel_rule_versions add column if not exists last_regression_at timestamptz;
alter table if exists public.ediel_rule_versions add column if not exists updated_at timestamptz default now();
alter table if exists public.ediel_rule_versions add column if not exists updated_by uuid;

alter table if exists public.ediel_ack_rules add column if not exists is_active boolean default true;
alter table if exists public.ediel_ack_rules add column if not exists metadata jsonb default '{}'::jsonb;
alter table if exists public.ediel_ack_rules add column if not exists updated_at timestamptz default now();
alter table if exists public.ediel_ack_rules add column if not exists updated_by uuid;

alter table if exists public.ediel_message_build_rules add column if not exists is_active boolean default true;
alter table if exists public.ediel_message_build_rules add column if not exists metadata jsonb default '{}'::jsonb;
alter table if exists public.ediel_message_build_rules add column if not exists updated_at timestamptz default now();
alter table if exists public.ediel_message_build_rules add column if not exists updated_by uuid;

alter table if exists public.ediel_test_artifacts add column if not exists payload jsonb default '{}'::jsonb;
alter table if exists public.ediel_test_artifacts add column if not exists artifact_type text;
alter table if exists public.ediel_test_artifacts add column if not exists title text;
alter table if exists public.ediel_test_artifacts add column if not exists created_at timestamptz default now();

alter table if exists public.ediel_test_run_steps add column if not exists validation_report jsonb default '{}'::jsonb;
alter table if exists public.ediel_test_run_steps add column if not exists parsed_payload jsonb default '{}'::jsonb;
alter table if exists public.ediel_test_run_steps add column if not exists artifact_ids uuid[] default '{}'::uuid[];

-- Normalize safe defaults only after the compatibility columns exist.
do $$
begin
  if to_regclass('public.ediel_field_rules') is not null then
    execute $q$
      update public.ediel_field_rules
      set requirement = coalesce(requirement, 'optional'),
          allowed_values = coalesce(allowed_values, '{}'::text[]),
          is_active = coalesce(is_active, true),
          metadata = coalesce(metadata, '{}'::jsonb),
          created_at = coalesce(created_at, now()),
          updated_at = coalesce(updated_at, now())
    $q$;
  end if;

  if to_regclass('public.ediel_code_rules') is not null then
    execute $q$
      update public.ediel_code_rules
      set allowed_values = coalesce(allowed_values, '{}'::text[]),
          is_active = coalesce(is_active, true),
          metadata = coalesce(metadata, '{}'::jsonb),
          created_at = coalesce(created_at, now()),
          updated_at = coalesce(updated_at, now())
    $q$;
  end if;

  if to_regclass('public.ediel_test_data_sets') is not null then
    execute $q$
      update public.ediel_test_data_sets
      set headers = coalesce(headers, '{}'::text[]),
          metadata = coalesce(metadata, '{}'::jsonb),
          created_at = coalesce(created_at, now())
    $q$;
  end if;
end $$;

select 'batch_2_rulebook_hardening_sql_fix_v4_completed' as status;
