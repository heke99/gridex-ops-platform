"use client";

import { useActionState } from "react";
import Link from "next/link";
import CustomerIntakeEnhancer from "@/components/admin/customers/CustomerIntakeEnhancer";
import { createCustomerAction } from "@/app/admin/customers/actions";
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

type Props = {
  gridOwners: GridOwnerOption[];
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

  return <span className="text-xs font-medium text-red-600 ">{error}</span>;
}

export default function CustomerIntakeForm({
  gridOwners,
  priceAreas,
  contractOffers,
}: Props) {
  const [state, formAction, isPending] = useActionState(
    createCustomerAction,
    initialIntakeActionState,
  );

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
      <h2 className="text-lg font-semibold text-slate-950 ">Registrera kund</h2>
      <p className="mt-1 text-sm text-slate-700 ">
        Skapar kund, kontaktperson, anläggning, eventuell mätpunkt och kundavtal
        i ett sammanhållet flöde.
      </p>

      <form
        action={formAction}
        className="mt-6 space-y-6"
        data-customer-intake-form
      >
        {state.status === "error" && state.message ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 ">
            <p className="font-semibold">
              Intaget stoppades innan ofullständig data sparades.
            </p>
            <p className="mt-1">{state.message}</p>
          </div>
        ) : null}

        {state.status === "success" && state.message ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ">
            <p className="font-semibold">Klart.</p>
            <p className="mt-1">{state.message}</p>
            {state.createdCustomerId ? (
              <Link
                href={`/admin/customers/${state.createdCustomerId}`}
                className="mt-3 inline-flex rounded-xl border border-emerald-300 px-3 py-2 font-semibold hover:bg-emerald-100 "
              >
                Öppna kundkort
              </Link>
            ) : null}
          </div>
        ) : null}

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 ">
            Kunddata
          </h3>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Kundtyp</span>
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
              <span className="text-slate-700 ">Flöde</span>
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
              data-customer-section="private"
            >
              <span className="text-slate-700 ">Lägenhetsnummer</span>
              <input
                name="apartmentNumber"
                defaultValue={state.values.apartmentNumber ?? ""}
                placeholder="Lägenhetsnummer"
                className={inputClassName(state, "apartmentNumber")}
              />
              <FieldError state={state} name="apartmentNumber" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-customer-section="private business association"
            >
              <span
                className="text-slate-700 "
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
                data-required-customer="private business association"
              />
              <FieldError state={state} name="firstName" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-customer-section="private business association"
            >
              <span
                className="text-slate-700 "
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
                data-required-customer="private business association"
              />
              <FieldError state={state} name="lastName" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-customer-section="business association"
            >
              <span className="text-slate-700 ">Kontaktperson titel</span>
              <input
                name="contactTitle"
                defaultValue={state.values.contactTitle ?? ""}
                placeholder="Ex. VD, administratör, ordförande"
                className={inputClassName(state, "contactTitle")}
              />
              <FieldError state={state} name="contactTitle" />
            </label>

            <label
              className="grid gap-1 text-sm md:col-span-2"
              data-customer-section="business association"
            >
              <span
                className="text-slate-700 "
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
                data-required-customer="business association"
              />
              <FieldError state={state} name="companyName" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-customer-section="private"
            >
              <span className="text-slate-700 ">Personnummer</span>
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
              <span className="text-slate-700 ">Organisationsnummer</span>
              <input
                name="orgNumber"
                defaultValue={state.values.orgNumber ?? ""}
                placeholder="Organisationsnummer"
                className={inputClassName(state, "orgNumber")}
                data-required-customer="business association"
              />
              <FieldError state={state} name="orgNumber" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">E-post</span>
              <input
                name="email"
                defaultValue={state.values.email ?? ""}
                type="email"
                placeholder="E-post"
                className={inputClassName(state, "email")}
              />
              <FieldError state={state} name="email" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Mobilnummer</span>
              <input
                name="phone"
                defaultValue={state.values.phone ?? ""}
                placeholder="Mobilnummer"
                className={inputClassName(state, "phone")}
              />
              <FieldError state={state} name="phone" />
            </label>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 ">
            Anläggning och flytt
          </h3>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Anläggningsnamn / etikett</span>
              <input
                name="siteName"
                defaultValue={state.values.siteName ?? ""}
                placeholder="Anläggningsnamn / etikett"
                className={inputClassName(state, "siteName")}
              />
              <FieldError state={state} name="siteName" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Anläggnings-id</span>
              <input
                name="facilityId"
                defaultValue={state.values.facilityId ?? ""}
                placeholder="Anläggnings-id"
                className={inputClassName(state, "facilityId")}
              />
              <FieldError state={state} name="facilityId" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Mätpunkts-id</span>
              <input
                name="meterPointId"
                defaultValue={state.values.meterPointId ?? ""}
                placeholder="Mätpunkts-id"
                className={inputClassName(state, "meterPointId")}
              />
              <FieldError state={state} name="meterPointId" />
            </label>

            <label className="grid gap-1 text-sm">
              <span
                className="text-slate-700 "
                data-label-for-flow
                data-label-switch="Önskat startdatum"
                data-label-move_in="Inflyttningsdatum"
                data-label-move_out_takeover="Övertagsdatum"
              >
                Önskat startdatum
              </span>
              <input
                type="date"
                name="moveInDate"
                defaultValue={state.values.moveInDate ?? ""}
                className={inputClassName(state, "moveInDate")}
                data-required-flow="move_in move_out_takeover"
              />
              <FieldError state={state} name="moveInDate" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Nätägare</span>
              <select
                name="gridOwnerId"
                defaultValue={state.values.gridOwnerId ?? ""}
                className={inputClassName(state, "gridOwnerId")}
              >
                <option value="">Välj nätägare</option>
                {gridOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
              <FieldError state={state} name="gridOwnerId" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Elområde</span>
              <select
                name="priceAreaCode"
                defaultValue={state.values.priceAreaCode ?? ""}
                className={inputClassName(state, "priceAreaCode")}
              >
                <option value="">Välj elområde</option>
                {priceAreas.map((area) => (
                  <option key={area.code} value={area.code}>
                    {area.code} • {area.name}
                  </option>
                ))}
              </select>
              <FieldError state={state} name="priceAreaCode" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Nätområde / områdes-id</span>
              <input
                name="gridAreaCode"
                defaultValue={state.values.gridAreaCode ?? ""}
                placeholder="Ex. nätområde/RFF+Z05"
                className={inputClassName(state, "gridAreaCode")}
              />
              <FieldError state={state} name="gridAreaCode" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Årsförbrukning kWh</span>
              <input
                name="annualConsumptionKwh"
                defaultValue={state.values.annualConsumptionKwh ?? ""}
                placeholder="Årsförbrukning kWh"
                className={inputClassName(state, "annualConsumptionKwh")}
              />
              <FieldError state={state} name="annualConsumptionKwh" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Anläggningstyp</span>
              <select
                name="siteType"
                defaultValue={state.values.siteType ?? "consumption"}
                className={inputClassName(state, "siteType")}
              >
                <option value="consumption">Förbrukning</option>
                <option value="production">Produktion</option>
                <option value="mixed">Mixad</option>
              </select>
              <FieldError state={state} name="siteType" />
            </label>

            <label
              className="grid gap-1 text-sm md:col-span-2"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span
                className="text-slate-700 "
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
                data-required-flow="move_in move_out_takeover"
              />
              <FieldError state={state} name="street" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span className="text-slate-700 ">Postnummer</span>
              <input
                name="postalCode"
                defaultValue={state.values.postalCode ?? ""}
                placeholder="Postnummer"
                className={inputClassName(state, "postalCode")}
                data-required-flow="move_in move_out_takeover"
              />
              <FieldError state={state} name="postalCode" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span className="text-slate-700 ">Stad</span>
              <input
                name="city"
                defaultValue={state.values.city ?? ""}
                placeholder="Stad"
                className={inputClassName(state, "city")}
                data-required-flow="move_in move_out_takeover"
              />
              <FieldError state={state} name="city" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span className="text-slate-700 ">Land</span>
              <input
                name="country"
                defaultValue={state.values.country ?? "SE"}
                placeholder="SE"
                className={inputClassName(state, "country")}
              />
              <FieldError state={state} name="country" />
            </label>

            <label
              className="grid gap-1 text-sm md:col-span-2"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span className="text-slate-700 ">c/o</span>
              <input
                name="careOf"
                defaultValue={state.values.careOf ?? ""}
                placeholder="c/o"
                className={inputClassName(state, "careOf", "full")}
              />
              <FieldError state={state} name="careOf" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span
                className="text-slate-700 "
                data-label-for-flow
                data-label-switch="Nuvarande elleverantör"
                data-label-move_in="Nuvarande elleverantör på nya anläggningen"
                data-label-move_out_takeover="Nuvarande elleverantör på anläggningen"
              >
                Nuvarande elleverantör
              </span>
              <input
                name="currentSupplierName"
                defaultValue={state.values.currentSupplierName ?? ""}
                placeholder="Nuvarande elleverantör"
                className={inputClassName(state, "currentSupplierName")}
              />
              <FieldError state={state} name="currentSupplierName" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span className="text-slate-700 ">
                Nuvarande leverantör org.nr
              </span>
              <input
                name="currentSupplierOrgNumber"
                defaultValue={state.values.currentSupplierOrgNumber ?? ""}
                placeholder="Nuvarande leverantör org.nr"
                className={inputClassName(state, "currentSupplierOrgNumber")}
              />
              <FieldError state={state} name="currentSupplierOrgNumber" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span className="text-slate-700 ">Kundbekräftelse</span>
              <select
                name="customerConfirmationStatus"
                defaultValue={
                  state.values.customerConfirmationStatus ?? "missing"
                }
                className={inputClassName(state, "customerConfirmationStatus")}
              >
                <option value="missing">Saknas / behöver kompletteras</option>
                <option value="confirmed">Mottagen och verifierad</option>
                <option value="pending">Inväntar kund</option>
              </select>
              <FieldError state={state} name="customerConfirmationStatus" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span className="text-slate-700 ">Fullmaktsstatus</span>
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

            <label
              className="grid gap-1 text-sm"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span className="text-slate-700 ">Fullmakt giltig från</span>
              <input
                type="date"
                name="authorizationValidFrom"
                defaultValue={state.values.authorizationValidFrom ?? ""}
                className={inputClassName(state, "authorizationValidFrom")}
              />
              <FieldError state={state} name="authorizationValidFrom" />
            </label>

            <label
              className="grid gap-1 text-sm"
              data-flow-section="switch move_in move_out_takeover"
            >
              <span className="text-slate-700 ">Fullmakt giltig till</span>
              <input
                type="date"
                name="authorizationValidTo"
                defaultValue={state.values.authorizationValidTo ?? ""}
                className={inputClassName(state, "authorizationValidTo")}
              />
              <FieldError state={state} name="authorizationValidTo" />
            </label>

            <div
              className="md:col-span-2 grid gap-4 md:grid-cols-2"
              data-flow-section="move_in move_out_takeover"
            >
              <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ">
                Fyll i var kunden flyttar från när det är relevant. Fälten
                skickas bara med för inflytt och övertag.
              </div>

              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-slate-700 ">Flyttar från adress</span>
                <input
                  name="movedFromStreet"
                  defaultValue={state.values.movedFromStreet ?? ""}
                  placeholder="Flyttar från adress"
                  className={inputClassName(state, "movedFromStreet", "full")}
                />
                <FieldError state={state} name="movedFromStreet" />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-slate-700 ">Flyttar från postnummer</span>
                <input
                  name="movedFromPostalCode"
                  defaultValue={state.values.movedFromPostalCode ?? ""}
                  placeholder="Flyttar från postnummer"
                  className={inputClassName(state, "movedFromPostalCode")}
                />
                <FieldError state={state} name="movedFromPostalCode" />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-slate-700 ">Flyttar från stad</span>
                <input
                  name="movedFromCity"
                  defaultValue={state.values.movedFromCity ?? ""}
                  placeholder="Flyttar från stad"
                  className={inputClassName(state, "movedFromCity")}
                />
                <FieldError state={state} name="movedFromCity" />
              </label>

              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-slate-700 ">Flyttar från leverantör</span>
                <input
                  name="movedFromSupplierName"
                  defaultValue={state.values.movedFromSupplierName ?? ""}
                  placeholder="Flyttar från leverantör"
                  className={inputClassName(
                    state,
                    "movedFromSupplierName",
                    "full",
                  )}
                />
                <FieldError state={state} name="movedFromSupplierName" />
              </label>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-700 ">
            Avtal
          </h3>

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm md:col-span-2">
              <span className="text-slate-700 ">Avtalsmall</span>
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
              <span className="text-slate-700 ">Avtalsstart</span>
              <input
                type="date"
                name="contractStartDate"
                defaultValue={state.values.contractStartDate ?? ""}
                className={inputClassName(state, "contractStartDate")}
              />
              <FieldError state={state} name="contractStartDate" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Avtalsstatus</span>
              <select
                name="contractStatus"
                defaultValue={
                  state.values.contractStatus ?? "pending_signature"
                }
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
              <span className="text-slate-700 ">Förväntat startdatum</span>
              <input
                type="date"
                name="expectedStartDate"
                defaultValue={state.values.expectedStartDate ?? ""}
                className={inputClassName(state, "expectedStartDate")}
              />
              <FieldError state={state} name="expectedStartDate" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Bekräftat startdatum</span>
              <input
                type="date"
                name="confirmedStartDate"
                defaultValue={state.values.confirmedStartDate ?? ""}
                className={inputClassName(state, "confirmedStartDate")}
              />
              <FieldError state={state} name="confirmedStartDate" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Faktiskt startdatum</span>
              <input
                type="date"
                name="actualStartDate"
                defaultValue={state.values.actualStartDate ?? ""}
                className={inputClassName(state, "actualStartDate")}
              />
              <FieldError state={state} name="actualStartDate" />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">Källa för startdatum</span>
              <select
                name="startDateSource"
                defaultValue={
                  state.values.startDateSource ?? "customer_expected"
                }
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

            <label className="grid gap-1 text-sm md:col-span-2">
              <span className="text-slate-700 ">
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
              <span className="text-slate-700 ">Kundspecifik avtalstyp</span>
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

            <label className="grid gap-1 text-sm">
              <span className="text-slate-700 ">
                Kundspecifik grön el-avgift
              </span>
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

            <div className="grid gap-1 text-sm">
              <input
                name="fixedPriceOrePerKwh"
                defaultValue={state.values.fixedPriceOrePerKwh ?? ""}
                placeholder="Kundspecifikt fast pris öre/kWh"
                className={inputClassName(state, "fixedPriceOrePerKwh")}
              />
              <FieldError state={state} name="fixedPriceOrePerKwh" />
            </div>

            <div className="grid gap-1 text-sm">
              <input
                name="spotMarkupOrePerKwh"
                defaultValue={state.values.spotMarkupOrePerKwh ?? ""}
                placeholder="Kundspecifikt påslag öre/kWh"
                className={inputClassName(state, "spotMarkupOrePerKwh")}
              />
              <FieldError state={state} name="spotMarkupOrePerKwh" />
            </div>

            <div className="grid gap-1 text-sm">
              <input
                name="variableFeeOrePerKwh"
                defaultValue={state.values.variableFeeOrePerKwh ?? ""}
                placeholder="Kundspecifik rörlig avgift öre/kWh"
                className={inputClassName(state, "variableFeeOrePerKwh")}
              />
              <FieldError state={state} name="variableFeeOrePerKwh" />
            </div>

            <div className="grid gap-1 text-sm">
              <input
                name="monthlyFeeSek"
                defaultValue={state.values.monthlyFeeSek ?? ""}
                placeholder="Kundspecifik månadsavgift kr"
                className={inputClassName(state, "monthlyFeeSek")}
              />
              <FieldError state={state} name="monthlyFeeSek" />
            </div>

            <div className="grid gap-1 text-sm">
              <input
                name="greenFeeValue"
                defaultValue={state.values.greenFeeValue ?? ""}
                placeholder="Kundspecifikt värde för grön el"
                className={inputClassName(state, "greenFeeValue")}
              />
              <FieldError state={state} name="greenFeeValue" />
            </div>

            <div className="grid gap-1 text-sm">
              <input
                name="bindingMonths"
                defaultValue={state.values.bindingMonths ?? ""}
                placeholder="Bindningstid månader"
                className={inputClassName(state, "bindingMonths")}
              />
              <FieldError state={state} name="bindingMonths" />
            </div>

            <div className="grid gap-1 text-sm">
              <input
                name="noticeMonths"
                defaultValue={state.values.noticeMonths ?? ""}
                placeholder="Uppsägningstid månader"
                className={inputClassName(state, "noticeMonths")}
              />
              <FieldError state={state} name="noticeMonths" />
            </div>

            <label className="grid gap-1 text-sm md:col-span-2">
              <textarea
                name="optionalFeeLines"
                defaultValue={state.values.optionalFeeLines ?? ""}
                rows={4}
                placeholder={
                  "Extra avgifter\nEtablering | 395 | sek\nNattillägg | 1.2 | ore_per_kwh"
                }
                className={inputClassName(state, "optionalFeeLines", "full")}
              />
              <FieldError state={state} name="optionalFeeLines" />
            </label>
          </div>
        </div>

        <CustomerIntakeEnhancer offers={contractOffers} values={state.values} />

        <button
          disabled={isPending}
          className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 "
        >
          {isPending ? "Skapar kund..." : "Skapa kund med avtal"}
        </button>
      </form>
    </div>
  );
}
