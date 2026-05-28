"use client";

import { useActionState, type ReactNode } from "react";
import Link from "next/link";
import CustomerIntakeEnhancer from "@/components/admin/customers/CustomerIntakeEnhancer";
import { createCustomerAction } from "@/app/admin/customers/actions";
import { createCustomerDataRequestPackageAction } from "@/app/admin/customers/[id]/actions";
import {
  initialIntakeActionState,
  type IntakeActionState,
} from "@/app/admin/customers/actionState";

type GridOwnerOption = {
  id: string;
  name: string;
};

type PriceAreaOption = {
  code: string;
  name: string;
};

type ContractOfferOption = {
  id: string;
  name: string;
  contract_type: "fixed" | "variable_monthly" | "variable_hourly" | "portfolio";
  fixed_price_ore_per_kwh: number | null;
  spot_markup_ore_per_kwh: number | null;
  variable_fee_ore_per_kwh: number | null;
  monthly_fee_sek: number | null;
  green_fee_mode: "none" | "sek_month" | "ore_per_kwh";
  green_fee_value: number | null;
  default_binding_months: number | null;
  default_notice_months: number | null;
  optional_fee_lines: Array<Record<string, unknown>> | null;
};

type SupplierOption = {
  id: string;
  name: string;
  org_number: string | null;
  ediel_id: string | null;
  email: string | null;
};

type Props = {
  gridOwners: GridOwnerOption[];
  electricitySuppliers: SupplierOption[];
  priceAreas: PriceAreaOption[];
  contractOffers: ContractOfferOption[];
};

function inputClassName(
  state: IntakeActionState,
  fieldName: string,
  span?: "full",
) {
  const hasError = Boolean(
    state.fieldErrors[fieldName as keyof typeof state.fieldErrors],
  );

  return `rounded-2xl border px-4 py-3 ${
    hasError ? "border-red-500 bg-red-50 text-red-950 " : "border-slate-300 "
  }${span === "full" ? " md:col-span-2" : ""}`;
}

function FieldError({
  state,
  name,
}: {
  state: IntakeActionState;
  name: string;
}) {
  const error = state.fieldErrors[name as keyof typeof state.fieldErrors];
  if (!error) return null;

  return <span className="text-xs font-medium text-red-600">{error}</span>;
}


function postCreateActionLabel(value: IntakeActionState["postCreateAction"]): string {
  switch (value) {
    case "request_data":
      return "Begär uppgifter direkt";
    case "create_new":
      return "Skapa ny kund efteråt";
    default:
      return "Öppna kundkort";
  }
}

function requestTargetLabel(value: IntakeActionState["postCreateRequestTarget"]): string {
  switch (value) {
    case "grid_owner":
      return "Nätägare";
    case "current_supplier":
      return "Nuvarande leverantör";
    default:
      return "Nätägare och nuvarande leverantör";
  }
}

