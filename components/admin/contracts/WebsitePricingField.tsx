export default function WebsitePricingField({
  name,
  label,
  placeholder,
  visibilityName,
  defaultValue,
  defaultVisible = false,
  inputMode = "decimal",
  compact = false,
}: {
  name: string;
  label?: string;
  placeholder?: string;
  visibilityName: string;
  defaultValue?: string | number | null;
  defaultVisible?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
  compact?: boolean;
}) {
  return (
    <div
      className={`min-w-0 border border-slate-200 bg-white ${
        compact ? "rounded-xl p-2.5" : "rounded-2xl p-3"
      }`}
    >
      <label className="block text-xs font-semibold text-slate-700">
        {label ?? placeholder ?? name}
      </label>
      <input
        name={name}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        inputMode={inputMode}
        className={`w-full min-w-0 border border-slate-300 ${
          compact
            ? "mt-1.5 rounded-lg px-3 py-2 text-sm"
            : "mt-2 rounded-xl px-4 py-3"
        }`}
      />
      <label
        className={`flex items-center justify-between text-xs font-semibold leading-4 text-slate-700 ${
          compact ? "mt-2 gap-2" : "mt-3 gap-3"
        }`}
      >
        <span>Visa på hemsidans avtalskort</span>
        <input
          type="checkbox"
          name={visibilityName}
          defaultChecked={defaultVisible}
          className="h-4 w-4 rounded border-slate-300"
        />
      </label>
    </div>
  );
}
