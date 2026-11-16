'use client'

import { useState } from 'react'

type CustomerOption = { id: string; label: string; sublabel: string | null }
type SiteOption = { id: string; customerId: string; label: string; sublabel: string | null }
type MeteringPointOption = { id: string; siteId: string; customerId: string | null; label: string; sublabel: string | null }

const selectClass = 'h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm'

/** Customer, site and metering-point selects where site/meter options follow the chosen customer. */
export default function CustomerResourceSelects({
  customers,
  sites,
  meteringPoints,
  showSiteAndMeter = true,
}: {
  customers: CustomerOption[]
  sites: SiteOption[]
  meteringPoints: MeteringPointOption[]
  showSiteAndMeter?: boolean
}) {
  const [customerId, setCustomerId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [meteringPointId, setMeteringPointId] = useState('')

  const visibleSites = customerId ? sites.filter((site) => site.customerId === customerId) : []
  const visibleMeteringPoints = customerId
    ? meteringPoints.filter((point) => point.customerId === customerId && (!siteId || point.siteId === siteId))
    : []

  return (
    <>
      <select
        name="customer_id"
        aria-label="Kund"
        required
        value={customerId}
        onChange={(event) => {
          setCustomerId(event.target.value)
          setSiteId('')
          setMeteringPointId('')
        }}
        className={selectClass}
      >
        <option value="">Välj kund</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.label}{customer.sublabel ? ` — ${customer.sublabel}` : ''}
          </option>
        ))}
      </select>
      {showSiteAndMeter ? (
        <>
          <select
            name="site_id"
            aria-label="Anläggning"
            value={siteId}
            disabled={!customerId}
            onChange={(event) => {
              setSiteId(event.target.value)
              setMeteringPointId('')
            }}
            className={`${selectClass} disabled:opacity-60`}
          >
            <option value="">{!customerId ? 'Välj kund först' : visibleSites.length === 0 ? 'Kunden har inga anläggningar' : 'Välj anläggning för Z01/Z02'}</option>
            {visibleSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.label}{site.sublabel ? ` — ${site.sublabel}` : ''}
              </option>
            ))}
          </select>
          <select
            name="metering_point_id"
            aria-label="Mätpunkt"
            value={meteringPointId}
            disabled={!customerId}
            onChange={(event) => setMeteringPointId(event.target.value)}
            className={`${selectClass} disabled:opacity-60`}
          >
            <option value="">{!customerId ? 'Välj kund först' : visibleMeteringPoints.length === 0 ? 'Inga mätpunkter för valet' : 'Välj mätpunkt för Z01/Z02'}</option>
            {visibleMeteringPoints.map((point) => (
              <option key={point.id} value={point.id}>
                {point.label}{point.sublabel ? ` — ${point.sublabel}` : ''}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </>
  )
}
