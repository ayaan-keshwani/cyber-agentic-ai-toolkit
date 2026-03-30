/** Server uses in_house; legacy UI used in-house. */
export function normalizeItSupport(raw: string): string {
  if (raw === "in-house") return "in_house";
  return raw;
}

export function boolToTri(v: boolean | null | undefined): "" | "true" | "false" {
  if (v === null || v === undefined) return "";
  return v ? "true" : "false";
}

export function triToBool(s: string): boolean | null {
  if (s === "") return null;
  return s === "true";
}
