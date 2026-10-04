/**
 * The JSON Schema subset the agent tools use for their inputs, plus a small
 * validator for it. Tool definitions stay plain JSON so any LLM provider's
 * tool-calling format can be generated from them.
 */
export type JsonSchema =
  | { type: "string"; description?: string; enum?: readonly string[] }
  | { type: "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: JsonSchema; maxItems?: number }
  | { type: "object"; description?: string; properties: Record<string, JsonSchema>; required?: readonly string[]; additionalProperties?: JsonSchema | false };

/** Returns a list of problems, empty when `value` matches `schema`. */
export function validate(schema: JsonSchema, value: unknown, path = "input"): string[] {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return [`${path}: 문자열이어야 합니다`];
      if (schema.enum && !schema.enum.includes(value)) return [`${path}: ${schema.enum.join(", ")} 중 하나여야 합니다`];
      return [];
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return [`${path}: 유한한 숫자여야 합니다`];
      if (schema.minimum !== undefined && value < schema.minimum) return [`${path}: ${schema.minimum} 이상이어야 합니다`];
      if (schema.maximum !== undefined && value > schema.maximum) return [`${path}: ${schema.maximum} 이하여야 합니다`];
      return [];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: true 또는 false여야 합니다`];
    case "array":
      if (!Array.isArray(value)) return [`${path}: 배열이어야 합니다`];
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return [`${path}: 최대 ${schema.maxItems}개입니다`];
      return value.flatMap((v, i) => validate(schema.items, v, `${path}[${i}]`));
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path}: 객체여야 합니다`];
      const obj = value as Record<string, unknown>;
      const errors: string[] = [];
      for (const key of schema.required ?? []) if (!(key in obj)) errors.push(`${path}.${key}: 필수입니다`);
      for (const [key, v] of Object.entries(obj)) {
        const sub = Object.hasOwn(schema.properties, key) ? schema.properties[key] : schema.additionalProperties;
        if (sub === undefined || sub === false) errors.push(`${path}.${key}: 알 수 없는 필드입니다`);
        else errors.push(...validate(sub, v, `${path}.${key}`));
      }
      return errors;
    }
  }
}
