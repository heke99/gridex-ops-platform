"use client";

import { useMemo, useState } from "react";

import {
  COMPONENT_LIFECYCLES,
  COMPONENT_SELECTION_POLICIES,
  COMPONENT_UNITS,
  INVOICE_DELIVERY_METHODS,
  commercialModelFromSnapshot,
  type CanonicalContractType,
  type CommercialPriceComponent,
  type ContractPriceOption,
  type InvoiceDeliveryMethod,
} from "@/lib/pricing/commercialModel";

const AREAS = ["SE1", "SE2", "SE3", "SE4"] as const;

function stableReference(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function newOption(
  contractType: CanonicalContractType,
  index: number,
): ContractPriceOption {
  const reference = stableReference("price_option");
  return {
    price_option_reference: reference,
    option_code: `option_${index + 1}`,
    customer_name: `Prisalternativ ${index + 1}`,
    customer_type: "both",
    default: index === 0,
    selection_required: index > 0,
    internal_description: null,
    contract_type: contractType,
    binding_months: 0,
    notice_months: 1,
    auto_renew_enabled: false,
    renewal_term_months: null,
    valid_from: null,
    valid_to: null,
    earliest_start_date: null,
    latest_start_date: null,
    status: "active",
    sort_order: index * 10,
    version_number: 1,
    area_prices:
      contractType === "fixed"
        ? AREAS.map((area) => ({
            price_row_reference: stableReference(`area_${area.toLowerCase()}`),
            price_area: area,
            amount: 1,
            unit: "ore_per_kwh" as const,
            vat_treatment: "standard" as const,
            valid_from: null,
            valid_to: null,
            metadata: {},
          }))
        : [],
    metadata: {},
  };
}

function newComponent(index: number): CommercialPriceComponent {
  const reference = stableReference("component");
  return {
    component_reference: reference,
    component_code: `component_${index + 1}`,
    internal_name: `Komponent ${index + 1}`,
    customer_name: `Komponent ${index + 1}`,
    internal_description: null,
    customer_description: null,
    component_type: "commercial_fee",
    amount: 0,
    unit: "sek_month",
    calculation_type: "per_month",
    calculation_base: null,
    vat_treatment: "standard",
    selection_policy: "mandatory",
    default_selected: true,
    customer_can_deselect: false,
    admin_must_select: false,
    informational_only: false,
    lifecycle: "recurring",
    periodization_rule: "active_days",
    invoice_line_name: `Komponent ${index + 1}`,
    accounting_classification: "electricity_revenue",
    sort_order: 500 + index,
    valid_from: null,
    valid_to: null,
    conditions: {
      contract_types: [],
      price_option_references: [],
      price_areas: [],
      customer_types: [],
      invoice_delivery_methods: [],
      sales_channels: [],
      minimum_site_count: null,
      maximum_site_count: null,
      minimum_annual_consumption_kwh: null,
      maximum_annual_consumption_kwh: null,
      valid_from: null,
      valid_to: null,
    },
    website_published: true,
    metadata: {},
  };
}

function calculationTypeForUnit(
  unit: CommercialPriceComponent["unit"],
): CommercialPriceComponent["calculation_type"] {
  if (unit === "ore_per_kwh" || unit === "sek_per_kwh") return "per_kwh";
  if (unit === "sek_month") return "per_month";
  if (unit === "sek_site_month") return "per_site_month";
  if (unit === "sek_invoice") return "per_invoice";
  if (unit === "sek_year") return "per_year";
  if (unit === "percent") return "percentage";
  if (unit === "sek_event") return "event_only";
  return "fixed_once";
}

function lifecycleForUnit(
  unit: CommercialPriceComponent["unit"],
): CommercialPriceComponent["lifecycle"] {
  if (unit === "sek_invoice") return "per_invoice";
  if (unit === "sek_site_month") return "per_site";
  if (unit === "sek_year") return "annual";
  if (unit === "sek_once" || unit === "sek_contract")
    return "once_per_contract";
  if (unit === "sek_event") return "event_only";
  if (unit === "ore_per_kwh" || unit === "sek_per_kwh")
    return "consumption_based";
  return "recurring";
}

export default function CommercialPricingEditor({
  contractType,
  snapshot,
}: {
  contractType: CanonicalContractType;
  snapshot: Record<string, unknown> | null;
}) {
  const existing = useMemo(
    () => commercialModelFromSnapshot(snapshot),
    [snapshot],
  );
  const [options, setOptions] = useState<ContractPriceOption[]>(() => {
    const matching =
      existing?.price_options.filter(
        (option) => option.contract_type === contractType,
      ) ?? [];
    return matching.length ? matching : [newOption(contractType, 0)];
  });
  const [components, setComponents] = useState<CommercialPriceComponent[]>(
    () => existing?.components ?? [],
  );
  const [deliveryMethods, setDeliveryMethods] = useState<
    InvoiceDeliveryMethod[]
  >(() => existing?.invoice_delivery_methods ?? ["email", "e_invoice", "paper"]);

  function patchOption(index: number, patch: Partial<ContractPriceOption>) {
    setOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index ? { ...option, ...patch } : option,
      ),
    );
  }

  function patchComponent(
    index: number,
    patch: Partial<CommercialPriceComponent>,
  ) {
    setComponents((current) =>
      current.map((component, componentIndex) =>
        componentIndex === index ? { ...component, ...patch } : component,
      ),
    );
  }

  function moveComponent(index: number, direction: -1 | 1) {
    setComponents((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((component, sortIndex) => ({
        ...component,
        sort_order: 500 + sortIndex,
      }));
    });
  }

  return (
    <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-5">
      <input
        type="hidden"
        name="price_options_json"
        value={JSON.stringify(options)}
      />
      <input
        type="hidden"
        name="commercial_components_json"
        value={JSON.stringify(components)}
      />
      <input
        type="hidden"
        name="invoice_delivery_methods_json"
        value={JSON.stringify(deliveryMethods)}
      />

      <h3 className="font-black text-indigo-950">
        Kanoniska prisalternativ
      </h3>
      <p className="mt-1 text-xs leading-5 text-indigo-900">
        Referenserna är stabila och följer med genom offert, signering,
        snapshot och fakturarad. De ändras inte när du sorterar eller redigerar.
      </p>

      <div className="mt-4 space-y-4">
        {options.map((option, optionIndex) => (
          <fieldset
            key={option.price_option_reference}
            className="rounded-2xl border border-indigo-200 bg-white p-4"
          >
            <div className="grid gap-3 md:grid-cols-4">
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Kundnamn
                <input
                  value={option.customer_name}
                  onChange={(event) =>
                    patchOption(optionIndex, {
                      customer_name: event.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Stabil kod
                <input
                  value={option.option_code}
                  onChange={(event) =>
                    patchOption(optionIndex, {
                      option_code: event.target.value.toLowerCase(),
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Bindning, månader
                <input
                  type="number"
                  min="0"
                  value={option.binding_months}
                  onChange={(event) =>
                    patchOption(optionIndex, {
                      binding_months: Number(event.target.value),
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Uppsägning, månader
                <input
                  type="number"
                  min="0"
                  value={option.notice_months}
                  onChange={(event) =>
                    patchOption(optionIndex, {
                      notice_months: Number(event.target.value),
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="default_price_option"
                  checked={option.default}
                  onChange={() =>
                    setOptions((current) =>
                      current.map((candidate, candidateIndex) => ({
                        ...candidate,
                        default: candidateIndex === optionIndex,
                      })),
                    )
                  }
                />
                Standardalternativ
              </label>
              <label className="flex items-center gap-2">
                Kundtyp
                <select
                  value={option.customer_type}
                  onChange={(event) =>
                    patchOption(optionIndex, {
                      customer_type: event.target
                        .value as ContractPriceOption["customer_type"],
                    })
                  }
                  className="rounded-lg border border-slate-300 px-2 py-1"
                >
                  <option value="both">Privat och företag</option>
                  <option value="private">Privat</option>
                  <option value="business">Företag</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={option.selection_required}
                  onChange={(event) =>
                    setOptions((current) =>
                      current.map((candidate) => ({
                        ...candidate,
                        selection_required: event.target.checked,
                      })),
                    )
                  }
                />
                Kunden måste välja
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={option.auto_renew_enabled}
                  onChange={(event) =>
                    patchOption(optionIndex, {
                      auto_renew_enabled: event.target.checked,
                      renewal_term_months: event.target.checked
                        ? option.renewal_term_months ?? 12
                        : null,
                    })
                  }
                />
                Automatisk förlängning
              </label>
              {option.auto_renew_enabled && (
                <label className="flex items-center gap-2">
                  Förlängning
                  <input
                    type="number"
                    min="1"
                    value={option.renewal_term_months ?? 12}
                    onChange={(event) =>
                      patchOption(optionIndex, {
                        renewal_term_months: Number(event.target.value),
                      })
                    }
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1"
                  />
                  månader
                </label>
              )}
              <code className="text-[11px] text-slate-500">
                {option.price_option_reference}
              </code>
            </div>

            {contractType === "fixed" && (
              <div className="mt-4 grid gap-2 md:grid-cols-4">
                {option.area_prices.map((row, rowIndex) => (
                  <label
                    key={row.price_row_reference}
                    className="grid gap-1 rounded-xl bg-indigo-50 p-3 text-xs font-bold text-indigo-950"
                  >
                    {row.price_area}, öre/kWh
                    <input
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={row.amount}
                      onChange={(event) => {
                        const areaPrices = option.area_prices.map(
                          (candidate, candidateIndex) =>
                            candidateIndex === rowIndex
                              ? {
                                  ...candidate,
                                  amount: Number(event.target.value),
                                }
                              : candidate,
                        );
                        patchOption(optionIndex, {
                          area_prices: areaPrices,
                        });
                      }}
                      className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
                    />
                    <code className="truncate text-[9px] font-normal text-indigo-600">
                      {row.price_row_reference}
                    </code>
                  </label>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={options.length === 1}
              onClick={() =>
                setOptions((current) => {
                  const remaining = current.filter(
                    (candidate) =>
                      candidate.price_option_reference !==
                      option.price_option_reference,
                  );
                  if (remaining.length === 1) {
                    return [
                      {
                        ...remaining[0],
                        default: true,
                        selection_required: false,
                      },
                    ];
                  }
                  if (
                    remaining.length > 0 &&
                    !remaining.some((candidate) => candidate.default)
                  ) {
                    remaining[0] = { ...remaining[0], default: true };
                  }
                  return remaining;
                })
              }
              className="mt-3 rounded-lg border border-rose-200 px-3 py-1 text-xs font-bold text-rose-700 disabled:opacity-40"
            >
              Ta bort alternativ
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          setOptions((current) => [
            ...current.map((option) => ({
              ...option,
              selection_required: true,
            })),
            {
              ...newOption(contractType, current.length),
              default: false,
              selection_required: true,
            },
          ])
        }
        className="mt-3 rounded-xl bg-indigo-700 px-4 py-2 text-xs font-black text-white"
      >
        Lägg till prisalternativ
      </button>

      <h3 className="mt-8 font-black text-indigo-950">
        Faktureringssätt
      </h3>
      <div className="mt-3 flex flex-wrap gap-3">
        {INVOICE_DELIVERY_METHODS.map((method) => (
          <label
            key={method}
            className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
          >
            <input
              type="checkbox"
              checked={deliveryMethods.includes(method)}
              onChange={(event) =>
                setDeliveryMethods((current) =>
                  event.target.checked
                    ? [...new Set([...current, method])]
                    : current.filter((candidate) => candidate !== method),
                )
              }
            />
            {method}
          </label>
        ))}
      </div>

      <h3 className="mt-8 font-black text-indigo-950">
        Avgifter, tillval och villkor
      </h3>
      <div className="mt-4 space-y-4">
        {components.map((component, index) => (
          <fieldset
            key={component.component_reference}
            className="rounded-2xl border border-indigo-200 bg-white p-4"
          >
            <div className="grid gap-3 md:grid-cols-4">
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Kundnamn
                <input
                  value={component.customer_name}
                  onChange={(event) =>
                    patchComponent(index, {
                      customer_name: event.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Komponentkod
                <input
                  value={component.component_code}
                  onChange={(event) =>
                    patchComponent(index, {
                      component_code: event.target.value.toLowerCase(),
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Belopp
                <input
                  type="number"
                  step="0.0001"
                  value={component.amount}
                  onChange={(event) =>
                    patchComponent(index, {
                      amount: Number(event.target.value),
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Enhet
                <select
                  value={component.unit}
                  onChange={(event) => {
                    const unit = event.target
                      .value as CommercialPriceComponent["unit"];
                    patchComponent(index, {
                      unit,
                      calculation_type: calculationTypeForUnit(unit),
                      lifecycle: lifecycleForUnit(unit),
                    });
                  }}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  {COMPONENT_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Valpolicy
                <select
                  value={component.selection_policy}
                  onChange={(event) => {
                    const policy = event.target
                      .value as CommercialPriceComponent["selection_policy"];
                    patchComponent(index, {
                      selection_policy: policy,
                      default_selected:
                        policy === "mandatory" || policy === "conditional",
                      customer_can_deselect: policy === "customer_optional",
                      admin_must_select: policy === "admin_optional",
                    });
                  }}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  {COMPONENT_SELECTION_POLICIES.map((policy) => (
                    <option key={policy} value={policy}>
                      {policy}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Livscykel
                <select
                  value={component.lifecycle}
                  onChange={(event) =>
                    patchComponent(index, {
                      lifecycle: event.target
                        .value as CommercialPriceComponent["lifecycle"],
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  {COMPONENT_LIFECYCLES.map((lifecycle) => (
                    <option key={lifecycle} value={lifecycle}>
                      {lifecycle}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Fakturarad
                <input
                  value={component.invoice_line_name}
                  onChange={(event) =>
                    patchComponent(index, {
                      invoice_line_name: event.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Bokföringsklass
                <input
                  value={component.accounting_classification}
                  onChange={(event) =>
                    patchComponent(index, {
                      accounting_classification: event.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            {component.unit === "percent" && (
              <label className="mt-3 grid gap-1 text-xs font-bold text-slate-700 md:max-w-sm">
                Beräkningsbas
                <select
                  value={component.calculation_base ?? ""}
                  onChange={(event) =>
                    patchComponent(index, {
                      calculation_base:
                        (event.target
                          .value as CommercialPriceComponent["calculation_base"]) ||
                        null,
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Välj bas</option>
                  <option value="energy_cost_ex_vat">Energikostnad ex moms</option>
                  <option value="spot_cost">Spotkostnad</option>
                  <option value="portfolio_cost">Portföljkostnad</option>
                  <option value="invoice_subtotal">Fakturasumma</option>
                </select>
              </label>
            )}
            <div className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 md:grid-cols-3">
              <div>
                <div className="text-xs font-bold text-slate-700">
                  Villkor: faktureringssätt
                </div>
                {deliveryMethods.map((method) => (
                  <label
                    key={method}
                    className="mr-3 mt-2 inline-flex items-center gap-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={component.conditions.invoice_delivery_methods.includes(
                        method,
                      )}
                      onChange={(event) =>
                        patchComponent(index, {
                          conditions: {
                            ...component.conditions,
                            invoice_delivery_methods: event.target.checked
                              ? [
                                  ...new Set([
                                    ...component.conditions
                                      .invoice_delivery_methods,
                                    method,
                                  ]),
                                ]
                              : component.conditions.invoice_delivery_methods.filter(
                                  (candidate) => candidate !== method,
                                ),
                          },
                        })
                      }
                    />
                    {method}
                  </label>
                ))}
              </div>
              <div>
                <div className="text-xs font-bold text-slate-700">
                  Villkor: kundtyp
                </div>
                {(["private", "business"] as const).map((customerType) => (
                  <label
                    key={customerType}
                    className="mr-3 mt-2 inline-flex items-center gap-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={component.conditions.customer_types.includes(
                        customerType,
                      )}
                      onChange={(event) =>
                        patchComponent(index, {
                          conditions: {
                            ...component.conditions,
                            customer_types: event.target.checked
                              ? [
                                  ...new Set([
                                    ...component.conditions.customer_types,
                                    customerType,
                                  ]),
                                ]
                              : component.conditions.customer_types.filter(
                                  (candidate) =>
                                    candidate !== customerType,
                                ),
                          },
                        })
                      }
                    />
                    {customerType}
                  </label>
                ))}
              </div>
              <label className="grid gap-1 text-xs font-bold text-slate-700">
                Villkor: prisalternativ
                <select
                  multiple
                  value={component.conditions.price_option_references}
                  onChange={(event) =>
                    patchComponent(index, {
                      conditions: {
                        ...component.conditions,
                        price_option_references: Array.from(
                          event.currentTarget.selectedOptions,
                          (entry) => entry.value,
                        ),
                      },
                    })
                  }
                  className="min-h-20 rounded-xl border border-slate-300 px-2 py-1 text-xs"
                >
                  {options.map((option) => (
                    <option
                      key={option.price_option_reference}
                      value={option.price_option_reference}
                    >
                      {option.customer_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={component.website_published}
                  onChange={(event) =>
                    patchComponent(index, {
                      website_published: event.target.checked,
                    })
                  }
                />
                Publicerad för kund
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={component.informational_only}
                  onChange={(event) =>
                    patchComponent(index, {
                      informational_only: event.target.checked,
                    })
                  }
                />
                Endast information
              </label>
              <code className="text-[11px] text-slate-500">
                {component.component_reference}
              </code>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => moveComponent(index, -1)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
              >
                Upp
              </button>
              <button
                type="button"
                onClick={() => moveComponent(index, 1)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
              >
                Ned
              </button>
              <button
                type="button"
                onClick={() =>
                  setComponents((current) =>
                    current.filter(
                      (candidate) =>
                        candidate.component_reference !==
                        component.component_reference,
                    ),
                  )
                }
                className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-bold text-rose-700"
              >
                Ta bort
              </button>
            </div>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          setComponents((current) => [
            ...current,
            newComponent(current.length),
          ])
        }
        className="mt-3 rounded-xl bg-indigo-700 px-4 py-2 text-xs font-black text-white"
      >
        Lägg till komponent
      </button>
    </section>
  );
}
