export type ValueType = "phone" | "email" | "url";

// Semantic field types are shared across entity kinds and source namespaces.
export function sourceValueType(field: string): ValueType | undefined {
  if (/^(?:.*_)?(?:phone|phone_number|fax|fax_number)$/.test(field))
    return "phone";
  if (/^(?:.*_)?(?:email|email_address)$/.test(field)) return "email";
  if (field === "website" || /^(?:.*_)?url$/.test(field)) return "url";
  return undefined;
}
