/**
 * U12a — the engine's public entry point (spec §5.1, §12.4). Exports
 * `adjudicate()` and `ENGINE_CONTRACT_VERSION`.
 *
 * This file owns the `unknown`-in runtime validation boundary (§12.2): raw
 * `claim`/`options` are validated via `dsl/validate.ts` unconditionally, in
 * every mode, before anything else runs. `registry` defaults to this
 * package's own bundled `src/registry/*.json` content (§2.6) when the
 * caller omits it, and is validated (shape) + normalized via
 * `registry/loader.ts` either way. `adjudicate()` throws only `EngineError`,
 * and only with a load-time code (§12.7) — every fault at or after that
 * point is contained per-line by `dsl/evaluate.ts` (§12.8) or, for phase 1,
 * by `phases/classify.ts`'s own per-line try/catch (see that file).
 *
 * `data` and `contracts` are deliberately NOT parameters here. `contracts`
 * is phase 4 (CONTRACT), out of scope for this batch. `data` has no
 * injectable seam in the current codebase — `src/data/index.ts` builds its
 * lookup indexes from module-level singletons over the generated
 * `*.cy2026.ts` files, not from a caller-supplied bundle — so accepting a
 * `data` parameter here would be cosmetic, not functional. Disclosed as a
 * simplification in the final report, not silently narrowed.
 */

import type { ClaimInput, EngineError, EngineErrorCode } from './types.js';
import { validateClaimInput, validateOptions, type EngineOptionsInput } from './dsl/validate.js';
import { loadRegistry } from './registry/loader.js';
import { adjudicateClaim, type EngineResult } from './phases/adjudicate.js';

import { EXEMPT_RULES, PACKAGING_RULES, DISPOSITION_RULES } from './registry/index.js';

/** §12.4 — consumers assert on load. Bump on any breaking input/output shape change. */
export const ENGINE_CONTRACT_VERSION = '2026.1.0';

/**
 * This package's own registry, combined. Re-validated (not just re-used) on
 * every `loadRegistry()` call — see that function's own header on why
 * duplicate-`id` checking needs the full combined array.
 *
 * `./registry/index.js` is generated (`npm run gen:data`, see
 * `tools/gen-registry.mjs`) from `src/registry/*.json` — the JSON stays the
 * authored, reviewable source of truth (§2.7); this is a plain `.ts` literal
 * mirror so the engine itself never imports JSON as a module (§12.1
 * acceptance criterion 3 — no `resolveJsonModule` in the consumer's
 * repo-wide tsconfig).
 */
const BUNDLED_REGISTRY: readonly unknown[] = [...EXEMPT_RULES, ...PACKAGING_RULES, ...DISPOSITION_RULES];

export interface AdjudicateInput {
  /** Raw, unvalidated — see `dsl/validate.ts#validateClaimInput` (§2.1, §5.1). */
  readonly claim: unknown;
  /** Raw, unvalidated `EngineOptions` (§5.1). Omit for documented defaults. */
  readonly options?: unknown;
  /** Raw, unvalidated registry rule array (§4.2). Omit to use this package's own bundled registry (§2.6). */
  readonly registry?: readonly unknown[];
}

function loadError(code: EngineErrorCode, path: string, detail: string, claimId: string | null): EngineError {
  return { name: 'EngineError', code, path, detail, claimId };
}

function toEngineOptions(input: EngineOptionsInput): { validate: EngineOptionsInput['validate']; traceLevel: EngineOptionsInput['traceLevel']; values: EngineOptionsInput['values'] } {
  return { validate: input.validate, traceLevel: input.traceLevel, values: input.values };
}

/**
 * The engine's public entry point (spec §5.1's `adjudicate({claim, options,
 * registry, contracts, data}): Result`, restricted to this batch's scope —
 * see file header). Throws `EngineError` only, and only for a load-time
 * fault: schema-invalid claim/options, or a registry that fails
 * `dsl/validate.ts`'s shape boundary or `registry/loader.ts`'s envelope
 * normalization.
 */
export function adjudicate(input: AdjudicateInput): EngineResult {
  const claim: ClaimInput = validateClaimInput(input.claim);
  const options = validateOptions(input.options, claim.claimId);

  const rawRegistry = input.registry ?? BUNDLED_REGISTRY;
  let rules;
  try {
    rules = loadRegistry(rawRegistry);
  } catch (err) {
    if (isEngineError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw loadError('REGISTRY_INVARIANT_VIOLATION', 'registry', message, claim.claimId);
  }

  return adjudicateClaim(claim, toEngineOptions(options), rules);
}

function isEngineError(v: unknown): v is EngineError {
  return typeof v === 'object' && v !== null && (v as { name?: unknown }).name === 'EngineError';
}

export type { EngineResult, Determination, DeterminationLine } from './phases/adjudicate.js';
export type { Applicability, Gate, LikelySystem } from './phases/classify.js';
