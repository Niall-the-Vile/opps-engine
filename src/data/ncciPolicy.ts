/**
 * U27 — hand-authored NCCI policy semantics (docs/NCCI_INTEGRATION.md §6.2).
 *
 * This is the "small hand-authored file" §6.2 calls for: the
 * decision-bearing facts from the NCCI Policy Manual (revision 1/1/2026)
 * that make the generated PTP/MUE tables interpretable. Everything here is
 * page-cited. It is NOT generated — `tools/gen-ncci-ptp.mjs` and
 * `tools/gen-ncci-mue.mjs` never touch this file, and it carries no CPT
 * descriptor text, only policy indicators and a fixed modifier vocabulary.
 *
 * ZERO IMPORTS, same discipline as `src/flags.ts` — this is pure data other
 * modules (both `src/phases/classify.ts`, which may import data modules,
 * and eventually `src/dsl/operators.ts`'s callers) can depend on without
 * creating a cycle.
 */

/**
 * CCMI — Correct Coding Modifier Indicator (NCCI Policy Manual I-14).
 *
 * - `'0'` — NCCI PTP-associated modifiers CANNOT be used to bypass the edit.
 * - `'1'` — they MAY be used, under appropriate clinical circumstances.
 * - `'9'` — "use is not specified," assigned to pairs whose deletion date
 *   equals the effective date, purely to keep the field non-blank. This is
 *   a tombstone, not a third policy — `9` pairs are excluded from the
 *   active PTP lookup entirely (see `tools/gen-ncci-ptp.mjs`), so no rule
 *   ever needs to branch on it directly.
 */
export type Ccmi = '0' | '1' | '9';

/**
 * The NCCI PTP-associated modifier set (NCCI Policy Manual I-14, exact).
 * A line carrying one of these MAY bypass a CCMI `1` edit; a CCMI `0` edit
 * is never bypassable regardless of which modifiers are present.
 *
 * Explicitly NOT in this set, and this is deliberate (I-14 names this as
 * exactly the near-miss a hand-written rule gets wrong): `22`, `76`, `77`.
 * Their presence must never be treated as satisfying this set — do not
 * "helpfully" generalize this into a broader modifier-presence check.
 */
export const NCCI_PTP_BYPASS_MODIFIERS: readonly string[] = [
  // Anatomic
  'E1', 'E2', 'E3', 'E4', 'FA',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9',
  'TA',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9',
  'LT', 'RT', 'LC', 'LD', 'RC', 'LM', 'RI',
  // Global surgery
  '24', '25', '57', '58', '78', '79',
  // Other
  '27', '59', '91', 'XE', 'XS', 'XP', 'XU',
];

/** Fast membership test — see `NCCI_PTP_BYPASS_MODIFIERS`'s own header for what this excludes and why. */
const BYPASS_MODIFIER_SET: ReadonlySet<string> = new Set(NCCI_PTP_BYPASS_MODIFIERS);

export function isNcciPtpBypassModifier(modifier: string): boolean {
  return BYPASS_MODIFIER_SET.has(modifier);
}

/**
 * Does this line's modifier list bypass a CCMI-`1` PTP edit? `false` for
 * CCMI `0` is the caller's responsibility (§4.1 — CCMI 0 is never
 * bypassable, this function is not even consulted for it).
 *
 * Explicitly does NOT bypass on `22`, `76`, or `77` — those are not in
 * `NCCI_PTP_BYPASS_MODIFIERS`, so `.some(isNcciPtpBypassModifier)` already
 * returns `false` for a line carrying only those, but this is called out
 * here because it is the exact near-miss I-14 warns a hand-written rule
 * gets wrong: a lazy "does this line carry any modifier at all" check
 * would wrongly bypass on `22`/`76`/`77`. This function never does that.
 */
export function lineBypassesPtpEdit(modifiers: readonly string[]): boolean {
  return modifiers.some(isNcciPtpBypassModifier);
}

/**
 * MAI — MUE Adjudication Indicator (NCCI Policy Manual I-28/I-29).
 *
 * - `1` — claim-line edit: units-of-service on *each line* compared to the
 *   MUE value; excess denies that line only. Overridable per line via the
 *   usual anatomic/global-surgery/other modifier set plus `76`/`77`/`91`.
 * - `2` — date-of-service, absolute: units summed across all lines for
 *   that code and date of service; excess denies all UOS for that code
 *   that day. NOT overridable — override "would be contrary to CMS
 *   policy."
 * - `3` — date-of-service, clinical benchmark: same summing as `2`, but a
 *   contractor MAY bypass on medical-record evidence.
 *
 * Not consumed by any live rule in this build — see `MUE.LIMIT`'s note in
 * `src/registry/opps.dispositions.json` for why (spec §19.2, D89).
 */
export type Mai = 1 | 2 | 3;

/**
 * An MUE value of `0` means the code is invalid, not covered, bundled, not
 * separately payable, or statutorily excluded — NOT "no limit" (I-31).
 * Exported as a named predicate so a caller never has to re-derive this
 * from a raw `=== 0` comparison without the citation attached.
 */
export function mueZeroMeansNotPayable(mueValue: number): boolean {
  return mueValue === 0;
}
