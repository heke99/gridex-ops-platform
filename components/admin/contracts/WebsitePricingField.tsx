export default function WebsitePricingField({
  name,
  label,
  placeholder,
  visibilityName,
  defaultValue,
  defaultVisible = false,
  inputMode = "decimal",
}: {
  name: string;
  label?: string;
  placeholder?: string;
  visibilityName: string;
  defaultValue?: string | number | null;
  defaultVisible?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
      <label className="block text-xs font-semibold text-slate-700">
        {label ?? placeholder ?? name}
      </label>
      <input
        name={name}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        inputMode={inputMode}
        className="mt-2 w-full min-w-0 rounded-xl border border-slate-300 px-4 py-3"
      />
      <label className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
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
