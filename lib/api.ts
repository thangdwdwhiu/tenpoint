export type RecordValue = Record<string, unknown>;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function fetchApi(path: string): Promise<unknown> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      "X-Operator-Key": "dev_operator_key",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
}

export function getRecords(payload: unknown): RecordValue[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["nodes", "tasks", "messages", "items", "data"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
    if (isRecord(value)) {
      const nested = getRecords(value);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function valueOf(record: RecordValue, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return "";
}

export function displayDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

