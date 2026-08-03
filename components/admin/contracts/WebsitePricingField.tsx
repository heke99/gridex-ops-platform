export default function WebsitePricingField({
  name,
  label,
  placeholder,
  visibilityName,
  visibilityLabel = "Visa på hemsidans avtalskort",
  helpText,
  defaultValue,
  defaultVisible = false,
  required = false,
  inputMode = "decimal",
  compact = false,
  visibilityLocked = false,
}: {
  name: string;
  label?: string;
  placeholder?: string;
  visibilityName: string;
  visibilityLabel?: string;
  helpText?: string;
  defaultValue?: string | number | null;
  defaultVisible?: boolean;
  required?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
  compact?: boolean;
  visibilityLocked?: boolean;
}) {
  return (
    <div
      className={`min-w-0 overflow-hidden border border-slate-200 bg-white ${
        compact ? "rounded-xl p-2.5" : "rounded-2xl p-3"
      }`}
    >
      <label className="block min-w-0 text-xs font-semibold text-slate-700">
        <span className="break-words">{label ?? placeholder ?? name}</span>
        {required ? (
          <span className="ml-1 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-rose-700">
            Obligatoriskt
          </span>
        ) : null}
      </label>
      <input
        name={name}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        inputMode={inputMode}
        required={required}
        aria-describedby={helpText ? `${name}-help` : undefined}
        className={`w-full min-w-0 border border-slate-300 bg-white outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 ${
          compact
            ? "mt-1.5 rounded-lg px-3 py-2 text-sm"
            : "mt-2 rounded-xl px-4 py-3"
        }`}
      />
      {helpText ? (
        <p
          id={`${name}-help`}
          className={`${compact ? "mt-1.5" : "mt-2"} text-xs leading-5 text-slate-600`}
        >
          {helpText}
        </p>
      ) : null}
      <label
        className={`flex min-w-0 flex-wrap items-center justify-between text-xs font-semibold leading-4 text-slate-700 ${
          compact ? "mt-2 gap-2" : "mt-3 gap-3"
        }`}
      >
        <span className="min-w-0 break-words">{visibilityLabel}</span>
        {visibilityLocked ? (
          <input type="hidden" name={visibilityName} value="on" />
        ) : null}
        <input
          type="checkbox"
          name={visibilityName}
          defaultChecked={visibilityLocked ? true : defaultVisible}
          disabled={visibilityLocked}
          className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-70"
        />
      </label>
    </div>
  );
}
