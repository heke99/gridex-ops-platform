import AdminHeader from '@/components/admin/AdminHeader'
import EdielRuleGroups from '@/components/admin/ediel/EdielRuleGroups'
import EdielRuleTemplateModals from '@/components/admin/ediel/EdielRuleTemplateModals'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { loadPlatformEdielRuleOverview } from '@/lib/ediel/platformRules'
import { saveEdielMessageRuleAction } from '@/app/admin/ediel/settings/actions'

export const dynamic = 'force-dynamic'

function inputClassName() {
  return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500'
}

function selectClassName() {
  return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900'
}

function Input({
  name,
  defaultValue,
  placeholder,
  type = 'text',
}: {
  name: string
  defaultValue?: string | number | null
  placeholder?: string
  type?: string
}) {
  return <input name={name} type={type} defaultValue={defaultValue ?? ''} placeholder={placeholder} className={inputClassName()} />
}

function Select({
  name,
  defaultValue,
  children,
}: {
  name: string
  defaultValue?: string | number | null
  children: React.ReactNode
}) {
  return (
    <select name={name} defaultValue={defaultValue == null ? '' : String(defaultValue)} className={selectClassName()}>
      {children}
    </select>
  )
}

function Checkbox({ name, defaultChecked, label }: { name: string; defaultChecked?: boolean; label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} className="h-4 w-4 rounded border-slate-300" />
      <span>{label}</span>
    </label>
  )
}

function KpiCard({ label, value, description, tone = 'slate' }: { label: string; value: number; description: string; tone?: 'slate' | 'emerald' | 'amber' }) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-slate-200 bg-white text-slate-950'

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${toneClass}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-2 text-sm leading-5 opacity-80">{description}</p>
    </div>
  )
}

export default async function PlatformEdielRulesPage() {
  const admin = await requirePlatformAdminAccess()
  const overview = await loadPlatformEdielRuleOverview()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Globala Ediel-regler"
        subtitle="Plattformsnivå för Ediel-versioner, message rules och runtime-val. Bolagssidor får inte ändra dessa regler."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 xl:grid-cols-4">
          <KpiCard label="Aktiva regler" value={overview.activeRuleCount} description="Regler som kan användas av runtime." tone="emerald" />
          <KpiCard label="Regler med negativ respons" value={overview.negativeSupportCount} description="Regler som stödjer negativ APERAK/valideringsrespons." />
          <KpiCard label="Runtime-ambiguiteter" value={overview.ambiguousRuntimeCount} description="Family/code där flera aktiva regler behöver granskas." tone={overview.ambiguousRuntimeCount > 0 ? 'amber' : 'slate'} />
          <KpiCard label="Previous-valid" value={overview.previousValidCount} description="Flöden där närmast föregående version accepteras inbound." />
        </section>

        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Regelstyrning på plattformsnivå</h2>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">
            Den här sidan är avsiktligt separerad från bolagens Ediel-inställningar. Bolag hanterar aktörsprofil, mailbox och transportuppgifter på `/admin/ediel/settings`; globala versioner och runtime-regler hanteras endast här.
          </p>
        </section>

        <EdielRuleTemplateModals hasProdatRule={overview.hasProdatRule} />

        <EdielRuleGroups groups={overview.ruleGroups} />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900">Skapa ny global message rule</h2>
            <p className="mt-1 text-sm text-slate-700">Endast superadmin/platform admin får skapa eller ändra dessa regler.</p>
          </div>

          <form action={saveEdielMessageRuleAction} className="rounded-2xl border border-dashed border-slate-300 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Input name="message_family" placeholder="PRODAT / UTILTS / APERAK ..." />
              <Input name="message_code" placeholder="Z03 / E66 / CONTRL ..." />
              <Select name="message_standard" defaultValue="edifact">
                <option value="edifact">edifact</option>
                <option value="xml">xml</option>
                <option value="ai_list">ai_list</option>
              </Select>
              <Input name="version_code" placeholder="E5SE5A / Ver20140401 ..." />
              <Select name="direction" defaultValue="both">
                <option value="both">both</option>
                <option value="inbound">inbound</option>
                <option value="outbound">outbound</option>
              </Select>
              <Input name="valid_from" type="date" />
              <Input name="valid_to" type="date" />
              <Input name="notes" placeholder="Intern anteckning" />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <Checkbox name="requires_contrl" label="Kräver CONTRL" />
              <Checkbox name="requires_aperak" label="Kräver APERAK" />
              <Checkbox name="supports_negative_response" label="Stödjer negativ respons" />
              <Checkbox name="is_active" defaultChecked label="Aktiv regel" />
              <button type="submit" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black">
                Skapa regel
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
