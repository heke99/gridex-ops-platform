export const CANONICAL_LEGAL_MODULES = [
  "general_consumer_terms",
  "general_business_terms",
  "variable_price_terms",
  "hourly_price_terms",
  "quarterly_price_terms",
  "fixed_price_terms",
  "mixed_price_terms",
  "portfolio_terms",
  "price_terms",
  "billing_terms",
  "pre_contract_information",
  "distance_contract_information",
  "withdrawal_right",
  "withdrawal_form",
  "privacy_policy",
  "power_of_attorney",
  "supplier_switch_terms",
  "automatic_renewal",
  "termination_and_breach",
  "complaints_and_disputes",
  "company_information",
  "agreement_confirmation",
  "terms_change_notice",
  "authorized_signatory",
  "credit_and_late_payment",
  "liability_limitation",
  "volume_forecast_responsibility",
  "production_terms",
] as const;

export type CanonicalLegalModule = (typeof CANONICAL_LEGAL_MODULES)[number];

export const CANONICAL_LEGAL_MODULE_LABELS: Record<CanonicalLegalModule, string> = {
  general_consumer_terms: "Allmänna konsumentvillkor",
  general_business_terms: "Allmänna företagsvillkor",
  variable_price_terms: "Månadsprisvillkor",
  hourly_price_terms: "Timprisvillkor",
  quarterly_price_terms: "Kvartsprisvillkor",
  fixed_price_terms: "Fastprisvillkor",
  mixed_price_terms: "Mixprisvillkor",
  portfolio_terms: "Portföljvillkor",
  price_terms: "Pris- och betalningsvillkor",
  billing_terms: "Faktureringsvillkor",
  pre_contract_information: "Förköpsinformation",
  distance_contract_information: "Information om distansavtal",
  withdrawal_right: "Ångerrätt",
  withdrawal_form: "Ångerblankett",
  privacy_policy: "Integritetspolicy",
  power_of_attorney: "Fullmakt",
  supplier_switch_terms: "Leveransstart och leverantörsbyte",
  automatic_renewal: "Automatisk förlängning",
  termination_and_breach: "Uppsägning och avtalsbrott",
  complaints_and_disputes: "Klagomål och tvistlösning",
  company_information: "Bolags- och kontaktinformation",
  agreement_confirmation: "Avtalsbekräftelse",
  terms_change_notice: "Ändring av villkor",
  authorized_signatory: "Behörig firmatecknare",
  credit_and_late_payment: "Kredit, dröjsmål och avstängning",
  liability_limitation: "Ansvar och ansvarsbegränsning",
  volume_forecast_responsibility: "Volymprognos och avvikelseansvar",
  production_terms: "Produktionsvillkor",
};

export function isCanonicalLegalModule(value: string): value is CanonicalLegalModule {
  return (CANONICAL_LEGAL_MODULES as readonly string[]).includes(value);
}

export function canonicalLegalModuleLabel(value: string): string {
  return isCanonicalLegalModule(value)
    ? CANONICAL_LEGAL_MODULE_LABELS[value]
    : value.replaceAll("_", " ");
}
