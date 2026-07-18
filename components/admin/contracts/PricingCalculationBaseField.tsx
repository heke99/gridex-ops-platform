export const PRICING_CALCULATION_BASES = [
  ["portfolio_cost", "Portföljens energikostnad exkl. moms"],
  ["spot_cost", "Spotdelens energikostnad exkl. moms"],
  ["energy_cost_ex_vat", "Total energikostnad exkl. moms"],
  ["energy_cost_inc_vat", "Total energikostnad inkl. moms"],
  ["total_variable_cost", "Total rörlig kostnad exkl. moms"],
  ["invoice_subtotal", "Fakturasumma hittills exkl. moms"],
  ["monthly_fixed_amount", "Fasta månadsavgifter exkl. moms"],
] as const;

export default function PricingCalculationBaseField({
  name,
  label = "Beräkningsbas när enheten är procent",
  defaultValue = "energy_cost_ex_vat",
}: {
  name: string;
  label?: string;
  defaultValue?: string;
}) {
  return (
    <label className="text-xs font-semibold text-slate-700">
      {label}
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
      >
        {PRICING_CALCULATION_BASES.map(([value, optionLabel]) => (
          <option key={value} value={value}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