function CreatedCustomerNextSteps({ state }: { state: IntakeActionState }) {
  if (!state.createdCustomerId) return null;

  const customerHref = `/admin/customers/${state.createdCustomerId}`;
  const dataRequestsHref = `${customerHref}?tab=data-requests#data-requests`;
  const defaultRequestTarget = state.postCreateRequestTarget ?? "both";
  const showRequestFirst = state.postCreateAction === "request_data";

  return (
    <div className="mt-4 rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">Nästa steg</p>
          <p className="mt-1 text-slate-700">
            Valt flöde: {postCreateActionLabel(state.postCreateAction)}.
          </p>
        </div>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
          Kund skapad
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={customerHref}
          className="inline-flex rounded-xl border border-emerald-300 px-3 py-2 font-semibold text-emerald-900 hover:bg-emerald-50"
        >
          Öppna kundkort
        </Link>
        <Link
          href="/admin/customers/intake?new=1"
          className="inline-flex rounded-xl border border-slate-300 px-3 py-2 font-semibold text-slate-800 hover:bg-slate-50"
        >
          Skapa ny kund
        </Link>
        <Link
          href={dataRequestsHref}
          className="inline-flex rounded-xl border border-slate-300 px-3 py-2 font-semibold text-slate-800 hover:bg-slate-50"
        >
          Gå till uppgiftsbegäran
        </Link>
      </div>

      <div className={`mt-4 rounded-2xl border p-4 ${showRequestFirst ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
        <p className="font-semibold text-slate-950">Begär uppgifter direkt</p>
        <p className="mt-1 text-xs leading-5 text-slate-700">
          Välj mottagare och skapa begäran utan att leta i kundkortet. Saknas signerad fullmakt stoppar systemet utskicket och lägger en tydlig blockerare på kunden.
        </p>

        <form action={createCustomerDataRequestPackageAction} className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <input type="hidden" name="customer_id" value={state.createdCustomerId} />
          <input type="hidden" name="redirect_after_submit" value="customer_data_requests" />
          <input type="hidden" name="site_id" value={state.createdSiteId ?? ""} />
          <input type="hidden" name="metering_point_id" value={state.createdMeteringPointId ?? ""} />
          <input type="hidden" name="grid_owner_id" value={state.createdGridOwnerId ?? ""} />
          <input type="hidden" name="power_of_attorney_id" value={state.createdPowerOfAttorneyId ?? ""} />
          <input type="hidden" name="current_supplier_name" value={state.createdCurrentSupplierName ?? ""} />
          <input type="hidden" name="external_reference" value="Direkt efter kundskapande" />
          <input type="hidden" name="notes" value="Uppgiftsbegäran skapad direkt efter kundintag." />

          <label className="grid gap-1">
            <span className="text-xs font-semibold text-slate-700">Begär från</span>
            <select
              name="request_target"
              defaultValue={defaultRequestTarget}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950"
            >
              <option value="grid_owner">Nätägare</option>
              <option value="current_supplier">Nuvarande leverantör</option>
              <option value="both">Båda</option>
            </select>
            <span className="text-xs text-slate-600">
              Standard: {requestTargetLabel(defaultRequestTarget)}.
            </span>
          </label>

          <button
            type="submit"
            className="self-end rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Skapa begäran
          </button>
        </form>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700">
        {title}
      </h3>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-slate-700">{description}</p>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

export default function CustomerIntakeForm({
  gridOwners,
  electricitySuppliers,
  priceAreas,
  contractOffers,
}: Props) {
  const [state, formAction, isPending] = useActionState(
    createCustomerAction,
    initialIntakeActionState,
  );

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">Registrera kund</h2>
      <p className="mt-1 text-sm leading-6 text-slate-700">
        Skapa kunden även när data saknas. Systemet sparar kunden och lägger
        saknade uppgifter, möjliga dubbletter och spärrar som blockerare på
        kundkortet.
      </p>


      {state.status === "success" && state.message ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-semibold">Klart.</p>
          <p className="mt-1">{state.message}</p>
          {state.duplicateReviewRequired && state.duplicateWarnings?.length ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-amber-900">
              <div className="font-semibold">Möjlig dubblett behöver granskas.</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {state.duplicateWarnings.slice(0, 3).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <CreatedCustomerNextSteps state={state} />
        </div>
      ) : null}

      <form
        action={formAction}
        className="mt-6 space-y-6"
        data-customer-intake-form
        encType="multipart/form-data"
      >
        {state.status === "error" && state.message ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <p className="font-semibold">
              Kunden kunde inte sparas på grund av ett tekniskt eller
              formatmässigt fel.
            </p>
            <p className="mt-1">{state.message}</p>
          </div>
        ) : null}

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Operativt intag</p>
          <p className="mt-1">
            Ofullständiga kunder, avtal och dokument får sparas. Blockerare
            stoppar senare utskick, leverantörsbyte eller export när kritisk
            data saknas.
          </p>
        </div>

        <Section
          title="1. Kund"
          description="Minsta möjliga kunddata. Saknas något skapas blockerare i stället för totalstopp."
        >
          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Kundtyp</span>
            <select
              name="customerType"
              defaultValue={state.values.customerType ?? "private"}
              className={inputClassName(state, "customerType")}
            >
              <option value="private">Privatkund</option>
              <option value="business">Företagskund</option>
              <option value="association">Förening</option>
            </select>
            <FieldError state={state} name="customerType" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Flöde</span>
            <select
              name="intakeFlowType"
              defaultValue={state.values.intakeFlowType ?? "switch"}
              className={inputClassName(state, "intakeFlowType")}
            >
              <option value="switch">Byte av leverantör</option>
              <option value="move_in">Inflytt / flytt</option>
              <option value="move_out_takeover">Övertag vid utflytt</option>
            </select>
            <FieldError state={state} name="intakeFlowType" />
          </label>

          <label
            className="grid gap-1 text-sm"
            data-customer-section="private business association"
          >
            <span
              className="text-slate-700"
              data-label-for-customer
              data-label-private="Förnamn"
              data-label-business="Kontaktperson förnamn"
              data-label-association="Kontaktperson förnamn"
            >
              Förnamn
            </span>
            <input
              name="firstName"
              defaultValue={state.values.firstName ?? ""}
              placeholder="Förnamn"
              className={inputClassName(state, "firstName")}
            />
            <FieldError state={state} name="firstName" />
          </label>

          <label
            className="grid gap-1 text-sm"
            data-customer-section="private business association"
          >
            <span
              className="text-slate-700"
              data-label-for-customer
              data-label-private="Efternamn"
              data-label-business="Kontaktperson efternamn"
              data-label-association="Kontaktperson efternamn"
            >
              Efternamn
            </span>
            <input
              name="lastName"
              defaultValue={state.values.lastName ?? ""}
              placeholder="Efternamn"
              className={inputClassName(state, "lastName")}
            />
            <FieldError state={state} name="lastName" />
          </label>

          <label
            className="grid gap-1 text-sm md:col-span-2"
            data-customer-section="business association"
          >
            <span
              className="text-slate-700"
              data-label-for-customer
              data-label-business="Företagsnamn"
              data-label-association="Föreningsnamn"
            >
              Företags- / föreningsnamn
            </span>
            <input
              name="companyName"
              defaultValue={state.values.companyName ?? ""}
              placeholder="Företags- eller föreningsnamn"
              className={inputClassName(state, "companyName", "full")}
            />
            <FieldError state={state} name="companyName" />
          </label>

          <label
            className="grid gap-1 text-sm"
            data-customer-section="business association"
          >
            <span className="text-slate-700">Kontaktperson titel</span>
            <input
              name="contactTitle"
              defaultValue={state.values.contactTitle ?? ""}
              placeholder="Ex. VD, administratör, ordförande"
              className={inputClassName(state, "contactTitle")}
            />
            <FieldError state={state} name="contactTitle" />
          </label>

          <label className="grid gap-1 text-sm" data-customer-section="private">
            <span className="text-slate-700">Lägenhetsnummer</span>
            <input
              name="apartmentNumber"
              defaultValue={state.values.apartmentNumber ?? ""}
              placeholder="Lägenhetsnummer"
              className={inputClassName(state, "apartmentNumber")}
            />
            <FieldError state={state} name="apartmentNumber" />
          </label>

          <label className="grid gap-1 text-sm" data-customer-section="private">
            <span className="text-slate-700">Personnummer</span>
            <input
              name="personalNumber"
              defaultValue={state.values.personalNumber ?? ""}
              placeholder="Personnummer"
              className={inputClassName(state, "personalNumber")}
            />
            <FieldError state={state} name="personalNumber" />
          </label>

          <label
            className="grid gap-1 text-sm"
            data-customer-section="business association"
          >
            <span className="text-slate-700">Organisationsnummer</span>
            <input
              name="orgNumber"
              defaultValue={state.values.orgNumber ?? ""}
              placeholder="Organisationsnummer"
              className={inputClassName(state, "orgNumber")}
            />
            <FieldError state={state} name="orgNumber" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">E-post</span>
            <input
              type="email"
              name="email"
              defaultValue={state.values.email ?? ""}
              placeholder="kund@exempel.se"
              className={inputClassName(state, "email")}
            />
            <FieldError state={state} name="email" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Telefon</span>
            <input
              name="phone"
              defaultValue={state.values.phone ?? ""}
              placeholder="0701234567"
              className={inputClassName(state, "phone")}
            />
            <FieldError state={state} name="phone" />
          </label>
        </Section>

        <Section
          title="2. Anläggning"
          description="Anläggning och mätpunkt skapas om information finns. Saknade uppgifter blir blockerare."
        >
          <label
            className="grid gap-1 text-sm md:col-span-2"
            data-flow-section="switch move_in move_out_takeover"
          >
            <span
              className="text-slate-700"
              data-label-for-flow
              data-label-switch="Anläggningsadress"
              data-label-move_in="Ny adress kunden flyttar till"
              data-label-move_out_takeover="Adress som tas över"
            >
              Anläggningsadress
            </span>
            <input
              name="street"
              defaultValue={state.values.street ?? ""}
              placeholder="Gatuadress"
              className={inputClassName(state, "street", "full")}
            />
            <FieldError state={state} name="street" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Postnummer</span>
            <input
              name="postalCode"
              defaultValue={state.values.postalCode ?? ""}
              placeholder="123 45"
              className={inputClassName(state, "postalCode")}
            />
            <FieldError state={state} name="postalCode" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Ort</span>
            <input
              name="city"
              defaultValue={state.values.city ?? ""}
              placeholder="Ort"
              className={inputClassName(state, "city")}
            />
            <FieldError state={state} name="city" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Land</span>
            <select
              name="country"
              defaultValue={state.values.country ?? "SE"}
              className={inputClassName(state, "country")}
            >
              <option value="SE">Sverige</option>
            </select>
            <FieldError state={state} name="country" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">c/o</span>
            <input
              name="careOf"
              defaultValue={state.values.careOf ?? ""}
              placeholder="c/o"
              className={inputClassName(state, "careOf")}
            />
            <FieldError state={state} name="careOf" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Anläggningsnamn</span>
            <input
              name="siteName"
              defaultValue={state.values.siteName ?? ""}
              placeholder="Ex. Hem, kontor, butik"
              className={inputClassName(state, "siteName")}
            />
            <FieldError state={state} name="siteName" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Anläggningstyp</span>
            <select
              name="siteType"
              defaultValue={state.values.siteType ?? "consumption"}
              className={inputClassName(state, "siteType")}
            >
              <option value="consumption">Förbrukning</option>
              <option value="production">Produktion</option>
              <option value="mixed">Förbrukning och produktion</option>
            </select>
            <FieldError state={state} name="siteType" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Nätägare</span>
            <select
              name="gridOwnerId"
              defaultValue={state.values.gridOwnerId ?? ""}
              className={inputClassName(state, "gridOwnerId")}
            >
              <option value="">Välj nätägare</option>
              <option value="__new__">+ Lägg till ny nätägare nedan</option>
              {gridOwners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
            <FieldError state={state} name="gridOwnerId" />
          </label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
            <p className="text-sm font-semibold text-slate-950">Lägg till ny nätägare direkt</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Fyll bara i detta om nätägaren saknas i listan. Systemet kontrollerar möjlig dubblett på namn, organisationsnummer och Ediel-ID och använder befintlig nätägare om den redan finns.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input name="newGridOwnerName" defaultValue={state.values.newGridOwnerName ?? ""} placeholder="Namn på ny nätägare" className={inputClassName(state, "newGridOwnerName")} />
              <input name="newGridOwnerOrgNumber" defaultValue={state.values.newGridOwnerOrgNumber ?? ""} placeholder="Organisationsnummer" className={inputClassName(state, "newGridOwnerOrgNumber")} />
              <input name="newGridOwnerEdielId" defaultValue={state.values.newGridOwnerEdielId ?? ""} placeholder="Ediel-ID" className={inputClassName(state, "newGridOwnerEdielId")} />
              <input name="newGridOwnerEmail" defaultValue={state.values.newGridOwnerEmail ?? ""} placeholder="Kontaktmail" className={inputClassName(state, "newGridOwnerEmail")} />
              <input name="newGridOwnerPhone" defaultValue={state.values.newGridOwnerPhone ?? ""} placeholder="Telefon" className={inputClassName(state, "newGridOwnerPhone")} />
            </div>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Anläggnings-ID</span>
            <input
              name="facilityId"
              defaultValue={state.values.facilityId ?? ""}
              placeholder="735999..."
              className={inputClassName(state, "facilityId")}
            />
            <FieldError state={state} name="facilityId" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Mätpunkts-ID</span>
            <input
              name="meterPointId"
              defaultValue={state.values.meterPointId ?? ""}
              placeholder="Mätpunkts-ID"
              className={inputClassName(state, "meterPointId")}
            />
            <FieldError state={state} name="meterPointId" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Elområde</span>
            <select
              name="priceAreaCode"
              defaultValue={state.values.priceAreaCode ?? ""}
              className={inputClassName(state, "priceAreaCode")}
            >
              <option value="">Välj elområde</option>
              {priceAreas.map((area) => (
                <option key={area.code} value={area.code}>
                  {area.code} — {area.name}
                </option>
              ))}
            </select>
            <FieldError state={state} name="priceAreaCode" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Nätområde</span>
            <input
              name="gridAreaCode"
              defaultValue={state.values.gridAreaCode ?? ""}
              placeholder="Nätområdeskod"
              className={inputClassName(state, "gridAreaCode")}
            />
            <FieldError state={state} name="gridAreaCode" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Beräknad årsförbrukning</span>
            <input
              name="annualConsumptionKwh"
              defaultValue={state.values.annualConsumptionKwh ?? ""}
              placeholder="kWh/år"
              className={inputClassName(state, "annualConsumptionKwh")}
            />
            <FieldError state={state} name="annualConsumptionKwh" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Önskat startdatum</span>
            <input
              type="date"
              name="moveInDate"
              defaultValue={state.values.moveInDate ?? ""}
              className={inputClassName(state, "moveInDate")}
            />
            <FieldError state={state} name="moveInDate" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Nuvarande leverantör</span>
            <select
              name="currentSupplierId"
              defaultValue={state.values.currentSupplierId ?? ""}
              className={inputClassName(state, "currentSupplierId")}
            >
              <option value="">Välj befintlig eller fyll i manuellt</option>
              <option value="__unknown__">Okänd nuvarande leverantör</option>
              <option value="__new__">+ Lägg till ny leverantör nedan</option>
              {electricitySuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}{supplier.org_number ? ` · ${supplier.org_number}` : ""}
                </option>
              ))}
            </select>
            <FieldError state={state} name="currentSupplierId" />
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <input type="checkbox" name="currentSupplierUnknown" className="mt-1" />
            <span>
              <span className="font-semibold">Nuvarande leverantör är okänd</span>
              <span className="mt-1 block text-xs leading-5">Det stoppar inte kundskapandet, men preflight varnar innan ett säkert byte körs.</span>
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Nuvarande leverantör namn</span>
            <input
              name="currentSupplierName"
              defaultValue={state.values.currentSupplierName ?? ""}
              placeholder="Fritext om leverantören saknas i listan"
              className={inputClassName(state, "currentSupplierName")}
            />
            <FieldError state={state} name="currentSupplierName" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Nuvarande leverantör org.nr</span>
            <input
              name="currentSupplierOrgNumber"
              defaultValue={state.values.currentSupplierOrgNumber ?? ""}
              placeholder="Organisationsnummer"
              className={inputClassName(state, "currentSupplierOrgNumber")}
            />
            <FieldError state={state} name="currentSupplierOrgNumber" />
          </label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
            <p className="text-sm font-semibold text-slate-950">Lägg till ny nuvarande leverantör direkt</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Detta används bara för informationshämtning inför byte. Mail till nuvarande leverantör får aldrig starta själva leverantörsbytet; Z03 går alltid till nätägaren via Ediel.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input name="newCurrentSupplierName" defaultValue={state.values.newCurrentSupplierName ?? ""} placeholder="Leverantörsnamn" className={inputClassName(state, "newCurrentSupplierName")} />
              <input name="newCurrentSupplierOrgNumber" defaultValue={state.values.newCurrentSupplierOrgNumber ?? ""} placeholder="Organisationsnummer" className={inputClassName(state, "newCurrentSupplierOrgNumber")} />
              <input name="newCurrentSupplierEdielId" defaultValue={state.values.newCurrentSupplierEdielId ?? ""} placeholder="Ediel-ID" className={inputClassName(state, "newCurrentSupplierEdielId")} />
              <input name="newCurrentSupplierSwitchingEmail" defaultValue={state.values.newCurrentSupplierSwitchingEmail ?? ""} placeholder="Fullmakts-/bytesfrågor mail" className={inputClassName(state, "newCurrentSupplierSwitchingEmail")} />
              <input name="newCurrentSupplierContractEmail" defaultValue={state.values.newCurrentSupplierContractEmail ?? ""} placeholder="Avtalsfrågor mail" className={inputClassName(state, "newCurrentSupplierContractEmail")} />
              <input name="newCurrentSupplierCustomerServiceEmail" defaultValue={state.values.newCurrentSupplierCustomerServiceEmail ?? ""} placeholder="Kundservice mail" className={inputClassName(state, "newCurrentSupplierCustomerServiceEmail")} />
              <input name="newCurrentSupplierPhone" defaultValue={state.values.newCurrentSupplierPhone ?? ""} placeholder="Telefon" className={inputClassName(state, "newCurrentSupplierPhone")} />
            </div>
          </div>

          <div
            className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2 md:grid-cols-2"
            data-flow-section="move_in move_out_takeover"
          >
            <p className="text-sm font-semibold text-slate-900 md:col-span-2">
              Flyttar från
            </p>
            <input
              name="movedFromStreet"
              defaultValue={state.values.movedFromStreet ?? ""}
              placeholder="Flyttar från adress"
              className={inputClassName(state, "movedFromStreet", "full")}
            />
            <input
              name="movedFromPostalCode"
              defaultValue={state.values.movedFromPostalCode ?? ""}
              placeholder="Flyttar från postnummer"
              className={inputClassName(state, "movedFromPostalCode")}
            />
            <input
              name="movedFromCity"
              defaultValue={state.values.movedFromCity ?? ""}
              placeholder="Flyttar från ort"
              className={inputClassName(state, "movedFromCity")}
            />
            <input
              name="movedFromSupplierName"
              defaultValue={state.values.movedFromSupplierName ?? ""}
              placeholder="Flyttar från leverantör"
              className={inputClassName(state, "movedFromSupplierName", "full")}
            />
          </div>
        </Section>

        <Section
          title="3. Avtal"
          description="Avtal får sparas även om kunden inte är redo för leverantörsbyte."
        >
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-700">Avtalsmall</span>
            <select
              name="contractOfferId"
              defaultValue={state.values.contractOfferId ?? ""}
              className={inputClassName(state, "contractOfferId", "full")}
            >
              <option value="">Välj avtal eller kampanj</option>
              {contractOffers.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.name}
                </option>
              ))}
            </select>
            <FieldError state={state} name="contractOfferId" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Avtalsstart</span>
            <input
              type="date"
              name="contractStartDate"
              defaultValue={state.values.contractStartDate ?? ""}
              className={inputClassName(state, "contractStartDate")}
            />
            <FieldError state={state} name="contractStartDate" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Avtalsstatus</span>
            <select
              name="contractStatus"
              defaultValue={state.values.contractStatus ?? "pending_signature"}
              className={inputClassName(state, "contractStatus")}
            >
              <option value="draft">Förbereds</option>
              <option value="pending_signature">Väntar signering</option>
              <option value="signed">Signerat</option>
              <option value="active">Aktivt</option>
            </select>
            <FieldError state={state} name="contractStatus" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Förväntat startdatum</span>
            <input
              type="date"
              name="expectedStartDate"
              defaultValue={state.values.expectedStartDate ?? ""}
              className={inputClassName(state, "expectedStartDate")}
            />
            <FieldError state={state} name="expectedStartDate" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Bekräftat startdatum</span>
            <input
              type="date"
              name="confirmedStartDate"
              defaultValue={state.values.confirmedStartDate ?? ""}
              className={inputClassName(state, "confirmedStartDate")}
            />
            <FieldError state={state} name="confirmedStartDate" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Faktiskt startdatum</span>
            <input
              type="date"
              name="actualStartDate"
              defaultValue={state.values.actualStartDate ?? ""}
              className={inputClassName(state, "actualStartDate")}
            />
            <FieldError state={state} name="actualStartDate" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Källa för startdatum</span>
            <select
              name="startDateSource"
              defaultValue={state.values.startDateSource ?? "customer_expected"}
              className={inputClassName(state, "startDateSource")}
            >
              <option value="customer_expected">
                Kundens önskemål/preliminärt
              </option>
              <option value="current_supplier_response">
                Svar från gammal leverantör
              </option>
              <option value="grid_owner_response">Svar från nätägare</option>
              <option value="ediel_prodat">Ediel/PRODAT-svar</option>
              <option value="manual_override">Manuell justering</option>
            </select>
            <FieldError state={state} name="startDateSource" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Kundspecifik avtalstyp</span>
            <select
              name="contractTypeOverride"
              defaultValue={state.values.contractTypeOverride ?? ""}
              className={inputClassName(state, "contractTypeOverride")}
            >
              <option value="">Behåll katalogens avtalstyp</option>
              <option value="fixed">Fast</option>
              <option value="variable_monthly">Rörlig månad</option>
              <option value="variable_hourly">Rörlig tim</option>
              <option value="portfolio">Portfölj</option>
            </select>
            <FieldError state={state} name="contractTypeOverride" />
          </label>

          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-700">
              Orsak till kundspecifik justering
            </span>
            <input
              name="overrideReason"
              defaultValue={state.values.overrideReason ?? ""}
              placeholder="Orsak till kundspecifik justering"
              className={inputClassName(state, "overrideReason", "full")}
            />
            <FieldError state={state} name="overrideReason" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Grön el-avgift</span>
            <select
              name="greenFeeMode"
              defaultValue={state.values.greenFeeMode ?? ""}
              className={inputClassName(state, "greenFeeMode")}
            >
              <option value="">Behåll katalogens grön el-avgift</option>
              <option value="none">Ingen</option>
              <option value="sek_month">kr/mån</option>
              <option value="ore_per_kwh">öre/kWh</option>
            </select>
            <FieldError state={state} name="greenFeeMode" />
          </label>

          <input
            name="fixedPriceOrePerKwh"
            defaultValue={state.values.fixedPriceOrePerKwh ?? ""}
            placeholder="Fast pris öre/kWh"
            className={inputClassName(state, "fixedPriceOrePerKwh")}
          />
          <input
            name="spotMarkupOrePerKwh"
            defaultValue={state.values.spotMarkupOrePerKwh ?? ""}
            placeholder="Spotpåslag öre/kWh"
            className={inputClassName(state, "spotMarkupOrePerKwh")}
          />
          <input
            name="variableFeeOrePerKwh"
            defaultValue={state.values.variableFeeOrePerKwh ?? ""}
            placeholder="Rörlig avgift öre/kWh"
            className={inputClassName(state, "variableFeeOrePerKwh")}
          />
          <input
            name="monthlyFeeSek"
            defaultValue={state.values.monthlyFeeSek ?? ""}
            placeholder="Månadsavgift kr"
            className={inputClassName(state, "monthlyFeeSek")}
          />
          <input
            name="greenFeeValue"
            defaultValue={state.values.greenFeeValue ?? ""}
            placeholder="Värde för grön el"
            className={inputClassName(state, "greenFeeValue")}
          />
          <input
            name="bindingMonths"
            defaultValue={state.values.bindingMonths ?? ""}
            placeholder="Bindningstid månader"
            className={inputClassName(state, "bindingMonths")}
          />
          <input
            name="noticeMonths"
            defaultValue={state.values.noticeMonths ?? ""}
            placeholder="Uppsägningstid månader"
            className={inputClassName(state, "noticeMonths")}
          />

          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-700">Extra avgifter</span>
            <textarea
              name="optionalFeeLines"
              defaultValue={state.values.optionalFeeLines ?? ""}
              rows={4}
              placeholder={
                "Etablering | 395 | sek\nNattillägg | 1.2 | ore_per_kwh"
              }
              className={inputClassName(state, "optionalFeeLines", "full")}
            />
            <FieldError state={state} name="optionalFeeLines" />
          </label>
        </Section>

        <Section
          title="4. Faktura"
          description="Fakturaadress kan kopieras från anläggning eller anges separat."
        >
          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm md:col-span-2">
            <input
              type="checkbox"
              name="billingAddressSameAsSite"
              defaultChecked={
                state.values.billingAddressSameAsSite === "on" ||
                state.values.billingAddressSameAsSite === "true"
              }
              className="mt-1"
              data-copy-billing-address
            />
            <span>
              <span className="block font-semibold text-slate-900">
                Fakturaadress samma som eladress
              </span>
              <span className="mt-1 block text-slate-700">
                Kopierar adress, postnummer, ort och land från anläggningen.
              </span>
            </span>
          </label>

          <input
            name="invoiceRecipient"
            defaultValue={state.values.invoiceRecipient ?? ""}
            placeholder="Fakturamottagare"
            className={inputClassName(state, "invoiceRecipient")}
          />
          <input
            type="email"
            name="invoiceEmail"
            defaultValue={state.values.invoiceEmail ?? ""}
            placeholder="faktura@kund.se"
            className={inputClassName(state, "invoiceEmail")}
          />
          <input
            name="invoiceReference"
            defaultValue={state.values.invoiceReference ?? ""}
            placeholder="Fakturareferens"
            className={inputClassName(state, "invoiceReference", "full")}
          />
          <input
            name="billingStreet"
            defaultValue={state.values.billingStreet ?? ""}
            placeholder="Fakturaadress"
            className={inputClassName(state, "billingStreet", "full")}
          />
          <input
            name="billingPostalCode"
            defaultValue={state.values.billingPostalCode ?? ""}
            placeholder="Postnummer faktura"
            className={inputClassName(state, "billingPostalCode")}
          />
          <input
            name="billingCity"
            defaultValue={state.values.billingCity ?? ""}
            placeholder="Ort faktura"
            className={inputClassName(state, "billingCity")}
          />

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Land faktura</span>
            <select
              name="billingCountry"
              defaultValue={
                state.values.billingCountry ?? state.values.country ?? "SE"
              }
              className={inputClassName(state, "billingCountry")}
            >
              <option value="SE">Sverige</option>
            </select>
            <FieldError state={state} name="billingCountry" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Faktureringsnivå</span>
            <select
              name="billingLevel"
              defaultValue={state.values.billingLevel ?? "customer"}
              className={inputClassName(state, "billingLevel")}
            >
              <option value="customer">Samlingsfaktura per kund</option>
              <option value="contract">Faktura per avtal</option>
              <option value="site">Faktura per anläggning</option>
              <option value="metering_point">Faktura per mätpunkt</option>
            </select>
            <FieldError state={state} name="billingLevel" />
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm md:col-span-2">
            <input
              type="checkbox"
              name="consolidatedInvoice"
              defaultChecked={
                state.values.consolidatedInvoice === "on" ||
                state.values.consolidatedInvoice === "true"
              }
              className="mt-1"
            />
            <span>
              <span className="block font-semibold text-slate-900">
                Samlingsfaktura
              </span>
              <span className="mt-1 block text-slate-700">
                Samla flera anläggningar och mätpunkter på samma fakturaadress.
              </span>
            </span>
          </label>
        </Section>

        <Section
          title="5. Dokument och fullmakt"
          description="Ladda upp signerat avtal och signerad fullmakt direkt vid kundskapande."
        >
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-700">Signerat avtal</span>
            <input
              type="file"
              name="signedAgreementFile"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="rounded-2xl border border-slate-300 px-4 py-3"
            />
            <span className="text-xs text-slate-600">
              Kopplas till kund, anläggning, mätpunkt och avtal om dessa finns.
            </span>
          </label>

          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-700">Signerad fullmakt</span>
            <input
              type="file"
              name="signedPowerOfAttorneyFile"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="rounded-2xl border border-slate-300 px-4 py-3"
            />
            <span className="text-xs text-slate-600">
              Skapar signerad fullmakt och tar bort blockerare för saknad
              fullmakt i nästa steg.
            </span>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Fullmaktsstatus</span>
            <select
              name="authorizationStatus"
              defaultValue={state.values.authorizationStatus ?? "missing"}
              className={inputClassName(state, "authorizationStatus")}
            >
              <option value="missing">Fullmakt saknas</option>
              <option value="draft">Fullmakt skapad</option>
              <option value="sent">Fullmakt skickad</option>
              <option value="signed">Fullmakt signerad</option>
              <option value="expired">Fullmakt utgången</option>
              <option value="revoked">Fullmakt avvisad/återkallad</option>
            </select>
            <FieldError state={state} name="authorizationStatus" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Kundbekräftelse</span>
            <select
              name="customerConfirmationStatus"
              defaultValue={
                state.values.customerConfirmationStatus ?? "pending"
              }
              className={inputClassName(state, "customerConfirmationStatus")}
            >
              <option value="pending">Väntar</option>
              <option value="confirmed">Bekräftad</option>
              <option value="rejected">Nekad</option>
            </select>
            <FieldError state={state} name="customerConfirmationStatus" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Fullmakt giltig från</span>
            <input
              type="date"
              name="authorizationValidFrom"
              defaultValue={state.values.authorizationValidFrom ?? ""}
              className={inputClassName(state, "authorizationValidFrom")}
            />
            <FieldError state={state} name="authorizationValidFrom" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Fullmakt giltig till</span>
            <input
              type="date"
              name="authorizationValidTo"
              defaultValue={state.values.authorizationValidTo ?? ""}
              className={inputClassName(state, "authorizationValidTo")}
            />
            <FieldError state={state} name="authorizationValidTo" />
          </label>
        </Section>

        <Section
          title="6. Dubblett och granskning"
          description="Möjlig dubblett sparas som blockerare och stoppar inte kundskapandet."
        >
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-700">
              Åtgärd vid möjlig/befintlig kund
            </span>
            <select
              name="duplicateResolution"
              defaultValue={
                state.values.duplicateResolution ?? "create_new_pending_review"
              }
              className={inputClassName(state, "duplicateResolution", "full")}
            >
              <option value="create_new_pending_review">
                Skapa kund och flagga möjlig dubblett
              </option>
              <option value="add_site_to_existing">
                Lägg till anläggning på befintlig kund
              </option>
              <option value="add_contract_to_existing">
                Lägg till avtal på befintlig kund
              </option>
              <option value="update_existing">
                Uppdatera befintlig kund och lägg till data
              </option>
              <option value="create_separate_confirmed">
                Skapa separat kund trots varning
              </option>
            </select>
            <FieldError state={state} name="duplicateResolution" />
          </label>

          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-700">Befintligt kund-ID</span>
            <input
              name="existingCustomerId"
              defaultValue={state.values.existingCustomerId ?? ""}
              placeholder="Används bara om du väljer att koppla till befintlig kund"
              className={inputClassName(state, "existingCustomerId", "full")}
            />
            <FieldError state={state} name="existingCustomerId" />
          </label>

          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-slate-700">
              Kommentar till dubblettbeslut
            </span>
            <textarea
              name="duplicateOverrideReason"
              defaultValue={state.values.duplicateOverrideReason ?? ""}
              rows={3}
              placeholder="Ex. Kunden ska skapas separat trots match på telefonnummer."
              className={inputClassName(
                state,
                "duplicateOverrideReason",
                "full",
              )}
            />
            <FieldError state={state} name="duplicateOverrideReason" />
          </label>
        </Section>

        <Section
          title="7. Nästa steg"
          description="Välj vad handläggaren ska göra direkt efter att kunden sparats. Det här ändrar bara arbetsflödet efter skapande, inte själva kundsparningen."
        >
          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Efter kundskapande</span>
            <select
              name="postCreateAction"
              defaultValue={state.values.postCreateAction ?? "open_customer"}
              className={inputClassName(state, "postCreateAction")}
            >
              <option value="open_customer">Öppna kundkort</option>
              <option value="request_data">Skapa kund och begär uppgifter direkt</option>
              <option value="create_new">Skapa kund och registrera ny kund</option>
            </select>
            <FieldError state={state} name="postCreateAction" />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-700">Standardval för uppgiftsbegäran</span>
            <select
              name="postCreateRequestTarget"
              defaultValue={state.values.postCreateRequestTarget ?? "both"}
              className={inputClassName(state, "postCreateRequestTarget")}
            >
              <option value="grid_owner">Nätägare</option>
              <option value="current_supplier">Nuvarande leverantör</option>
              <option value="both">Båda</option>
            </select>
            <FieldError state={state} name="postCreateRequestTarget" />
          </label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:col-span-2">
            <p className="font-semibold text-slate-950">Så fungerar det</p>
            <p className="mt-1">
              Kunden sparas alltid först. Om du begär uppgifter direkt kontrollerar systemet signerad fullmakt. Saknas fullmakt skapas en blockerare i stället för att något skickas.
            </p>
          </div>
        </Section>

        <CustomerIntakeEnhancer offers={contractOffers} values={state.values} />

        <div className="grid gap-3 lg:grid-cols-3">
          <button
            type="submit"
            name="intakeCreateMode"
            value="create"
            disabled={isPending}
            className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Skapar..." : "Skapa kund"}
          </button>
          <button
            type="submit"
            name="postCreateActionOverride"
            value="request_data"
            disabled={isPending}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Skapa kund och begär uppgifter
          </button>
          <button
            type="submit"
            name="intakeCreateMode"
            value="create_blocked"
            disabled={isPending}
            className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Skapa och markera som blockerad
          </button>
        </div>
      </form>
    </div>
  );
}
