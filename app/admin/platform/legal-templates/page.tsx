import Link from 'next/link'

import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { REQUIRED_LEGAL_TEXT_TYPES } from '@/lib/opsMaster/readiness'
import { legalTypeLabel } from '@/lib/tenant/legalDefaults'
import {
  LEGAL_TEMPLATE_PLACEHOLDERS,
  legalTemplatePlaceholderValues,
  listLegalTemplateCompanies,
  listPlatformLegalTemplates,
  renderTenantLegalTemplate,
  type LegalTemplateCompany,
  type PlatformLegalTemplate,
} from '@/lib/legal/platformLegalTemplates'
import {
  archivePlatformLegalTemplateAction,
  copyPublishedTemplatesToTenantsAction,
  createPlatformLegalTemplateAction,
  publishPlatformLegalTemplateAction,
  updateDraftPlatformLegalTemplateAction,
} from './actions'

export const dynamic = 'force-dynamic'

type ActionSearchParams = Record<string, string | string[] | undefined>

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function ActionBanner({ success, error }: { success?: string; error?: string }) {
  if (!success && !error) return null
  return (
    <div className={success ? 'rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900' : 'rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900'}>
      {success ?? error}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'published'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'draft'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-50 text-slate-700'
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${tone}`}>{status}</span>
}

function TemplateStats({ templates }: { templates: PlatformLegalTemplate[] }) {
  const publishedByType = new Set(templates.filter((template) => template.status === 'published').map((template) => template.type))
  const missing = REQUIRED_LEGAL_TEXT_TYPES.filter((type) => !publishedByType.has(type))
  const drafts = templates.filter((template) => template.status === 'draft').length
  return (
    <section className="grid gap-4 sm:grid-cols-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Master templates</p>
        <p className="mt-2 text-3xl font-black text-slate-950">{templates.length}</p>
      </div>
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Published types</p>
        <p className="mt-2 text-3xl font-black text-emerald-950">{publishedByType.size}/5</p>
      </div>
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Drafts</p>
        <p className="mt-2 text-3xl font-black text-amber-950">{drafts}</p>
      </div>
      <div className={missing.length === 0 ? 'rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm' : 'rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm'}>
        <p className={missing.length === 0 ? 'text-xs font-black uppercase tracking-[0.18em] text-emerald-700' : 'text-xs font-black uppercase tracking-[0.18em] text-red-700'}>Missing</p>
        <p className={missing.length === 0 ? 'mt-2 text-sm font-black text-emerald-950' : 'mt-2 text-sm font-black text-red-950'}>{missing.length === 0 ? 'Complete' : missing.map(legalTypeLabel).join(', ')}</p>
      </div>
    </section>
  )
}

function CreateTemplateForm() {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Create master template</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">New platform legal template</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-700">
            Master templates are copied into tenants as immutable tenant legal versions. Use placeholders like {'{{company_name}}'} and {'{{org_number}}'} so OPS can render tenant-specific versions.
          </p>
        </div>
        <Link href="/admin/platform/legal-readiness" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-100">
          Legal readiness
        </Link>
      </div>

      <form action={createPlatformLegalTemplateAction} className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm font-bold text-slate-800">
          Type
          <select name="type" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required>
            {REQUIRED_LEGAL_TEXT_TYPES.map((type) => <option key={type} value={type}>{legalTypeLabel(type)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-800">
          Version
          <input name="version" placeholder="gridex-standard-2026-07" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required />
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-800 md:col-span-2">
          Title
          <input name="title" placeholder="Power of attorney for {{brand_name}}" className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required />
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-800 md:col-span-2">
          Body
          <textarea name="body" rows={8} placeholder="{{company_name}}, org. no. {{org_number}}, is authorized to..." className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <input type="checkbox" name="publish_now" /> Publish immediately
        </label>
        <div className="md:col-span-2">
          <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Create template</button>
        </div>
      </form>
    </section>
  )
}

function PlaceholdersCard({ previewCompany }: { previewCompany: LegalTemplateCompany | null }) {
  const values = previewCompany ? legalTemplatePlaceholderValues(previewCompany) : null
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Placeholder contract</p>
      <h2 className="mt-2 text-xl font-black text-slate-950">Supported tenant placeholders</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {LEGAL_TEMPLATE_PLACEHOLDERS.map((placeholder) => (
          <div key={placeholder} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <code className="text-xs font-black text-slate-900">{'{{'}{placeholder}{'}}'}</code>
            {values ? <p className="mt-1 truncate text-xs font-semibold text-slate-600">{values[placeholder] || 'missing for preview tenant'}</p> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function BulkCopyForm({ companies }: { companies: LegalTemplateCompany[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Bulk tenant generation</p>
      <h2 className="mt-2 text-xl font-black text-slate-950">Copy latest published master templates to tenants</h2>
      <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-700">
        This creates tenant-specific legal versions from the latest published master templates. It does not mutate existing published tenant versions. By default it only fills missing published legal types.
      </p>

      <form action={copyPublishedTemplatesToTenantsAction} className="mt-5 grid gap-4">
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-center gap-2 text-sm font-black text-slate-800">
            <input type="checkbox" name="all_companies" /> Apply to all tenants below
          </label>
          <label className="flex items-center gap-2 text-sm font-black text-slate-800">
            <input type="checkbox" name="only_missing" defaultChecked /> Only create missing published legal types
          </label>
          <label className="flex items-center gap-2 text-sm font-black text-slate-800">
            <input type="checkbox" name="publish_now" defaultChecked /> Publish generated tenant versions immediately
          </label>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-500">
              <tr><th className="px-4 py-3">Select</th><th className="px-4 py-3">Tenant</th><th className="px-4 py-3">Org no.</th><th className="px-4 py-3">Support email</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {companies.map((company) => (
                <tr key={company.id}>
                  <td className="px-4 py-3"><input type="checkbox" name="company_ids" value={company.id} /></td>
                  <td className="px-4 py-3 font-bold text-slate-900">{company.name ?? company.id}</td>
                  <td className="px-4 py-3 text-slate-700">{company.org_number ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{company.support_email ?? company.primary_contact_email ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{company.status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Generate tenant legal versions</button>
        </div>
      </form>
    </section>
  )
}

function TemplatePreview({ template, company }: { template: PlatformLegalTemplate; company: LegalTemplateCompany | null }) {
  if (!company) return null
  const rendered = renderTenantLegalTemplate(template, company)
  return (
    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <summary className="cursor-pointer text-sm font-black text-slate-900">Preview rendered for {company.name ?? 'tenant'}</summary>
      <div className="mt-3 grid gap-3 text-sm">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Title</p>
          <p className="mt-1 font-bold text-slate-900">{rendered.title}</p>
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Body</p>
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs font-semibold leading-5 text-slate-700">{rendered.body}</pre>
        </div>
        {rendered.missingPlaceholders.length > 0 ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-black text-amber-900">Missing placeholders for preview tenant: {rendered.missingPlaceholders.join(', ')}</p>
        ) : null}
      </div>
    </details>
  )
}

function TemplateCard({ template, previewCompany }: { template: PlatformLegalTemplate; previewCompany: LegalTemplateCompany | null }) {
  const canEdit = template.status === 'draft'
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{legalTypeLabel(template.type)}</p>
            <StatusBadge status={template.status} />
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-950">{template.title}</h3>
          <p className="mt-1 text-sm font-semibold text-slate-600">Version {template.version} · Published {formatDate(template.published_at)} · Updated {formatDate(template.updated_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {template.status !== 'published' ? (
            <form action={publishPlatformLegalTemplateAction}>
              <input type="hidden" name="id" value={template.id} />
              <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-800 hover:bg-emerald-100">Publish</button>
            </form>
          ) : null}
          {template.status !== 'archived' ? (
            <form action={archivePlatformLegalTemplateAction}>
              <input type="hidden" name="id" value={template.id} />
              <button className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100">Archive</button>
            </form>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <form action={updateDraftPlatformLegalTemplateAction} className="mt-5 grid gap-3">
          <input type="hidden" name="id" value={template.id} />
          <label className="grid gap-1 text-sm font-bold text-slate-800">
            Title
            <input name="title" defaultValue={template.title} className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required />
          </label>
          <label className="grid gap-1 text-sm font-bold text-slate-800">
            Body
            <textarea name="body" defaultValue={template.body} rows={8} className="rounded-2xl border border-slate-300 bg-white px-4 py-3" required />
          </label>
          <div>
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Save draft</button>
          </div>
        </form>
      ) : (
        <pre className="mt-5 max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-semibold leading-5 text-slate-700">{template.body}</pre>
      )}

      <div className="mt-4">
        <TemplatePreview template={template} company={previewCompany} />
      </div>
    </article>
  )
}

export default async function PlatformLegalTemplatesPage({ searchParams }: { searchParams?: Promise<ActionSearchParams> }) {
  const admin = await requirePlatformAdminAccess()
  const params = searchParams ? await searchParams : {}
  const success = firstSearchValue(params.success)
  const error = firstSearchValue(params.error)

  const [templates, companies] = await Promise.all([
    listPlatformLegalTemplates(),
    listLegalTemplateCompanies(500),
  ])
  const previewCompany = companies.find((company) => company.org_number || company.support_email) ?? companies[0] ?? null
  const publishedTemplates = templates.filter((template) => template.status === 'published')
  const draftTemplates = templates.filter((template) => template.status === 'draft')
  const archivedTemplates = templates.filter((template) => template.status === 'archived')

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Master legal templates"
        subtitle="Superadmin UI for global legal templates, tenant placeholder rendering and bulk generation of tenant legal bundles."
        userEmail={admin.email}
        workspaceMode="platform"
      />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <ActionBanner success={success} error={error} />
        <TemplateStats templates={templates} />
        <CreateTemplateForm />
        <PlaceholdersCard previewCompany={previewCompany} />
        <BulkCopyForm companies={companies} />

        <section className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Published</p>
              <h2 className="mt-2 text-xl font-black text-slate-950">Active master templates</h2>
            </div>
            <p className="text-sm font-bold text-slate-600">One published template per type should exist.</p>
          </div>
          {publishedTemplates.length === 0 ? <p className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900">No published master templates found.</p> : null}
          {publishedTemplates.map((template) => <TemplateCard key={template.id} template={template} previewCompany={previewCompany} />)}
        </section>

        <section className="space-y-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Drafts</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">Editable draft templates</h2>
          </div>
          {draftTemplates.length === 0 ? <p className="rounded-3xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">No draft templates.</p> : null}
          {draftTemplates.map((template) => <TemplateCard key={template.id} template={template} previewCompany={previewCompany} />)}
        </section>

        <section className="space-y-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Archive</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">Archived master templates</h2>
          </div>
          {archivedTemplates.length === 0 ? <p className="rounded-3xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">No archived templates.</p> : null}
          {archivedTemplates.map((template) => <TemplateCard key={template.id} template={template} previewCompany={previewCompany} />)}
        </section>
      </div>
    </div>
  )
}
