const SWEDISH_TRANSLITERATION: Readonly<Record<string, string>> = {
  å: "a",
  ä: "a",
  ö: "o",
  Å: "a",
  Ä: "a",
  Ö: "o",
};

export function slugifyContract(value: string): string {
  const transliterated = Array.from(value)
    .map((character) => SWEDISH_TRANSLITERATION[character] ?? character)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
