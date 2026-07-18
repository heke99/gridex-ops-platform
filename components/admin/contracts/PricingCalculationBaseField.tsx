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
  compact = false,
}: {
  name: string;
  label?: string;
  defaultValue?: string;
  compact?: boolean;
}) {
  return (
    <label className="text-xs font-semibold text-slate-700">
      {label}
      <select
        name={name}
        defaultValue={defaultValue}
        className={`w-full border border-slate-300 bg-white text-sm ${
          compact
            ? "mt-1.5 rounded-lg px-3 py-2"
            : "mt-2 rounded-xl px-4 py-3"
        }`}
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
