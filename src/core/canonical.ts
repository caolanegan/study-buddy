/** JSON with object keys sorted, so equal data always serialises identically (e.g. after a Postgres jsonb round-trip). */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

/** Deterministic tie-break between two values: returns the one whose canonical JSON sorts last. */
export function pickStable<T>(a: T, b: T): T {
  return canonicalJson(a) >= canonicalJson(b) ? a : b;
}

export function sameData(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
