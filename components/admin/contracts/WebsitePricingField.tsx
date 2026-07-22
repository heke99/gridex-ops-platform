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
        required={required}
        aria-describedby={helpText ? `${name}-help` : undefined}
        className={`w-full min-w-0 border border-slate-300 ${
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
        className={`flex items-center justify-between text-xs font-semibold leading-4 text-slate-700 ${
          compact ? "mt-2 gap-2" : "mt-3 gap-3"
        }`}
      >
        <span>{visibilityLabel}</span>
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
