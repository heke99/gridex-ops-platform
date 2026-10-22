import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Actual complete forward and immutable target bodies, with real PostgreSQL RI.
// Finite column projections below are DECLARED_ROOT_MP03 metadata (no data),
// receipt prod-MP03_columns-rows.json SHA256 65e5b26ff38794d5553a45221afa3bdd01853fb290986c0fcdd5c93e4986196a.
// DECLARED_FD4_FK profiles: base fd4acbc50e9d73c7f2f317d3e806723522708b16,
// schema SHA256 a15291106e26b9bea9f70dd99f3c19f6cae7e159afd8a5d4674a997d98c2eac6.
// These literals never read the mutable generated schema as a predecessor.
// This is not the full legal/partner/materialization/provider or native graph.
const forward = readFileSync('supabase/migrations/20261020211439_customer_merge_portal_lifecycle_convergence.sql', 'utf8')
const lifecycle = readFileSync('supabase/migrations/20261002230000_customer_merge_portal_lifecycle.sql', 'utf8')
const atomic = readFileSync('supabase/migrations/20261002222000_customer_merge_atomic.sql', 'utf8')
const staff = readFileSync('supabase/migrations/20261004084204_staff_customer_write_attribution.sql', 'utf8')
const authority = readFileSync('supabase/migrations/20261004114944_staff_contact_profile_authority.sql', 'utf8')
const signatures = {
  merge: 'public.gridex_merge_customers_v1(uuid,uuid,uuid[],uuid,text)',
  guard: 'public.gridex_guard_merged_portal_customer_write()',
  contact: 'public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)',
}
const hashes = {
  old: 'b9d5ec34f050761b5ae84da0d4391d90e506d201c3cf2e776942e47db1aa5037',
  merge: '76a070a53a5789bc3a64e89e8eaeca3920443a258bf1d33972504e7d318c7b67',
  guard: 'd5e0a686c9dc52c7aa08cfd3dd9d75a3be4fc77248964f1a248f29d4e8e394a6',
  contact: 'dcc59600b4daa4a3dc25b5ff531ace5c9b4b6a7834408ed5751b5d82657bea54',
}
const guardTables = ["customer_portal_accounts", "customer_portal_identities", "tenant_portal_customer_links", "customer_portal_claims", "customer_portal_events", "customer_portal_requests", "customer_portal_completions", "customer_portal_write_idempotency", "customer_cases", "customer_case_events", "customer_case_attachments", "customer_events", "customer_contacts"] as const
const missing = ["customer_case_attachments", "customer_portal_identities", "customer_portal_requests", "customer_portal_write_idempotency", "tenant_portal_customer_links"] as const
const fields: Record<string, string[][]> = {
  "customer_sites": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "metering_points": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ],
    [
      "site_id",
      "uuid"
    ]
  ],
  "customer_contacts": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "customer_addresses": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "customer_contracts": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ],
    [
      "customer_site_id",
      "uuid"
    ],
    [
      "site_id",
      "uuid"
    ]
  ],
  "customer_contract_events": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "powers_of_attorney": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ],
    [
      "customer_site_id",
      "uuid"
    ],
    [
      "site_id",
      "uuid"
    ]
  ],
  "power_of_attorney_scopes": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "authorization_scopes": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "customer_authorization_documents": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "customer_cases": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "customer_case_events": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "customer_case_id",
      "uuid"
    ]
  ],
  "customer_info_requests": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ],
    [
      "site_id",
      "uuid"
    ]
  ],
  "customer_info_request_events": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_internal_notes": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "customer_operation_tasks": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "customer_lifecycle_decisions": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_lifecycle_events": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_duplicate_resolution_events": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_readiness_snapshots": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "document_ai_extractions": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "supplier_switch_requests": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ],
    [
      "customer_site_id",
      "uuid"
    ],
    [
      "site_id",
      "uuid"
    ]
  ],
  "supplier_switch_events": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ]
  ],
  "grid_owner_data_requests": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ],
    [
      "site_id",
      "uuid"
    ]
  ],
  "grid_owner_information_requests": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ],
    [
      "customer_site_id",
      "uuid"
    ]
  ],
  "outbound_requests": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ],
    [
      "customer_site_id",
      "uuid"
    ],
    [
      "site_id",
      "uuid"
    ]
  ],
  "outbound_dispatch_events": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ]
  ],
  "billing_underlays": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "billing_export_run_items": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "partner_exports": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "tenant_email_outbox": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "ediel_messages": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "updated_by",
      "uuid"
    ]
  ],
  "customer_import_rows": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_case_attachments": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "customer_case_id",
      "uuid"
    ]
  ],
  "customer_portal_accounts": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "user_id",
      "uuid"
    ],
    [
      "is_active",
      "boolean"
    ],
    [
      "status",
      "text"
    ],
    [
      "external_account_id",
      "text"
    ],
    [
      "external_customer_id",
      "text"
    ]
  ],
  "customer_portal_identities": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "auth_user_id",
      "uuid"
    ],
    [
      "customer_portal_user_id",
      "uuid"
    ],
    [
      "status",
      "text"
    ],
    [
      "provider",
      "text"
    ],
    [
      "external_account_id",
      "text"
    ],
    [
      "external_customer_id",
      "text"
    ]
  ],
  "tenant_portal_customer_links": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ],
    [
      "status",
      "text"
    ],
    [
      "provider",
      "text"
    ],
    [
      "external_account_id",
      "text"
    ],
    [
      "external_customer_id",
      "text"
    ]
  ],
  "customer_portal_claims": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_portal_events": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_portal_requests": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_portal_completions": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_portal_api_access_logs": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_portal_write_idempotency": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ],
  "customer_events": [
    [
      "id",
      "uuid"
    ],
    [
      "company_id",
      "uuid"
    ],
    [
      "customer_id",
      "uuid"
    ]
  ]
}
const fks = [
  {
    "table": "customer_case_attachments",
    "name": "customer_case_attachments_case_owner_fk",
    "ddl": "ADD CONSTRAINT customer_case_attachments_case_owner_fk FOREIGN KEY (customer_case_id, company_id, customer_id) REFERENCES public.customer_cases(id, company_id, customer_id) ON DELETE CASCADE DEFERRABLE",
    "child": [
      "customer_case_id",
      "company_id",
      "customer_id"
    ],
    "parent": "customer_cases",
    "parentColumns": [
      "id",
      "company_id",
      "customer_id"
    ]
  },
  {
    "table": "customer_case_events",
    "name": "customer_case_events_case_owner_fk",
    "ddl": "ADD CONSTRAINT customer_case_events_case_owner_fk FOREIGN KEY (customer_case_id, company_id, customer_id) REFERENCES public.customer_cases(id, company_id, customer_id) ON DELETE CASCADE DEFERRABLE",
    "child": [
      "customer_case_id",
      "company_id",
      "customer_id"
    ],
    "parent": "customer_cases",
    "parentColumns": [
      "id",
      "company_id",
      "customer_id"
    ]
  },
  {
    "table": "customer_contracts",
    "name": "customer_contracts_company_customer_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT customer_contracts_company_customer_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, customer_site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "customer_site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "customer_contracts",
    "name": "customer_contracts_company_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT customer_contracts_company_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "customer_info_requests",
    "name": "customer_info_requests_company_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT customer_info_requests_company_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "grid_owner_data_requests",
    "name": "grid_owner_data_requests_company_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT grid_owner_data_requests_company_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "grid_owner_information_requests",
    "name": "grid_owner_information_requests_company_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT grid_owner_information_requests_company_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, customer_site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "customer_site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "metering_points",
    "name": "metering_points_company_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT metering_points_company_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "outbound_requests",
    "name": "outbound_requests_company_customer_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT outbound_requests_company_customer_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, customer_site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "customer_site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "outbound_requests",
    "name": "outbound_requests_company_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT outbound_requests_company_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "powers_of_attorney",
    "name": "powers_of_attorney_company_customer_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT powers_of_attorney_company_customer_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, customer_site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "customer_site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "powers_of_attorney",
    "name": "powers_of_attorney_company_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT powers_of_attorney_company_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "supplier_switch_requests",
    "name": "supplier_switch_requests_company_customer_customer_site_rel_fke",
    "ddl": "ADD CONSTRAINT supplier_switch_requests_company_customer_customer_site_rel_fke FOREIGN KEY (company_id, customer_id, customer_site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "customer_site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  },
  {
    "table": "supplier_switch_requests",
    "name": "supplier_switch_requests_company_customer_site_rel_fkey",
    "ddl": "ADD CONSTRAINT supplier_switch_requests_company_customer_site_rel_fkey FOREIGN KEY (company_id, customer_id, site_id) REFERENCES public.customer_sites(company_id, customer_id, id) DEFERRABLE",
    "child": [
      "company_id",
      "customer_id",
      "site_id"
    ],
    "parent": "customer_sites",
    "parentColumns": [
      "company_id",
      "customer_id",
      "id"
    ]
  }
]
const company = '00000000-0000-4000-8000-000000000001'
const otherCompany = '00000000-0000-4000-8000-000000000002'
const primary = '00000000-0000-4000-8000-000000000101'
const source = '00000000-0000-4000-8000-000000000102'
const foreign = '00000000-0000-4000-8000-000000000201'
const actor = '00000000-0000-4000-8000-000000000901'
const row = '00000000-0000-4000-8000-000000000301'
const foreignRow = '00000000-0000-4000-8000-000000000302'
function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
function quote(value: string) { return "'" + value.replaceAll("'", "''") + "'" }
function definition(sql: string, name: string) {
  const match = new RegExp('^create(?: or replace)? function public\\.' + name + '\\(', 'im').exec(sql)
  if (!match) throw new Error('missing immutable function ' + name)
  const rest = sql.slice(match.index)
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(rest)
  if (!delimiter) throw new Error('missing dollar delimiter')
  const end = rest.indexOf(delimiter[1] + ';', delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error('unterminated immutable definition')
  return rest.slice(0, end + delimiter[1].length + 1)
}
function body(ddl: string) {
  const match = /\bAS\s+(\$[^$]*\$)/i.exec(ddl)
  if (!match) throw new Error('missing body')
  const start = match.index + match[0].length
  return ddl.slice(start, ddl.indexOf(match[1] + ';', start))
}
function replaceBody(ddl: string, value: string) {
  return ddl.replace(/^create function/i, 'CREATE OR REPLACE FUNCTION').replace(body(ddl), value)
}
const canonicalDefinition = definition(lifecycle, 'gridex_merge_customers_v1')
const canonicalBody = body(canonicalDefinition)
const oldDefinition = definition(atomic, 'gridex_merge_customers_v1')
// DECLARED_ROOT_OBSERVED: actual b9d5 is immutable atomic minus exactly4 comments.
// ROOT receipt prod-targeted-anonymize-merge-bodies-rows.json aff64645716d1a7dc2a9c482ce6e7998e18dfc44c898febe239e445128d70e26.
const removedComments = ["  -- Customer-scoped tables whose rows follow the surviving customer. Tables\n", "  -- without customer_id/company_id in this database are skipped.\n", "  -- Lock every customer in a stable order to avoid deadlocks between merges.\n", "      -- Also the answer for another tenant's customer: never reveal or touch it.\n"]
const oldBody = removedComments.reduce((value, comment) => value.replace(comment, ''), body(oldDefinition))
const guardDefinition = definition(lifecycle, 'gridex_guard_merged_portal_customer_write')
const guardBody = body(guardDefinition)
const staffDefinition = definition(staff, 'gridex_customer_contact_change_v1')
const legacy = /v_legacy constant text := \$legacy\$([\s\S]*?)\$legacy\$;/.exec(authority)![1]
const staffAware = /v_staff_aware constant text := \$staff_aware\$([\s\S]*?)\$staff_aware\$;/.exec(authority)![1]
const contactBody = body(staffDefinition).replace(legacy, staffAware)
  .replace("ERRCODE='40001', MESSAGE='contact_change_version_conflict'", "ERRCODE='PT409', MESSAGE='contact_change_version_conflict'")
let db: PGlite
async function installFunction(ddl: string, signature: string) {
  await db.exec(ddl + `;revoke all on function ${signature} from public,anon,authenticated,service_role;grant execute on function ${signature} to service_role`)
}
async function apply() { await db.exec(forward) }
async function catalog() {
  return (await db.query<{ value: Record<string, unknown> }>(`select jsonb_build_object(
    'functions',(select jsonb_agg(jsonb_build_object('row',to_jsonb(p),'xmin',p.xmin::text) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace),
    'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c where c.connamespace='public'::regnamespace),
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t join pg_class r on r.oid=t.tgrelid where r.relnamespace='public'::regnamespace),
    'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
    'namespaces',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n),
    'members',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m)
  ) as value`)).rows[0].value
}
async function functionRow(signature: string) {
  return (await db.query<{ metadata: Record<string, unknown>; source: string; xmin: string }>(`select to_jsonb(p)-'prosrc' as metadata,p.prosrc as source,p.xmin::text as xmin from pg_proc p where p.oid=$1::regprocedure`, [signature])).rows[0]
}
async function rejectedApply() {
  const before = await catalog()
  await db.exec('savepoint rejected_forward')
  let error: { code?: string; message?: string } | undefined
  try { await apply() } catch (caught) { error = caught as typeof error; await db.exec('rollback to savepoint rejected_forward') }
  await db.exec('release savepoint rejected_forward')
  expect(error?.code).toBe('55000')
  expect(error?.message).toMatch(/merge_portal_convergence/)
  expect(await catalog()).toEqual(before)
}
async function merge(ids = [source], selectedCompany = company) {
  return (await db.query(`select public.gridex_merge_customers_v1($1,$2,$3::uuid[],$4,'synthetic duplicate') as result`, [selectedCompany, primary, ids, actor])).rows[0]
}
async function rows(table: string) {
  return (await db.query<Record<string, unknown>>(`select * from public.${table} order by id`)).rows
}
async function businessSnapshot() {
  const result: Record<string, unknown> = {}
  for (const name of ['customers', 'customer_merge_events', 'audit_logs', ...Object.keys(fields)]) result[name] = await rows(name)
  return result
}
async function refusedOperation(run: () => Promise<unknown>, message: string) {
  const before = await businessSnapshot()
  await db.exec('savepoint refused_operation')
  let error: { message?: string } | undefined
  try { await run() } catch (caught) { error = caught as typeof error; await db.exec('rollback to savepoint refused_operation') }
  await db.exec('release savepoint refused_operation')
  expect(error?.message).toBe(message)
  expect(await businessSnapshot()).toEqual(before)
}
async function foundation() {
  await db.exec(`create schema auth;create schema extensions;create role anon;create role authenticated;create role service_role;
    create role fixture_other nologin;
    create function auth.role() returns text language sql stable as $$select coalesce(current_setting('request.jwt.claim.role',true),'')$$;
    create table public.customers(id uuid primary key,company_id uuid,status text default 'active',merged_into_customer_id uuid,
      customer_number text,full_name text,company_name text,email text,merge_status text,merged_at timestamptz,merged_by uuid,
      duplicate_review_status text,possible_duplicate boolean,updated_by uuid,updated_at timestamptz);
    create table public.customer_merge_events(id uuid default gen_random_uuid() primary key,company_id uuid,primary_customer_id uuid,
      merged_customer_id uuid,reason text,moved_counts jsonb,source_snapshot jsonb,created_by uuid);
    create table public.audit_logs(id uuid default gen_random_uuid() primary key,actor_user_id uuid,company_id uuid,entity_type text,
      entity_id text,action text,old_values jsonb,new_values jsonb,metadata jsonb);`)
  for (const [name, columns] of Object.entries(fields)) {
    await db.exec(`create table public.${name} (${columns.map(([n, type]) => n + ' ' + type + (n === 'id' ? ' primary key default gen_random_uuid()' : '')).join(',')})`)
  }
  const parentKeys = new Set<string>()
  for (const fk of fks) {
    const key = fk.parent + ':' + fk.parentColumns.join(',')
    if (!parentKeys.has(key)) { await db.exec(`alter table public.${fk.parent} add unique (${fk.parentColumns.join(',')})`); parentKeys.add(key) }
    await db.exec(`alter table public.${fk.table} ${fk.name === 'customer_case_attachments_case_owner_fk' ? fk.ddl.replace(' DEFERRABLE', '') : fk.ddl}`)
  }
  await installFunction(replaceBody(oldDefinition, oldBody), signatures.merge)
  await installFunction(guardDefinition, signatures.guard)
  await installFunction(replaceBody(staffDefinition, contactBody), signatures.contact)
  for (const name of guardTables.filter(name => !(missing as readonly string[]).includes(name))) {
    await db.exec(`create trigger guard_merged_portal_customer_write before insert or update of company_id,customer_id on public.${name} for each row execute function public.gridex_guard_merged_portal_customer_write()`)
  }
  // A finite immutability boundary, not the production legal/materialization graph.
  await db.exec(`alter table public.customer_contracts add column signed_fixture boolean default false;
    create function public.fixture_signed_contract_immutable() returns trigger language plpgsql as $$begin
      if old.signed_fixture then raise exception 'signed_contract_immutable' using errcode='23514';end if;return new;end$$;
    create trigger fixture_signed_contract_immutable before update on public.customer_contracts for each row execute function public.fixture_signed_contract_immutable();
    alter table public.customer_portal_accounts add unique(company_id,customer_id,user_id);
    insert into public.customers(id,company_id) values (${quote(primary)},${quote(company)}),(${quote(source)},${quote(company)}),(${quote(foreign)},${quote(otherCompany)});`)
  for (const [name, columns] of Object.entries(fields)) {
    const selected = columns.filter(([n]) => ['id','company_id','customer_id','updated_by','customer_case_id','customer_site_id','site_id'].includes(n))
    const values = (foreignTenant: boolean) => selected.map(([n, type]) => quote(n === 'company_id' ? foreignTenant ? otherCompany : company
      : n === 'customer_id' ? foreignTenant ? foreign : source : n === 'updated_by' ? actor : foreignTenant ? foreignRow : row) + (type === 'uuid' ? '::uuid' : ''))
    await db.exec(`insert into public.${name} (${selected.map(([n]) => n).join(',')}) values (${values(false).join(',')}),(${values(true).join(',')})`)
  }
  await db.exec(`update public.customer_portal_accounts set user_id=id,is_active=true,status='active';
    update public.customer_portal_identities set status='active',provider='synthetic',auth_user_id=id,customer_portal_user_id=id;
    update public.tenant_portal_customer_links set status='active',provider='synthetic',external_customer_id=id::text;`)
}

describe('strict observed customer merge portal convergence, complete actual SQL', () => {
  beforeAll(async () => {
    expect(hash(lifecycle)).toBe('836c083fad0f231a145cf4117527057a20bdc2f73d094c3fbaa53fbab525a4c9')
    expect(hash(atomic)).toBe('314456a2dcd458d4da11f2addb7f1a15c3a7f16abd3077fb0111d6f6867f2627')
    expect(hash(oldBody)).toBe(hashes.old)
    expect(hash(canonicalBody)).toBe(hashes.merge)
    expect(hash(guardBody)).toBe(hashes.guard)
    expect(hash(contactBody)).toBe(hashes.contact)
    db = new PGlite()
    await foundation()
  }, 30_000)
  beforeEach(async () => { await db.exec("begin;set local request.jwt.claim.role='service_role'") })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db?.close() })

  it('moves the real owner-FK portal/support graph and preserves other-company rows atomically', async () => {
    await apply()
    await merge()
    for (const name of Object.keys(fields)) {
      if (!fields[name].some(([n]) => n === 'customer_id')) continue
      const result = await rows(name)
      expect(result.find(x => x.id === row)?.customer_id, name).toBe(primary)
      expect(result.find(x => x.id === foreignRow)?.customer_id, name).toBe(foreign)
    }
    expect((await rows('customers')).find(x => x.id === source)).toMatchObject({ status: 'inactive', merge_status: 'merged', merged_into_customer_id: primary, merged_by: actor })
    expect(await rows('customer_merge_events')).toHaveLength(1)
    expect(await rows('audit_logs')).toHaveLength(1)
  })
  it('preserves distinct existing portal users and provider/identity metadata when access is unioned', async () => {
    await apply()
    await db.exec(`insert into public.customer_portal_accounts(id,company_id,customer_id,user_id,status,is_active,external_account_id)
      values(gen_random_uuid(),${quote(company)},${quote(primary)},${quote(actor)},'confirmed',true,'synthetic-primary')`)
    await merge()
    expect((await rows('customer_portal_accounts')).filter(x => x.customer_id === primary)).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: row, status: 'active' }), expect.objectContaining({ user_id: actor, status: 'confirmed', external_account_id: 'synthetic-primary' }),
    ]))
    expect((await rows('customer_portal_identities')).find(x => x.id === row)).toMatchObject({ provider: 'synthetic', auth_user_id: row, customer_portal_user_id: row, status: 'active' })
  })
  it('changes exactly one FK flag and the three intended RI deferrability flags', async () => {
    const before = (await db.query<Record<string, unknown>>(`select to_jsonb(c) as c from pg_constraint c where connamespace='public'::regnamespace order by oid`)).rows
    const riBefore = (await db.query<Record<string, unknown>>(`select t.oid,p.proname,t.tgdeferrable,t.tginitdeferred,to_jsonb(t)-'tgdeferrable' as immutable
      from pg_trigger t join pg_proc p on p.oid=t.tgfoid where tgconstraint=(select oid from pg_constraint where conname='customer_case_attachments_case_owner_fk') order by t.oid`)).rows
    await apply()
    const after = (await db.query<Record<string, unknown>>(`select to_jsonb(c) as c from pg_constraint c where connamespace='public'::regnamespace order by oid`)).rows
    expect(after.map(x => ({ ...(x.c as Record<string, unknown>), condeferrable: null }))).toEqual(before.map(x => ({ ...(x.c as Record<string, unknown>), condeferrable: null })))
    expect((await db.query(`select count(*)::int as n from pg_constraint where conname=any($1::text[]) and condeferrable and not condeferred`, [fks.map(fk => fk.name)])).rows).toEqual([{ n: 14 }])
    const riAfter = (await db.query<Record<string, unknown>>(`select t.oid,p.proname,t.tgdeferrable,t.tginitdeferred,to_jsonb(t)-'tgdeferrable' as immutable
      from pg_trigger t join pg_proc p on p.oid=t.tgfoid where tgconstraint=(select oid from pg_constraint where conname='customer_case_attachments_case_owner_fk') order by t.oid`)).rows
    expect(riAfter.map(x => x.immutable)).toEqual(riBefore.map(x => x.immutable))
    expect(riAfter.filter(x => x.tgdeferrable).map(x => x.proname).sort()).toEqual(['RI_FKey_check_ins','RI_FKey_check_upd','RI_FKey_noaction_upd'].sort())
    expect(riAfter.find(x => x.proname === 'RI_FKey_cascade_del')?.tgdeferrable).toBe(false)
    expect(riAfter.every(x => x.tginitdeferred === false)).toBe(true)
  })
  it('preserves all existing guard OIDs and contact/full-function metadata, adding only five guard instances', async () => {
    const guard = await functionRow(signatures.guard); const contact = await functionRow(signatures.contact); const mergeBefore = await functionRow(signatures.merge)
    const before = (await db.query(`select to_jsonb(t) as value from pg_trigger t where tgname='guard_merged_portal_customer_write' order by oid`)).rows
    expect(before).toHaveLength(8)
    await apply()
    expect(await functionRow(signatures.guard)).toEqual(guard)
    expect(await functionRow(signatures.contact)).toEqual(contact)
    expect((await functionRow(signatures.merge)).metadata).toEqual(mergeBefore.metadata)
    expect(hash((await functionRow(signatures.merge)).source)).toBe(hashes.merge)
    const after = (await db.query(`select to_jsonb(t) as value from pg_trigger t where tgname='guard_merged_portal_customer_write' order by oid`)).rows
    expect(after).toHaveLength(13)
    expect(after).toEqual(expect.arrayContaining(before))
  })
  it('replays complete canonical source/constraints/guards as a true no-op including xmin', async () => {
    await apply(); const before = await catalog(); await apply(); expect(await catalog()).toEqual(before)
  })
  it('refuses a different nonsuperuser context even when it inherits the existing postgres owner', async () => {
    // PG17 forbids demoting its bootstrap superuser. This tests the explicit
    // runner boundary, not nonsuperuser-provider installation equivalence.
    await db.exec('create role fixture_runner nologin nosuperuser inherit;grant postgres to fixture_runner;set local role fixture_runner')
    expect((await db.query(`select rolsuper from pg_roles where rolname=current_user`)).rows).toEqual([{ rolsuper: false }])
    await rejectedApply()
  })
  it.each(missing)('new %s guard refuses both INSERT and UPDATE to a merged source', async name => {
    await apply()
    await db.exec(`update public.customers set merged_into_customer_id=${quote(primary)} where id=${quote(source)}`)
    await refusedOperation(() => db.exec(`insert into public.${name}(id,company_id,customer_id) values(gen_random_uuid(),${quote(company)},${quote(source)})`), 'customer_merged_write_conflict')
    await refusedOperation(() => db.exec(`update public.${name} set customer_id=customer_id where id=${quote(row)}`), 'customer_merged_write_conflict')
  })
  it.each(missing)('new %s guard refuses wrong tenant while retaining NULL-customer semantics', async name => {
    await apply()
    await refusedOperation(() => db.exec(`insert into public.${name}(id,company_id,customer_id) values(gen_random_uuid(),${quote(otherCompany)},${quote(source)})`), 'customer_portal_customer_not_found_for_tenant')
    await db.exec(`insert into public.${name}(id,company_id,customer_id) values(gen_random_uuid(),${quote(company)},null)`)
  })
  it('refuses ambiguous active portal subjects before moving any rows', async () => {
    await apply(); await db.exec(`update public.customer_portal_identities set auth_user_id=${quote(actor)} where id=${quote(row)}`)
    await refusedOperation(() => merge(), 'customer_merge_ambiguous_portal_subject')
  })
  it('refuses duplicate active external-account subjects instead of deleting or deduplicating identities', async () => {
    await apply(); await db.exec(`update public.customer_portal_accounts set external_account_id='duplicate' where id=${quote(row)};
      insert into public.customer_portal_accounts(id,company_id,customer_id,user_id,is_active,status,external_account_id) values(gen_random_uuid(),${quote(company)},${quote(primary)},${quote(actor)},true,'active','duplicate')`)
    await refusedOperation(() => merge(), 'customer_merge_ambiguous_portal_subject')
  })
  it('keeps foreign-company sources hidden and rolls back preceding moves', async () => {
    await apply(); await refusedOperation(() => merge([source, foreign]), 'customer_merge_source_not_found_for_tenant')
  })
  it('preserves an existing signed-contract immutability refusal and rolls back earlier site moves', async () => {
    await apply(); await db.exec(`update public.customer_contracts set signed_fixture=true where id=${quote(row)}`)
    await refusedOperation(() => merge(), 'signed_contract_immutable')
  })
  it('rolls back the complete graph if a later unique collision occurs', async () => {
    await apply(); await db.exec(`insert into public.customer_portal_accounts(id,company_id,customer_id,user_id) values(gen_random_uuid(),${quote(company)},${quote(primary)},${quote(row)})`)
    await db.exec('savepoint collision')
    await expect(merge()).rejects.toMatchObject({ code: '23505' })
    await db.exec('rollback to savepoint collision;release savepoint collision')
    expect((await rows('customers')).find(x => x.id === source)?.merged_into_customer_id).toBeNull()
    expect((await rows('customer_sites')).find(x => x.id === row)?.customer_id).toBe(source)
    expect(await rows('customer_merge_events')).toHaveLength(0)
  })
  it('rechecks deferred owner FKs before returning and rolls back all state on a late mismatch', async () => {
    await apply(); await db.exec(`create function public.fixture_break_owner() returns trigger language plpgsql as $$begin
      update public.customer_case_attachments set customer_case_id='00000000-0000-4000-8000-000000000999';return new;end$$;
      create trigger fixture_late_owner_mismatch after update on public.customers for each row when(new.merged_into_customer_id is not null) execute function public.fixture_break_owner()`)
    const before = await businessSnapshot(); await db.exec('savepoint late_ri')
    await expect(merge()).rejects.toMatchObject({ code: '23503' })
    await db.exec('rollback to savepoint late_ri;release savepoint late_ri'); expect(await businessSnapshot()).toEqual(before)
  })
  it.each([
    ['merge invoker', `alter function ${signatures.merge} security invoker`],
    ['merge path', `alter function ${signatures.merge} set search_path=public`],
    ['merge strict', `alter function ${signatures.merge} strict`],
    ['merge stable', `alter function ${signatures.merge} stable`],
    ['merge cost', `alter function ${signatures.merge} cost 200`],
    ['merge parallel', `alter function ${signatures.merge} parallel safe`],
    ['merge extra config', `alter function ${signatures.merge} set statement_timeout='1s'`],
    ['merge anon ACL', `grant execute on function ${signatures.merge} to anon`],
    ['merge grant option', `grant execute on function ${signatures.merge} to service_role with grant option`],
    ['merge owner', `alter function ${signatures.merge} owner to fixture_other`],
    ['merge overload', `create function public.gridex_merge_customers_v1(text) returns jsonb language plpgsql as $$begin return '{}'::jsonb;end$$`],
    ['guard invoker', `alter function ${signatures.guard} security invoker`],
    ['guard PUBLIC ACL', `grant execute on function ${signatures.guard} to public`],
    ['contact invoker drift', `alter function ${signatures.contact} security definer`],
    ['contact ACL drift', `grant execute on function ${signatures.contact} to authenticated`],
    ['existing guard disabled', 'alter table public.customer_contacts disable trigger guard_merged_portal_customer_write'],
    ['one preguard missing', 'drop trigger guard_merged_portal_customer_write on public.customer_contacts'],
    ['partial trigger repair', 'create trigger guard_merged_portal_customer_write before insert or update of company_id,customer_id on public.customer_portal_requests for each row execute function public.gridex_guard_merged_portal_customer_write()'],
    ['unexpected alias', 'create trigger fixture_guard_alias before insert on public.customer_contacts for each row execute function public.gridex_guard_merged_portal_customer_write()'],
    ['one extra deferred flag', 'alter table public.customer_case_events alter constraint customer_case_events_case_owner_fk deferrable initially deferred'],
    ['partial FK repair', 'alter table public.customer_case_attachments alter constraint customer_case_attachments_case_owner_fk deferrable initially immediate'],
    ['duplicate constraint name', 'alter table public.customer_addresses add constraint customer_case_events_case_owner_fk check(true)'],
  ])('fails closed on %s without changing any catalog state', async (_label, sql) => { await db.exec(sql); await rejectedApply() })
  it('rejects an unknown merge body rather than rebaselining it', async () => {
    await db.exec(replaceBody(oldDefinition, oldBody + '\n-- unknown source\n')); await rejectedApply()
  })
  it('rejects new argument defaults before replacing an otherwise known merge body', async () => {
    await db.exec(replaceBody(oldDefinition, oldBody).replace('p_reason text', "p_reason text default 'unknown'"))
    await rejectedApply()
  })
  it('rejects a canonical merge with only the observed partial guard/FK installation', async () => {
    await db.exec(replaceBody(oldDefinition, canonicalBody)); await rejectedApply()
  })
  it('checks protected ACLs before returning from a known complete-post no-op', async () => {
    await apply(); await db.exec(`grant execute on function ${signatures.contact} to anon`); await rejectedApply()
  })
  it('rejects a missing owner FK instead of fabricating or validating it', async () => {
    await db.exec('alter table public.customer_case_attachments drop constraint customer_case_attachments_case_owner_fk'); await rejectedApply()
  })
  it('rejects a NOT VALID legacy owner FK instead of validating data implicitly', async () => {
    const fk = fks.find(x => x.name === 'customer_case_attachments_case_owner_fk')!
    await db.exec(`alter table public.${fk.table} drop constraint ${fk.name};alter table public.${fk.table} ${fk.ddl.replace(' DEFERRABLE','')} not valid`); await rejectedApply()
  })
  it('rejects an unknown trigger shape in a previously missing slot', async () => {
    await db.exec('create trigger guard_merged_portal_customer_write before insert on public.customer_portal_requests for each row execute function public.gridex_guard_merged_portal_customer_write()'); await rejectedApply()
  })
  it('rejects a changed owner-FK delete action rather than replacing the existing constraint', async () => {
    const fk = fks.find(x => x.name === 'customer_case_attachments_case_owner_fk')!
    await db.exec(`alter table public.${fk.table} drop constraint ${fk.name};alter table public.${fk.table} ${fk.ddl.replace(' DEFERRABLE', '').replace('ON DELETE CASCADE', 'ON DELETE SET NULL')}`)
    await rejectedApply()
  })
  it('rejects a WHEN-qualified trigger occupying a previously missing guard slot', async () => {
    await db.exec(`create trigger guard_merged_portal_customer_write before insert or update of company_id,customer_id
      on public.customer_portal_requests for each row when(new.customer_id is not null) execute function public.gridex_guard_merged_portal_customer_write()`)
    await rejectedApply()
  })
  it('rolls back all five new triggers and FK deferrability when final function-DDL changes a protected ACL', async () => {
    await db.exec(`create function public.fixture_late_metadata_drift() returns event_trigger language plpgsql as $$begin
      grant execute on function ${signatures.contact} to anon;end$$;
      create event trigger fixture_late_metadata_drift on ddl_command_end when tag in('CREATE FUNCTION') execute function public.fixture_late_metadata_drift()`)
    await rejectedApply()
    expect(hash((await functionRow(signatures.merge)).source)).toBe(hashes.old)
    expect((await db.query(`select count(*)::int as n from pg_trigger where tgname='guard_merged_portal_customer_write'`)).rows).toEqual([{ n: 8 }])
    expect((await db.query(`select condeferrable as deferred from pg_constraint where conname='customer_case_attachments_case_owner_fk'`)).rows).toEqual([{ deferred: false }])
  })
  it('rechecks the five newly created guards after the final DDL rather than masking a late disabled trigger', async () => {
    await db.exec(`create function public.fixture_new_guard_drift() returns event_trigger language plpgsql as $$begin
      alter table public.customer_portal_requests disable trigger guard_merged_portal_customer_write;end$$;
      create event trigger fixture_new_guard_drift on ddl_command_end when tag in('CREATE FUNCTION') execute function public.fixture_new_guard_drift()`)
    await rejectedApply()
  })
})
