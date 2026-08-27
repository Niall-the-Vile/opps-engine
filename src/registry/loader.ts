/**
 * Registry loader (part of the batch-2 wiring: `phases/adjudicate.ts` +
 * `src/index.ts` + this file). Converts the hand-authored, single-key
 * envelope registry JSON under `src/registry/*.json` (validated shape-only
 * by `dsl/validate.ts`'s `validateRegistryShape`, spec §12.2) into the
 * `{op, args}` `Rule[]` shape `dsl/evaluate.ts`'s interpreter consumes.
 *
 * NORMALIZATION SCOPE — READ BEFORE EDITING REGISTRY JSON. Spec §4.3.1 once
 * described a per-operator bare-vs-named argument shorthand ("a
 * single-dimension operator takes that payload bare... an operator with two
 * or more takes a named object"), normalized by a `normalizeArgs()` every
 * operator in `dsl/operators.ts` would export. That shorthand was never
 * implemented (no `normalizeArgs` exists anywhere in `operators.ts`) and has
 * since been removed from the spec (U12b) — every operator's
 * `evaluate`/`describe`/`argSpec` accepts ONLY the named-object form (e.g.
 * `siIn` requires `{si: [...]}`, never bare `["Q4"]`), and `dsl/validate.ts`
 * now enforces exactly that at load time (`REGISTRY_SCHEMA_INVALID` on a
 * bare or otherwise malformed payload, checked via each operator's own
 * `argSpec()` — see that function's header). So every rule in
 * `src/registry/*.json` is hand-authored one way, consistently:
 *
 *   - Top-level `scope`/`when`/each `then[]` entry: the single-key envelope
 *     `dsl/validate.ts` validates both the *shape* — `{"<opName>":
 *     <payload>}` — and the *payload*, which is ALWAYS the full named-object
 *     form an operator's `evaluate()` expects. This loader's only job for
 *     these positions is unwrapping the single key into `{op, args}` — a
 *     structural transform, not an argument-shape decision, so it does not
 *     re-encode anything `operators.ts` owns.
 *   - Nested predicate positions — `allOf.children[]`, `anyOf.children[]`,
 *     `not.child`, and every `among` (isHighestBy/isNotHighestBy/ordinalIs/
 *     ordinalAtLeast/bundleUnder) — are authored directly as `{op, args}`
 *     nodes in the JSON, matching exactly what `operators.ts`'s
 *     `requirePredicateNode` already expects. No unwrapping needed there;
 *     this loader passes them through unchanged (they live inside an
 *     already-named-object payload), and `dsl/validate.ts` validates them
 *     too — one `argSpec()` call at the top-level envelope recurses through
 *     the whole nested subtree (see that operator's own recursion note).
 *
 * A generic reconciliation between the compact JSON envelope and the
 * interpreter's internal `{op, args}` node shape for nested children was
 * also once described here as missing; it isn't needed either, since the
 * registry JSON already authors nested positions directly in `{op, args}`
 * form (see the second bullet above).
 */

import type { Rule } from '../dsl/evaluate.js';
import { validateRegistryShape, type RuleShape } from '../dsl/validate.js';

function normalizeEnvelopeNode(raw: Record<string, unknown>, where: string): { op: string; args: unknown } {
  const keys = Object.keys(raw);
  const opName = keys[0];
  if (opName === undefined || keys.length !== 1) {
    throw new Error(`registry loader: ${where} must be a single-key operator envelope, got keys ${JSON.stringify(keys)}`);
  }
  return { op: opName, args: raw[opName] };
}

function asSubBand(v: string, ruleId: string): 'a' | 'b' {
  if (v === 'a' || v === 'b') return v;
  throw new Error(`registry loader: rule "${ruleId}" declares subBand "${v}" — must be "a" or "b" (§2.5)`);
}

function normalizeRule(shape: RuleShape): Rule {
  const scope = normalizeEnvelopeNode(shape.scope, `rule[${shape.id}].scope`);
  const when = shape.when === undefined ? undefined : normalizeEnvelopeNode(shape.when, `rule[${shape.id}].when`);
  const then = shape.then.map((item, i) => normalizeEnvelopeNode(item, `rule[${shape.id}].then[${i}]`));

  return {
    id: shape.id,
    version: shape.version,
    phase: shape.phase,
    band: shape.band,
    order: shape.order,
    epoch: shape.epoch,
    scopeTarget: shape.scopeTarget,
    citation: shape.citation,
    scope,
    then,
    ...(shape.subBand !== undefined ? { subBand: asSubBand(shape.subBand, shape.id) } : {}),
    ...(when !== undefined ? { when } : {}),
    ...(shape.note !== undefined ? { note: shape.note } : {}),
    ...(shape.dataRequired !== undefined ? { dataRequired: shape.dataRequired } : {}),
    ...(shape.exclusive !== undefined ? { exclusive: shape.exclusive } : {}),
  };
}

/**
 * Validates (§12.2 boundary — shape only) and normalizes a flat array of
 * raw, already-`JSON.parse`d registry rule objects into `dsl/evaluate.ts`
 * `Rule[]`. Callers combine every `src/registry/*.json` file's array into
 * one before calling this once, so duplicate-`id` checking (`dsl/
 * validate.ts`) runs across the whole registry, not per file.
 */
export function loadRegistry(rawRules: readonly unknown[]): readonly Rule[] {
  const shapes = validateRegistryShape(rawRules);
  return shapes.map(normalizeRule);
}

/** Stamped onto `Result.provenance.registryVersion` (spec §5.1) — every rule in this batch's registry shares this version. */
export const REGISTRY_VERSION = '2026.1';
