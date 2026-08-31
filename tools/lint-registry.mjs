#!/usr/bin/env node
// tools/lint-registry.mjs — U18. Registry lint (spec §15.3), plus three
// gates §15.3 predates (D45, D66, D64) and one bonus gate §12.7 asks for
// (the flag-manifest check evaluate.ts's own comment says belongs here).
//
// WHY THIS FILE MATTERS MORE THAN ITS SIZE SUGGESTS
// Two multi-agent review passes cost ~2.66M tokens to find nine defects,
// most of which this file now catches in milliseconds. docs/BUILD_LOG.md's
// build protocol item 6: "every review finding owes a deterministic check."
// Every gate below traces to a spec clause or a named decision (D45/D64/
// D66/D63/§12.7) — see each gate's own header comment for the citation.
//
// SCOPE: lints the HAND-AUTHORED JSON under src/registry/*.json (read
// directly with `fs`, same as tools/gen-registry.mjs) — that is what a
// human edits and reviews. src/registry/index.ts is a GENERATED MIRROR
// (tools/gen-registry.mjs); this file never hand-edits it, and treats a
// JSON/mirror mismatch as its own gate (REGISTRY_MIRROR_STALE) rather than
// silently trusting either copy — a stale mirror is exactly what ran a
// fix's rules under the *old* logic earlier today (see final report).
//
// SHAPE OF THIS FILE — pure gates vs. CLI. The rule-level gates (everything
// duplicate-id through D66) are pure functions of a rule array plus the
// real `operators`/`isKnownFlagCode` values, exported as `lintRules()` so
// `test/lint-registry.test.ts` can call them directly against SYNTHETIC
// rules — no subprocess, no vite-node, since vitest already resolves this
// repo's `.js`-imports-`.ts` specifiers itself. The whole-registry gates
// (D64's spec-table comparison, the mirror-staleness check, the dynamic
// interpreter sweep, and the "cannot check" deferrals) need real file
// paths and/or `adjudicate()`, so they stay CLI-only, run from `main()`
// below. `main()` and the module-import bootstrap it needs run ONLY when
// this file is executed directly (`node tools/lint-registry.mjs`) — see
// `isMainModule` below — never on import, so importing this module (as the
// test file does) has no side effects.
//
// THE TYPESCRIPT LOADER PROBLEM, CLI-side only. `main()` needs the REAL
// operators.ts/evaluate.ts/index.ts/flags.ts as the single source of
// truth, rather than a second, driftable copy of that logic living here —
// that duplication is exactly what D64 is about. `tools/adjudicate.mjs`
// establishes the house pattern: this repo's `.ts` files import sibling
// `.ts` files via `.js` specifiers (moduleResolution: "Bundler"), which no
// plain `node` loader resolves; `vite-node` (a `vitest` devDependency, not
// a new one) does, the same runtime `npx vitest run` already uses. See
// that file's header for the full explanation.
// ---------------------------------------------------------------------------

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ===========================================================================
// Predicate-tree walking. Registry JSON uses TWO node shapes (see
// src/registry/loader.ts's header): the top-level `scope`/`when`/each
// `then[]` entry is a single-key ENVELOPE (`{"siIn": {...}}`); everything
// nested under `children`/`child`/`among` is already `{op, args}`, exactly
// as `dsl/operators.ts` consumes it. `normalizeNode` accepts either so
// every walker below is shape-agnostic. Pure — no dependency on operators.ts
// or any other module — so it works identically for the CLI and for tests.
// ===========================================================================

export function normalizeNode(node) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return null;
  if (typeof node.op === 'string' && 'args' in node) return { op: node.op, args: node.args };
  const keys = Object.keys(node);
  if (keys.length === 1) return { op: keys[0], args: node[keys[0]] };
  return null;
}

/** Calls `visit(opName, args, rawNode)` on `node` and recurses through every nesting shape the closed set uses (`children`, `child`, `among`). Malformed shapes are silently skipped here — that is validate.ts's/evaluate.ts's job, not this walker's. */
export function walkTree(node, visit) {
  const n = normalizeNode(node);
  if (n === null) return;
  visit(n.op, n.args, node);
  const args = n.args;
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    if (Array.isArray(args.children)) for (const c of args.children) walkTree(c, visit);
    if (args.child !== undefined) walkTree(args.child, visit);
    if (args.among !== undefined) walkTree(args.among, visit);
  }
}

function ruleTopLevelNodes(rule) {
  /** @type {{position:string, node:unknown}[]} */
  const out = [{ position: 'scope', node: rule.scope }];
  if (rule.when !== undefined) out.push({ position: 'when', node: rule.when });
  if (Array.isArray(rule.then)) rule.then.forEach((n, i) => out.push({ position: `then[${i}]`, node: n }));
  return out;
}

// §4.4's argSpec vocabulary, corrected per this doc's own amendment
// ("dimension gains rate and weight ... so hasRate and hasWeight have an
// honest home"). operators.ts's OWN ArgSpecDimension list does NOT yet
// include rate/weight (see that file's hasRate/hasWeight comments: "no
// dimension fits 'rate' in the closed vocabulary ... see final report") —
// checking against the SPEC's (corrected) vocabulary, not just replaying
// operators.ts's self-consistent-by-construction one, is what makes this
// gate able to catch anything at all; see final report for this exact gap.
const ARG_SPEC_KINDS = new Set(['linePredicate', 'claimPresence', 'claimQuantity', 'relational', 'context', 'composite', 'reserved', 'effect']);
const ARG_SPEC_DIMENSIONS = new Set(['si', 'code', 'apc', 'schedule', 'status', 'modifier', 'option', 'units', 'money', 'date', 'rate', 'weight']);

// TYPE-level nullability only (LineFacts: rateMils/weight are `number |
// null`; chargeMils/unitCount are plain `number`, dsl/operators.ts). §15.3
// asks for a field that is nullable IN THE DATA, not in the type — a
// stricter, data-driven check lives in `checkRankingFallback` below via the
// injected `rankFieldNullability` dependency. This set is retained only to
// decide which fields are even WORTH asking the data about (chargeMils/
// unitCount can never be null by type, so there's nothing to check) and to
// drive the informational (non-failing) "type permits null, data doesn't
// have any" note.
const TYPE_NULLABLE_RANK_FIELDS = new Set(['rateMils', 'weight']);
const RANK_SELECTOR_OPS = new Set(['isHighestBy', 'isNotHighestBy', 'ordinalIs', 'ordinalAtLeast']);
const CLAIM_AMOUNT_TARGETS = new Set(['claimMedicareMils', 'claimContractMils']); // setAmount targets that are claim-level (§4.3) — setAmount itself is not in milestone 1's closed set (D65), so this branch is currently unreachable; kept for when it is added.
const STRUCTURAL_EFFECTS = new Set(['bundleUnder', 'convertSI', 'route', 'setBasis']);

const EPOCH_ORDER = ['E0', 'E1', 'E2', 'E3a', 'E3b', 'E4'];
function epochRank(e) {
  return EPOCH_ORDER.indexOf(e);
}

/**
 * Mirrors dsl/evaluate.ts's `EPOCH_WINDOWS_IN_ORDER` / `windowForRule`
 * exactly (band 1000 -> E0 ceiling; bands 2000/3000 share one window at E1;
 * band 4000 subBand a/b at E2/E3a; band 5000 at E3b; anything after at E4)
 * — see that file's own header comment for why bands 2000/3000 share a
 * window. Kept here (rather than importing a private function) because
 * `windowForRule` is not exported; this table is small, stable, and
 * spec-derived (§2.5's own table), not evaluate.ts-internal-derived, so the
 * duplication risk is low and is called out here for a future maintainer.
 */
function windowFor(rule) {
  const band = rule.band;
  if (band === 1000) return { rank: 1, ceilingEpoch: 'E0' };
  if (band === 2000 || band === 3000) return { rank: 2, ceilingEpoch: 'E1' };
  if (band === 4000) {
    if (rule.subBand === 'b') return { rank: 4, ceilingEpoch: 'E3a' };
    return { rank: 3, ceilingEpoch: 'E2' }; // subBand 'a' or (invalid, but not this gate's job) undefined
  }
  if (band === 5000) return { rank: 5, ceilingEpoch: 'E3b' };
  return { rank: 6, ceilingEpoch: 'E4' };
}

function isBundledStatusGuard(node) {
  const n = normalizeNode(node);
  if (n === null || n.op !== 'statusIn') return false;
  const status = n.args && n.args.status;
  return Array.isArray(status) && status.includes('BUNDLED');
}

function containsNotBundledGuard(node) {
  let found = false;
  walkTree(node, (opName, opArgs) => {
    if (found) return;
    if (opName === 'not' && isBundledStatusGuard(opArgs && opArgs.child)) found = true;
  });
  return found;
}

/**
 * D45 FOLLOW-ON. Pre-migration, the not-BUNDLED ordering guard always lived
 * in a rule's `scope` (D45 itself is what forced it out — a claim-relational
 * predicate in `scope` is exactly what §4.3 forbids). The structural-conflict
 * gates below decide "is a later/peer writer safe" by asking whether IT
 * carries that guard, and originally only ever looked at `rule.scope` to
 * answer that, because that was the guard's only legal home at the time.
 * Post-migration the guard's only legal home is `when` (or `scope` AND
 * `when`, if a future rule needs both) — §4.3 states the move "costs nothing
 * behaviourally," and dsl/evaluate.ts confirms it structurally: `scope` and
 * `when` are evaluated against the identical frozen epoch snapshot for a
 * given rule (see `runLineScopedRuleForLine`'s single `scopeCtx`), so a
 * guard's *safety argument* does not depend on which of the two positions it
 * sits in. A helper that still only checked `scope` would report a flood of
 * brand-new false-positive hard failures the moment D45's own fix landed —
 * exactly the D63 mistake ("a gate that breaks the day it should be
 * satisfied"). This checks both positions; nothing about the underlying
 * safety argument changed, only where the guard is legally allowed to live.
 */
function hasNotBundledGuardAnywhere(rule) {
  return containsNotBundledGuard(rule.scope) || containsNotBundledGuard(rule.when ?? null);
}

// ===========================================================================
// D45 FOLLOW-ON, continued. Two more sound, narrow safety arguments that the
// pre-migration registry never needed the lint to know, because the rules
// they apply to (OPPS.PKG.J1.CONTROL, OPPS.CAPC8011.CONTROL,
// OPPS.CAPC8011.CONTROLLING) had a D45-undecidable `scope` — meaning their
// structural-effect domain was `{kind:'unresolved'}` and the pairwise checks
// below SKIPPED them entirely (see the "N skipped" info lines this file has
// always printed). That was a coverage gap, not a proof of safety: these
// rules were never actually checked against anything. Making their scope
// decidable (`always`, per D45/§4.3 — their real domain is "every non-exempt
// line," which is not SI-derivable, so `always` is the correct selector, not
// a lazy default) resolves their domain to `{kind:'all'}`, which now
// legitimately enters the pairwise checks — and exposes that this tool's
// only known "two writers are safe together" argument (the not-BUNDLED
// ordering guard) is not the only one the registry actually relies on. Two
// more, both real and both provable from the rules' own `when`/`scope` data:
//
//   (b) CLAIM-CENSUS MUTUAL EXCLUSION. OPPS.PKG.J1.CONTROL only ever fires
//       when `claimContainsAny({J1})` — i.e. only on a claim that HAS a J1
//       line. OPPS.CAPC8011.CONTROL/CONTROLLING only ever fire when
//       `claimContainsNone({J1})` — only on a claim with NO J1 line. Those
//       two conditions cannot both be true for the same claim, so on ANY
//       given claim at most one of the two rules ever applies its effects at
//       all — they can never write the same line twice regardless of window
//       or epoch timing. General form: rule A requires
//       `claimContainsAny(X)` and rule B requires `claimContainsNone(Y)`
//       with `X subset-of Y` (checked in either direction) => A firing on a
//       claim implies some line has an SI in X subset-of Y, contradicting B's
//       "none of Y" — so A and B are never both true on one claim.
//   (c) EXEMPTION DISJOINTNESS. OPPS.PKG.J1.CONTROL/OPPS.CAPC8011.CONTROL
//       only ever fire on a line where `not(isExempt)` holds. Every SI the
//       exempt-set rules (band 1000, `src/registry/opps.exempt.json`)
//       unconditionally mark exempt — {U, G, H, F, L, S1, H1, K1}, computed
//       from THOSE rules' own (decidable) scope here, never hand-copied —
//       can therefore never satisfy `not(isExempt)`. So a rule whose own
//       scope domain is wholly contained in that always-exempt SI set (e.g.
//       OPPS.DISP.G's `siIn: [G]`) can never share a line with a rule that
//       requires `not(isExempt)`, regardless of window, band, or guard.
//
// Both are real properties of the registry's own `when`/`scope` data, not an
// exception carved out for these specific rule ids — a future rule with the
// same shape gets the same, sound treatment.
// ===========================================================================

/** Collects the `si` sets of every top-level-reachable `claimContainsAny`/`claimContainsNone` node in a predicate tree (walks through allOf/anyOf/not, same as every other walker here). */
function collectClaimSiSets(node, opName) {
  const sets = [];
  walkTree(node ?? null, (foundOp, args) => {
    if (foundOp === opName && args && Array.isArray(args.si)) sets.push(new Set(args.si));
  });
  return sets;
}

function isSubset(small, big) {
  for (const v of small) if (!big.has(v)) return false;
  return true;
}

/**
 * True if `whenA`/`whenB` (either may be `undefined`, meaning "always true")
 * are provably mutually exclusive over SI containment: A requires
 * `claimContainsAny(X)` and B requires `claimContainsNone(Y)` with
 * `X subset-of Y` (or the same with A/B swapped) — see (b) above.
 */
function mutuallyExclusiveByClaimCensus(whenA, whenB) {
  const aAny = collectClaimSiSets(whenA, 'claimContainsAny');
  const aNone = collectClaimSiSets(whenA, 'claimContainsNone');
  const bAny = collectClaimSiSets(whenB, 'claimContainsAny');
  const bNone = collectClaimSiSets(whenB, 'claimContainsNone');
  const excludes = (anySets, noneSets) => anySets.some((x) => noneSets.some((y) => isSubset(x, y)));
  return excludes(aAny, bNone) || excludes(bAny, aNone);
}

/** True if `node` (a `when` tree) contains `not(isExempt)` anywhere reachable by the standard walk (allOf/anyOf/not/among). */
function containsNotExemptGuard(node) {
  let found = false;
  walkTree(node ?? null, (opName, opArgs) => {
    if (found) return;
    if (opName === 'not') {
      const child = normalizeNode(opArgs && opArgs.child);
      if (child !== null && child.op === 'isExempt') found = true;
    }
  });
  return found;
}

/** Computed once from the band-1000 exempt-set rules' own (decidable) `siIn` scopes — see (c) above. Never hand-maintained. */
function computeAlwaysExemptSiSet(ruleEntries) {
  const out = new Set();
  for (const { rule } of ruleEntries) {
    if (rule.band !== 1000 || !Array.isArray(rule.then)) continue;
    const exempts = rule.then.some((e) => {
      const n = normalizeNode(e);
      return n !== null && n.op === 'exempt';
    });
    if (!exempts) continue;
    const domain = extractSiDomain(rule.scope);
    if (domain.kind === 'si') for (const si of domain.values) out.add(si);
  }
  return out;
}

function domainWhollyWithin(domain, siSet) {
  return domain.kind === 'si' && domain.values.size > 0 && [...domain.values].every((si) => siSet.has(si));
}

/**
 * The combined "these two writers are provably safe together" test used by
 * both the same-window and cross-window/cross-band branches below. `a`/`b`
 * carry `{domain, whenNode}` at minimum. Order-independent — both (b) and
 * (c) are symmetric disjointness arguments, unlike the not-BUNDLED ordering
 * guard (which only protects a LATER rule from an EARLIER one, and is
 * checked separately by callers via `hasNotBundledGuardAnywhere`).
 */
function provablyDisjointPair(a, b, alwaysExemptSiSet) {
  if (mutuallyExclusiveByClaimCensus(a.whenNode, b.whenNode)) return true;
  if (containsNotExemptGuard(a.whenNode) && domainWhollyWithin(b.domain, alwaysExemptSiSet)) return true;
  if (containsNotExemptGuard(b.whenNode) && domainWhollyWithin(a.domain, alwaysExemptSiSet)) return true;
  return false;
}

/**
 * Domain-extraction over a scope/among predicate tree. `{kind:'all'}` =
 * matches any line; `{kind:'si', values:Set}` = matches exactly those SI
 * values; `{kind:'unresolved'}` = cannot be determined statically (contains
 * a D45-disallowed predicate, or a code/apc/schedule predicate this tool
 * does not resolve against loaded data). A `not(statusIn(['BUNDLED']))`
 * guard is treated as neutral (`{kind:'all'}`) for domain purposes — it
 * restricts on *status*, not SI, and is checked separately by
 * `containsNotBundledGuard`.
 */
function extractSiDomain(node) {
  const n = normalizeNode(node);
  if (n === null) return { kind: 'unresolved' };
  switch (n.op) {
    case 'always':
    case 'claimAlways':
      return { kind: 'all' };
    case 'siIn':
      return { kind: 'si', values: new Set(Array.isArray(n.args?.si) ? n.args.si : []) };
    case 'siIs':
      return { kind: 'si', values: new Set(typeof n.args?.si === 'string' ? [n.args.si] : []) };
    case 'not':
      return isBundledStatusGuard(n.args && n.args.child) ? { kind: 'all' } : { kind: 'unresolved' };
    case 'allOf': {
      const subs = (Array.isArray(n.args?.children) ? n.args.children : []).map(extractSiDomain);
      if (subs.some((s) => s.kind === 'unresolved')) return { kind: 'unresolved' };
      let result = { kind: 'all' };
      for (const s of subs) {
        if (s.kind === 'all') continue;
        result = result.kind === 'all' ? s : { kind: 'si', values: new Set([...result.values].filter((v) => s.values.has(v))) };
      }
      return result;
    }
    case 'anyOf': {
      const subs = (Array.isArray(n.args?.children) ? n.args.children : []).map(extractSiDomain);
      if (subs.some((s) => s.kind === 'unresolved')) return { kind: 'unresolved' };
      if (subs.some((s) => s.kind === 'all')) return { kind: 'all' };
      const values = new Set();
      for (const s of subs) for (const v of s.values) values.add(v);
      return { kind: 'si', values };
    }
    default:
      return { kind: 'unresolved' };
  }
}

/** `null` = "cannot tell" (at least one side unresolved); otherwise a boolean. */
function domainsOverlap(a, b) {
  if (a.kind === 'unresolved' || b.kind === 'unresolved') return null;
  if (a.kind === 'all' || b.kind === 'all') return true;
  for (const v of a.values) if (b.values.has(v)) return true;
  return false;
}

function isRankGated(whenNode) {
  let found = false;
  walkTree(whenNode ?? null, (opName) => {
    if (RANK_SELECTOR_OPS.has(opName)) found = true;
  });
  return found;
}

// ===========================================================================
// D45 — scope must be statically decidable from a code alone (§4.3, D45).
// A RATCHET, not a hard gate: the shipped registry has known violations
// (measured at 21 against this checkout — see final report). Fails the
// build only if the count grows.
// ===========================================================================

const D45_DISALLOWED_IN_SCOPE = new Set([
  'statusIn',
  'isExempt',
  'isHighestBy',
  'isNotHighestBy',
  'ordinalIs',
  'ordinalAtLeast',
  // "any claim-scope operator" (§4.3's claim-scope-selector list):
  'claimAlways',
  'claimContainsAny',
  'claimContainsNone',
  'claimContainsCode',
  'claimUnitsAtLeast',
  'claimLineCountAtLeast',
  'optionIs',
  'optionAtLeast',
  'optionUnknown',
]);

/**
 * All 21 known D45 violations were migrated (docs/BUILD_LOG.md D45): every
 * claim-relational predicate (`statusIn`, `isExempt`, `isHighestBy`) that
 * lived in a rule's `scope` moved into `when`, and every rule whose `scope`
 * would otherwise have gone empty was given the statically-decidable
 * selector its own domain actually is (`siIn` for 19 of them; `always` for
 * `OPPS.PKG.J1.CONTROL`/`OPPS.CAPC8011.CONTROL`, whose real domain — every
 * non-exempt line, regardless of SI — is not SI-derivable, per §4.3's own
 * "enumerating every SI except the exempt ones is not a workaround"). The
 * migration's behaviour-neutrality was verified empirically, not assumed:
 * see tools/diff-d45-migration.mjs and test/fix-d45-applicability.test.ts
 * — 0 outcome differences (status/disposition/bundledUnder/basis/
 * effectiveSI/flags) across a 71-claim corpus. The baseline is now the true
 * count. Bump it only when the maintainer deliberately introduces a new,
 * reviewed violation (there should be none); never bump it to silence one.
 */
export const D45_BASELINE = 0;

/**
 * DEBT BASELINE, NOT AN APPROVAL. `D66_BUNDLE_UNDER_MISSING_GUARD` flags a
 * `bundleUnder` whose "among" cannot exclude already-bundled lines when an
 * earlier-window bundler exists. The two rules it currently flags
 * (`OPPS.PKG.Q1.COMPANION`, `OPPS.PKG.Q2.COMPANION`) were hand-traced and
 * are believed unreachable today — `OPPS.PKG.J1.CONTROL`/
 * `OPPS.CAPC8011.CONTROL`'s own scope always also bundles the Q1/Q2 subject
 * line itself first, since Q1/Q2 is never exempt — but that safety is an
 * accident of those two controller rules' current shape, not a guarantee
 * OPPS.PKG.Q1.COMPANION/OPPS.PKG.Q2.COMPANION's own definition carries. This
 * is ratcheted rather than hard-failed specifically so nobody is pressured
 * into bolting a guard onto two currently-working rules on a
 * defence-in-depth argument alone — D66's own lesson is that getting the
 * EPOCH right matters as much as the guard, and that is exactly the risk of
 * a rushed fix here. A NEW unguarded `bundleUnder` still hard-fails the
 * moment it pushes the count past 2.
 */
export const D66_GUARD_BASELINE = 2;

/**
 * The rule-level gates — pure, given `operators` (dsl/operators.ts's real
 * closed set), `isKnownFlagCode` (src/flags.ts's real manifest check), and
 * `rankFieldNullability` (§15.3: "nullable in the data," not in the type —
 * see `checkRankingFallback` below). `ruleEntries` is an array of
 * `{rule, sourceFile}` (`sourceFile` is only used for duplicate-id messages
 * and may be any label, e.g. "synthetic").
 *
 * Returns `{violations, info, d45, d66Guard}` — never throws for a bad RULE
 * (a malformed node just fails its own gate); a malformed `ruleEntries`
 * shape (not an array) throws, since that is this function's own contract,
 * not a registry-authoring question.
 */
export function lintRules(
  ruleEntries,
  { operators, isKnownFlagCode, rankFieldNullability, d45Baseline = D45_BASELINE, d66GuardBaseline = D66_GUARD_BASELINE } = {},
) {
  if (!Array.isArray(ruleEntries)) throw new Error('lintRules: ruleEntries must be an array of {rule, sourceFile}');
  if (typeof operators !== 'object' || operators === null) throw new Error('lintRules: operators is required (pass dsl/operators.ts\'s `operators` export)');
  if (typeof isKnownFlagCode !== 'function') throw new Error('lintRules: isKnownFlagCode is required (pass src/flags.ts\'s export)');
  if (typeof rankFieldNullability !== 'object' || rankFieldNullability === null || typeof rankFieldNullability.isNullableInData !== 'function') {
    throw new Error('lintRules: rankFieldNullability is required — an object with isNullableInData(field, siValues|null): boolean, measured against the real loaded data (§15.3).');
  }

  const violations = [];
  const info = [];

  function report(gate, section, ruleId, message) {
    violations.push({ gate, section, ruleId, message });
  }

  // --- RANKING_FIELD_NO_FALLBACK (§4.3, §15.3) — DATA-driven, not TYPE- ---
  // driven. §15.3's own wording is "omits fallbackField where the field is
  // nullable IN THE DATA," not "in the type." rateMils/weight are typed
  // `number | null` (LineFacts), which is necessary but not sufficient —
  // the hard-fail question is whether any row the rule could actually rank
  // over (its "among"'s SI domain, or the whole dataset when that domain
  // isn't statically resolvable — see `extractSiDomain`) carries a null
  // for that field TODAY. `rankFieldNullability.isNullableInData(field,
  // siValues)` answers exactly that, backed by the real loaded data
  // (src/data/opps.cy2026.ts) in the CLI, or a synthetic stand-in in tests.
  //
  // When the type permits null but the data currently has none for the
  // relevant domain, that is real, worth knowing, and NOT what §15.3 asks
  // this gate to fail the build on — recorded as one aggregated
  // informational note (not a per-occurrence violation) so it doesn't
  // silently vanish, matching this file's own "declare a gap loudly, don't
  // let it disappear" discipline elsewhere (§9.5/D40).
  let typeNullableDataCleanCount = 0;
  const typeNullableDataCleanFields = new Set();

  function checkRankingFallback(rule, position, opName, field, amongNode, fallbackField) {
    if (!TYPE_NULLABLE_RANK_FIELDS.has(field)) return; // chargeMils/unitCount: never null by type — nothing to ask the data about.
    const domain = extractSiDomain(amongNode);
    const siValues = domain.kind === 'si' ? [...domain.values] : null; // null = domain not statically resolvable -> ask about the whole dataset, conservatively.
    const nullableInData = rankFieldNullability.isNullableInData(field, siValues);
    if (nullableInData) {
      if (fallbackField === undefined) {
        report(
          'RANKING_FIELD_NO_FALLBACK',
          '§15.3 / §4.3',
          rule.id,
          `${position}: ${opName} ranks by "${field}", which IS nullable in the currently loaded data${siValues !== null ? ` for SI [${siValues.join(', ')}]` : ' (domain not statically resolvable — checked against the whole dataset)'}, with no fallbackField declared.`,
        );
      }
    } else if (fallbackField === undefined) {
      typeNullableDataCleanCount++;
      typeNullableDataCleanFields.add(field);
    }
  }

  // --- UNKNOWN_OPERATOR / MISSING_DESCRIBE_ARGSPEC / ARGSPEC_VOCAB / -------
  // RANKING_FIELD_NO_FALLBACK / CLAIM_AMOUNT_EFFECT_IN_LINE_SCOPE /
  // UNKNOWN_FLAG_CODE — one walk of every node in scope/when/then, calling
  // the REAL operators.ts entry so this can never drift from the
  // interpreter's own closed set the way the old §4.3.1 table drifted from
  // operators.ts (D64).
  function checkOperatorTree(rule, position, node) {
    walkTree(node, (opName, opArgs) => {
      const op = operators[opName];
      if (op === undefined) {
        report('UNKNOWN_OPERATOR', '§4.3', rule.id, `${position}: operator "${opName}" is not in the closed set (dsl/operators.ts).`);
        return;
      }
      if (typeof op.describe !== 'function' || typeof op.argSpec !== 'function') {
        report('MISSING_DESCRIBE_ARGSPEC', '§4.4', rule.id, `${position}: operator "${opName}" is missing describe() or argSpec().`);
        return;
      }
      let spec;
      try {
        spec = op.argSpec(opArgs);
      } catch {
        return; // malformed payload is REGISTRY_SCHEMA_INVALID's job (dsl/validate.ts), not this gate's.
      }
      if (!ARG_SPEC_KINDS.has(spec.kind)) {
        report('ARGSPEC_VOCAB', '§4.4', rule.id, `${position}: operator "${opName}" argSpec().kind "${spec.kind}" is outside the §4.4 vocabulary.`);
      }
      if (spec.dimension !== undefined && !ARG_SPEC_DIMENSIONS.has(spec.dimension)) {
        report('ARGSPEC_VOCAB', '§4.4', rule.id, `${position}: operator "${opName}" argSpec().dimension "${spec.dimension}" is outside the §4.4 vocabulary.`);
      }

      // Ranking selector field vocabulary + nullable-field-needs-fallback
      // (§4.3: "A ranking selector with no fallback that encounters a null
      // field is a hard error, never a silent skip"; §15.3: "...or that
      // omits fallbackField where the field is nullable IN THE DATA"). See
      // `checkRankingFallback` below — this is a data-driven check, not a
      // type-driven one. `field` is already validated to be one of the
      // four RANK_FIELDS by operators.ts's own argSpec() (it would have
      // thrown above and been skipped otherwise), so this only needs the
      // nullability half.
      if (RANK_SELECTOR_OPS.has(opName) && opArgs && typeof opArgs === 'object') {
        checkRankingFallback(rule, position, opName, opArgs.field, opArgs.among, opArgs.fallbackField);
      }
      if (opName === 'bundleUnder' && opArgs && typeof opArgs === 'object') {
        checkRankingFallback(rule, position, 'bundleUnder', opArgs.highestBy, opArgs.among, opArgs.fallbackField);
      }

      // Forward-compatible claim-amount-effect-in-line-scope half of the
      // "line-targeted effects in a claim-scoped rule, or claim-level
      // amount effects in a line-scoped rule" gate (§15.3). setAmount does
      // not exist in the milestone-1 closed set (D65) so this branch can
      // never fire today — UNKNOWN_OPERATOR already catches any attempt to
      // author it — but the check is wired up for the day it is added.
      if (opName === 'setAmount' && rule.scopeTarget === 'line' && opArgs && typeof opArgs === 'object') {
        if (CLAIM_AMOUNT_TARGETS.has(opArgs.target)) {
          report('CLAIM_AMOUNT_EFFECT_IN_LINE_SCOPE', '§4.2', rule.id, `${position}: setAmount targets claim-level "${opArgs.target}" from a line-scoped rule.`);
        }
      }

      if (opName === 'flag' && opArgs && typeof opArgs === 'object' && typeof opArgs.code === 'string') {
        if (!isKnownFlagCode(opArgs.code)) {
          report('UNKNOWN_FLAG_CODE', '§12.7', rule.id, `${position}: flag code "${opArgs.code}" is not registered in the flag manifest (src/flags.ts).`);
        }
      }
    });
  }

  // --- MISSING_CITATION / MISSING_SCOPE_TARGET / EPOCH_TOO_LATE / ----------
  // UNIMPLEMENTED_WITHOUT_DATA_REQUIRED / LINE_EFFECT_IN_CLAIM_SCOPE
  function checkPerRuleGates(rule, sourceFile) {
    if (typeof rule.citation !== 'string' || rule.citation.trim() === '') {
      report('MISSING_CITATION', '§15.3', rule.id ?? `${sourceFile}[unknown]`, 'missing or empty citation.');
    }
    if (rule.scopeTarget !== 'line' && rule.scopeTarget !== 'claim') {
      report('MISSING_SCOPE_TARGET', '§15.3 / §4.2', rule.id ?? `${sourceFile}[unknown]`, `scopeTarget must be "line" or "claim", got ${JSON.stringify(rule.scopeTarget)}.`);
    }

    const window = windowFor(rule);
    if (epochRank(rule.epoch) > epochRank(window.ceilingEpoch)) {
      report(
        'EPOCH_TOO_LATE',
        '§2.5',
        rule.id,
        `declares epoch "${rule.epoch}", but band ${rule.band}${rule.subBand !== undefined ? ` sub-band ${rule.subBand}` : ''} may read at most "${window.ceilingEpoch}" — a rule may not read an epoch at or after its own position.`,
      );
    }

    const whenNode = rule.when === undefined ? null : normalizeNode(rule.when);
    if (whenNode !== null && whenNode.op === 'unimplemented' && rule.dataRequired !== true) {
      report('UNIMPLEMENTED_WITHOUT_DATA_REQUIRED', '§4.3 / §9.5', rule.id, '"when" is unimplemented but dataRequired is not true.');
    }

    if (rule.scopeTarget === 'claim' && Array.isArray(rule.then)) {
      for (let i = 0; i < rule.then.length; i++) {
        const n = normalizeNode(rule.then[i]);
        if (n !== null && n.op !== 'flag') {
          report('LINE_EFFECT_IN_CLAIM_SCOPE', '§4.2', rule.id, `then[${i}]: claim-scoped rule writes line effect "${n.op}" — a claim-scoped rule may write only a claim-replicated flag.`);
        }
      }
    }
  }

  function checkDuplicateIds() {
    const seen = new Map();
    ruleEntries.forEach(({ rule, sourceFile }, i) => {
      if (typeof rule.id !== 'string') return;
      if (seen.has(rule.id)) {
        report('DUPLICATE_ID', '§4.2', rule.id, `duplicate rule id — first seen in ${seen.get(rule.id)}, this one in ${sourceFile ?? '(unlabeled)'} (registry index ${i}).`);
      } else {
        seen.set(rule.id, sourceFile ?? '(unlabeled)');
      }
    });
  }

  function checkDuplicateOrder() {
    const byPhase = new Map();
    for (const { rule } of ruleEntries) {
      if (typeof rule.phase !== 'string' || typeof rule.order !== 'number') continue;
      const key = rule.phase;
      if (!byPhase.has(key)) byPhase.set(key, new Map());
      const orders = byPhase.get(key);
      if (orders.has(rule.order)) {
        report('DUPLICATE_ORDER_IN_PHASE', '§15.3', rule.id, `order ${rule.order} in phase ${rule.phase} collides with rule "${orders.get(rule.order)}".`);
      } else {
        orders.set(rule.order, rule.id);
      }
    }
  }

  function findD45Violations() {
    /** @type {{ruleId:string, ops:string[]}[]} */
    const offenders = [];
    for (const { rule } of ruleEntries) {
      // Claim-scope selectors (claimAlways, claimContainsAny, ...) are the
      // CORRECT, spec-required contents of `scope` for a claim-scoped rule
      // (§4.3: "Claim-scope selectors (valid only when scopeTarget is
      // 'claim')") — D45's "applicability mode" rationale is specifically
      // about answering "given a code alone, is this rule reachable,"
      // which only applies to line-scoped rules. A claim-scoped rule has
      // no per-code applicability question in the same sense, so it is
      // excluded from this ratchet entirely rather than flagged for using
      // exactly the operator category the spec assigns it.
      if (rule.scopeTarget === 'claim') continue;
      const found = new Set();
      walkTree(rule.scope, (opName) => {
        if (D45_DISALLOWED_IN_SCOPE.has(opName)) found.add(opName);
      });
      if (found.size > 0) offenders.push({ ruleId: rule.id, ops: [...found] });
    }
    return offenders;
  }

  // --- structural-effect conflict analysis: the STATIC half of "a
  // cross-band setStatus write, or a second write of bundleUnder/
  // convertSI/route/setBasis" (§4.3), plus D66's "among must exclude
  // statusIn(['BUNDLED']), at an epoch late enough to see it." A rule's
  // structural domain is only computable when its predicate tree is
  // itself statically decidable (D45) — such rules are excluded from the
  // pairwise checks and counted, not silently dropped.
  function structuralConflictGates() {
    const alwaysExemptSiSet = computeAlwaysExemptSiSet(ruleEntries);
    /** @type {{ruleId:string, band:number, subBand:string|undefined, op:string, domain:object, hasNotBundledScopeGuard:boolean, whenNode:unknown, amongNode:unknown|null, windowRank:number}[]} */
    const writers = [];
    const statusWriters = [];
    for (const { rule } of ruleEntries) {
      if (!Array.isArray(rule.then)) continue;
      const domain = extractSiDomain(rule.scope);
      // D45 follow-on: the not-BUNDLED guard's only legal home post-migration
      // is `when` (or `scope`, if some future rule still needs it there) —
      // see `hasNotBundledGuardAnywhere`'s header for why checking `scope`
      // alone here would be exactly the D63 mistake.
      const hasNotBundledScopeGuard = hasNotBundledGuardAnywhere(rule);
      const window = windowFor(rule);
      for (const entry of rule.then) {
        const n = normalizeNode(entry);
        if (n === null) continue;
        if (STRUCTURAL_EFFECTS.has(n.op)) {
          const amongNode = n.op === 'bundleUnder' ? n.args?.among ?? null : null;
          const amongDomain = amongNode === null ? { kind: 'unresolved' } : extractSiDomain(amongNode);
          writers.push({ ruleId: rule.id, band: rule.band, subBand: rule.subBand, op: n.op, domain, amongDomain, hasNotBundledScopeGuard, whenNode: rule.when, amongNode, windowRank: window.rank });
        }
        if (n.op === 'setStatus') {
          statusWriters.push({ ruleId: rule.id, band: rule.band, domain, hasNotBundledScopeGuard, whenNode: rule.when, windowRank: window.rank });
        }
      }
    }

    // --- second write of bundleUnder/convertSI/route/setBasis (§4.3) -----
    // A pair across DIFFERENT windows with overlapping domain is safe, not
    // a violation, when the LATER-window rule's own `scope` carries the
    // `not(statusIn(['BUNDLED']))` guard: band ordering means the earlier
    // rule's write (if any) is already reflected in the frozen epoch the
    // later rule's scope reads, so the guard structurally prevents the
    // later rule from ever re-firing on a line the earlier one already
    // claimed — exactly the mechanism OPPS.PKG.Q1.COMPANION /
    // OPPS.DISP.Q1Q2.SURVIVOR rely on. Two writers in the SAME window
    // share one frozen epoch, so no guard can protect either from the
    // other (see D66's same-window logic below) — those pairs are always
    // checked at face value.
    let secondWriteSkipped = 0;
    let secondWriteChecked = 0;
    for (const effect of STRUCTURAL_EFFECTS) {
      const group = writers.filter((w) => w.op === effect);
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          const overlap = domainsOverlap(a.domain, b.domain);
          if (overlap === null) {
            secondWriteSkipped++;
            continue;
          }
          secondWriteChecked++;
          if (!overlap) continue;
          if (provablyDisjointPair(a, b, alwaysExemptSiSet)) continue; // (b)/(c) — never both act on the same claim/line regardless of window or guard.
          if (a.windowRank !== b.windowRank) {
            const later = a.windowRank > b.windowRank ? a : b;
            const earlier = later === a ? b : a;
            if (later.hasNotBundledScopeGuard) continue; // guarded against the earlier writer — safe.
            report(
              'SECOND_WRITE_STRUCTURAL_EFFECT',
              '§4.3',
              later.ruleId,
              `writes "${effect}" with a scope domain overlapping earlier-window rule "${earlier.ruleId}" (also "${effect}") and no not(statusIn(['BUNDLED'])) guard (scope or when) — first-writer-wins; a second write is an error.`,
            );
          } else {
            report(
              'SECOND_WRITE_STRUCTURAL_EFFECT',
              '§4.3',
              a.ruleId,
              `writes "${effect}" in the same window as rule "${b.ruleId}" (also "${effect}") with an overlapping scope domain — same-window writes share one frozen epoch, so no ordering guard can protect them, and neither rule's "when" proves the two mutually exclusive; a second write is an error.`,
            );
          }
        }
      }
    }
    info.push(
      `SECOND_WRITE_STRUCTURAL_EFFECT (§4.3): ${secondWriteChecked} decidable rule-pair(s) checked, ${secondWriteSkipped} skipped (scope not statically decidable — see D45).`,
    );

    // --- cross-band setStatus overwrite (§4.3) ----------------------------
    // Same guard-safety reasoning as above, across bands rather than
    // windows (setStatus's own conflict rule is stated per-band).
    let crossBandSkipped = 0;
    let crossBandChecked = 0;
    for (let i = 0; i < statusWriters.length; i++) {
      for (let j = i + 1; j < statusWriters.length; j++) {
        const a = statusWriters[i];
        const b = statusWriters[j];
        if (a.band === b.band) continue; // same-band is last-writer-wins, not an error (§4.3).
        const overlap = domainsOverlap(a.domain, b.domain);
        if (overlap === null) {
          crossBandSkipped++;
          continue;
        }
        crossBandChecked++;
        if (!overlap) continue;
        if (provablyDisjointPair(a, b, alwaysExemptSiSet)) continue; // (b)/(c) — never both act on the same claim/line regardless of band order.
        const later = a.band > b.band ? a : b;
        const earlier = later === a ? b : a;
        if (later.hasNotBundledScopeGuard) continue; // guarded against the earlier band's writer — safe.
        report(
          'CROSS_BAND_SETSTATUS',
          '§4.3',
          later.ruleId,
          `writes setStatus in band ${later.band} with a scope domain overlapping earlier band ${earlier.band} rule "${earlier.ruleId}" and no not(statusIn(['BUNDLED'])) guard (scope or when) — a cross-band setStatus overwrite is an error.`,
        );
      }
    }
    info.push(`CROSS_BAND_SETSTATUS (§4.3): ${crossBandChecked} decidable rule-pair(s) checked, ${crossBandSkipped} skipped (scope not statically decidable — see D45).`);

    // --- D66: bundleUnder among must exclude already-bundled lines, AND ---
    // at an epoch late enough to actually observe earlier-band bundling.
    //
    // This is deliberately conservative — "an earlier-window bundleUnder
    // writer exists at all," not "an earlier-window writer can leave an
    // among-member bundled while this rule's own subject stays unbundled."
    // The narrower question is NOT automated here: a controller rule's own
    // scope (e.g. "every non-exempt line except the ranked controller")
    // can itself be D45-undecidable, so this tool cannot always prove
    // whether its domain covers a given later rule's subject domain. See
    // final report for a worked example of this exact nuance.
    const bundleWriters = writers.filter((w) => w.op === 'bundleUnder');
    for (const w of bundleWriters) {
      const earlierExists = bundleWriters.some((o) => o !== w && o.windowRank < w.windowRank);
      if (!earlierExists) continue; // nothing could already be bundled yet (matches J1.CONTROL/CAPC8011.CONTROL's documented no-guard state).
      if (!containsNotBundledGuard(w.amongNode)) {
        report(
          'D66_BUNDLE_UNDER_MISSING_GUARD',
          'D66',
          w.ruleId,
          'bundleUnder\'s "among" does not exclude already-BUNDLED lines, and an earlier-window bundleUnder writer exists — its ranking pool can select a line another rule has already bundled.',
        );
      }
    }
    // Same-window peers where THIS rule's "among" ranking pool overlaps a
    // PEER's own subject-scope domain, and the peer's bundling is NOT
    // rank-gated (isHighestBy/isNotHighestBy/ordinalIs/ordinalAtLeast in
    // its `when`), reproduce exactly D66's bug shape: the peer bundles its
    // subject unconditionally, this rule's "among" can rank over that same
    // subject as a controller candidate, and this rule's own guard cannot
    // see the peer's write regardless of guard presence (both read the
    // same epoch, frozen before either subBand's rules ran) — comparing
    // AMONG (the ranking pool) against the peer's SUBJECT domain is the
    // point: comparing two rules' subject domains against each other (an
    // earlier, incorrect version of this check) misses the original bug
    // entirely, since OPPS.PKG.Q4.COMPANION's own subject (Q4) never
    // overlapped OPPS.PKG.Q1.COMPANION's subject (Q1) — only Q4.COMPANION's
    // "among" pool did. A rank-gated peer over a domain that is a subset of
    // this rule's "among" is provably safe (its chosen controller, if it
    // lands in the peer's smaller domain, is necessarily also the peer's
    // own local maximum, so the peer — which only touches non-maximum
    // members — can never touch it); this heuristic trusts that shape
    // without re-proving the subset relation, a known limitation — see
    // final report.
    for (const w of bundleWriters) {
      for (const peer of bundleWriters) {
        if (peer === w) continue;
        if (peer.band !== w.band || peer.subBand !== w.subBand) continue; // only same-window peers share a frozen epoch.
        const overlap = domainsOverlap(w.amongDomain, peer.domain);
        if (overlap !== true) continue;
        if (isRankGated(peer.whenNode)) continue; // documented escape hatch — see comment above.
        report(
          'D66_BUNDLE_UNDER_STALE_EPOCH',
          'D66',
          w.ruleId,
          `shares a window (band ${w.band}${w.subBand !== undefined ? ` sub-band ${w.subBand}` : ''}) with peer "${peer.ruleId}", whose unconditional-bundling scope overlaps this rule's "among" — the guard cannot see a same-window peer's write regardless of epoch; move one rule to a later sub-band/band.`,
        );
      }
    }
  }

  for (const { rule, sourceFile } of ruleEntries) {
    checkPerRuleGates(rule, sourceFile);
    for (const { position, node } of ruleTopLevelNodes(rule)) checkOperatorTree(rule, position, node);
  }
  checkDuplicateIds();
  checkDuplicateOrder();
  structuralConflictGates();

  if (typeNullableDataCleanCount > 0) {
    info.push(
      `RANKING_FIELD_NO_FALLBACK (§15.3): ${typeNullableDataCleanCount} ranking selector(s) rank by a type-nullable field (${[...typeNullableDataCleanFields].join(', ')}: LineFacts types it as \`number | null\`) with no fallbackField, but the currently loaded data has zero nulls for the relevant domain — informational, not a hard failure (§15.3 requires nullable IN THE DATA, not in the type). dsl/evaluate.ts still hard-errors if a null ever appears for these fields on a ranked line, so this remains a genuine latent gap worth tracking, just not the one this gate fails the build on.`,
    );
  }

  const d45Offenders = findD45Violations();
  const d45Count = d45Offenders.length;
  const d45Exceeded = d45Count > d45Baseline;
  for (const o of d45Offenders) {
    violations.push({
      gate: 'D45_SCOPE_NOT_DECIDABLE',
      section: '§4.3 / D45',
      ruleId: o.ruleId,
      message: `scope contains claim-relational predicate(s) [${o.ops.join(', ')}] — not statically decidable from a code alone.`,
    });
  }

  const d66GuardViolations = violations.filter((v) => v.gate === 'D66_BUNDLE_UNDER_MISSING_GUARD');
  const d66GuardCount = d66GuardViolations.length;
  const d66GuardExceeded = d66GuardCount > d66GuardBaseline;

  return {
    violations,
    info,
    d45: { count: d45Count, baseline: d45Baseline, exceeded: d45Exceeded, offenders: d45Offenders },
    d66Guard: {
      count: d66GuardCount,
      baseline: d66GuardBaseline,
      exceeded: d66GuardExceeded,
      ruleIds: d66GuardViolations.map((v) => v.ruleId),
      reasons: d66GuardViolations.map((v) => ({ ruleId: v.ruleId, message: v.message })),
    },
  };
}

/** Gates whose violations are *reported* but do not by themselves fail the build (D45's and D66's own ratchets handle pass/fail via `d45.exceeded`/`d66Guard.exceeded`). */
export const RATCHET_GATES = new Set(['D45_SCOPE_NOT_DECIDABLE', 'D66_BUNDLE_UNDER_MISSING_GUARD']);

// ===========================================================================
// D66, dynamic half — reuses test/fix-q4-companion-crash.test.ts's own
// combinatorial sweep mechanism ("moving it to load time is the point," per
// this unit's brief) so the lint exercises the REAL interpreter rather than
// re-deriving its conflict-resolution logic a second time. Representative
// codes are the same ones that test drew from src/data/opps.cy2026.ts —
// duplicated here (not imported: the test file doesn't export the table)
// and cross-referenced so the two can be kept in sync by inspection.
// CLI-only: needs the real `adjudicate()`.
// ===========================================================================

const SI_REPRESENTATIVE_CODES = {
  T: '0101T',
  S: '0263T',
  V: '0811T',
  J1: '0071T',
  J2: '99281',
  Q1: 'G0516',
  Q2: '0412T',
  Q3: '0362T',
  Q4: '0002M',
};

function combinations(items, size) {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const [head, ...rest] = items;
  if (head === undefined) return [];
  return [...combinations(rest, size - 1).map((c) => [head, ...c]), ...combinations(rest, size)];
}

function claimLine(lineId, procCode) {
  return { lineId, procCode, modifiers: [], revCode: '0300', units: '1', unitQualifier: 'UN', chargeMils: 100000, fromDate: '20260115', thruDate: '20260115' };
}

function claimFromCodes(codes) {
  return {
    claimId: 'LINT-SWEEP',
    claimForm: 'ub04',
    typeOfBill: '131',
    statementFrom: '20260115',
    statementThrough: '20260115',
    conditionCodes: [],
    occurrenceCodes: [],
    valueCodes: [],
    billingTaxonomy: '282N00000X',
    payer: { id: '1', name: 'LINT' },
    diagnoses: [],
    lines: codes.map((code, i) => claimLine(`L${i + 1}`, code)),
    totalChargeMils: codes.length * 100000,
    lineIdScheme: 'positional',
  };
}

function classifyRuntimeFault(message) {
  if (/already bundled|no member of "among"|resolved as its own bundling target/.test(message)) return 'D66_BUNDLE_UNDER_STALE_EPOCH';
  if (/cross-band overwrite/.test(message)) return 'CROSS_BAND_SETSTATUS';
  if (/second write on line/.test(message)) return 'SECOND_WRITE_STRUCTURAL_EFFECT';
  return 'ENGINE_FAULT_ON_SWEEP';
}

function runDynamicSweep(adjudicate, report, info) {
  const sis = Object.keys(SI_REPRESENTATIVE_CODES);
  const combos = [2, 3, 4].flatMap((size) => combinations(sis, size));
  combos.push(sis); // all nine at once — the richest single interaction test.
  let checked = 0;
  const seenMessages = new Set();
  for (const combo of combos) {
    checked++;
    const codes = combo.map((si) => SI_REPRESENTATIVE_CODES[si]);
    let result;
    try {
      result = adjudicate({ claim: claimFromCodes(codes) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const key = `throw:${message}`;
      if (!seenMessages.has(key)) {
        seenMessages.add(key);
        report(classifyRuntimeFault(message), 'D66 / §4.3', `[SI combo ${combo.join(',')}]`, `adjudicate() threw: ${message}`);
      }
      continue;
    }
    for (const d of result.determinations) {
      const errored = d.trace.find((ev) => ev.outcome === 'ERRORED');
      if (errored !== undefined) {
        const detail = errored.examined && typeof errored.examined === 'object' ? JSON.stringify(errored.examined) : '';
        const key = `errored:${errored.ruleId}:${detail}`;
        if (!seenMessages.has(key)) {
          seenMessages.add(key);
          report(
            classifyRuntimeFault(detail),
            'D66 / §4.3',
            `[SI combo ${combo.join(',')}]`,
            `line ${d.lineId} recorded outcome ERRORED for rule "${errored.ruleId}" (${detail || 'no detail'}).`,
          );
        }
      }
    }
  }
  info.push(`D66 dynamic sweep: ${checked} synthetic claim(s) run (representative codes per SI x combination sizes 2/3/4 + all-9), 0 or more runtime faults reported above.`);
}

// ===========================================================================
// Gates that cannot be finished against what exists on disk — declared
// loudly (per §9.5 / D40's principle: a deferred check must announce
// itself, never silently pass because it checks nothing). CLI-only: needs
// real filesystem paths.
// ===========================================================================

function deferredGates(deferGate, report) {
  const fixtureDir = path.join(ROOT, 'test', 'fixtures');
  const fixtureFiles = existsSync(fixtureDir) ? readdirSync(fixtureDir) : [];
  deferGate(
    'RULE_UNREACHABLE_BY_FIXTURE',
    '§15.3',
    `Cannot check — the structured claim-fixture corpus (§15.1) does not exist yet (U23). test/fixtures/ currently holds ${fixtureFiles.length} file(s) (${fixtureFiles.join(', ') || 'none'}), all XML adapter fixtures, not the code[xUnits]/modifiers/charge fixture set §15.1 describes. This unit's own dynamic sweep (D66, above) exercises the packaging registry against 9 SI values combinatorially, which is NOT the same as fixture-driven reachability and does not substitute for it.`,
  );

  deferGate(
    'DATA_REQUIRED_UNKNOWN_SET',
    '§15.3',
    `Cannot check as specified — this codebase's "dataRequired" field is typed boolean-only (dsl/validate.ts's RuleShape: "dataRequired: boolean | undefined"), not a string naming a data set the way §9.5's own illustration writes it ("dataRequired: 'ncci-ptp'"). There is no data-set name on disk to validate against. Parsing the intended data-set identifier out of each rule's free-text "note" field (the current convention — see NCCI.PTP.PAIR's note) would be exactly the unreliable-text-parsing failure mode D64 warns against; not implemented rather than shipped unreliable. See final report.`,
  );

  const contractsDir = path.join(ROOT, 'src', 'registry', 'contracts');
  if (!existsSync(contractsDir)) {
    deferGate(
      'FEE_SCHEDULE_NON_TIER1',
      '§11.3',
      `Cannot check — src/registry/contracts/ does not exist. Phase 4 (contract application) is not built (§11 is spec-only in this codebase; no contract JSON shape, no loader). Scanning logic below is wired for when it lands (checks any "feeSchedule" term's schedule name against the Tier 1 set {OPPS, CLFS}) but has nothing to run against today.`,
    );
  } else {
    const TIER_1 = new Set(['OPPS', 'CLFS']);
    const contractFiles = readdirSync(contractsDir).filter((f) => f.endsWith('.json'));
    for (const f of contractFiles) {
      let contract;
      try {
        contract = JSON.parse(readFileSync(path.join(contractsDir, f), 'utf8'));
      } catch {
        continue;
      }
      const terms = Array.isArray(contract?.terms) ? contract.terms : [];
      for (const term of terms) {
        if (!Array.isArray(term?.then)) continue;
        for (const entry of term.then) {
          const n = normalizeNode(entry);
          if (n !== null && n.op === 'feeSchedule' && n.args && !TIER_1.has(n.args.schedule)) {
            report('FEE_SCHEDULE_NON_TIER1', '§11.3', term.id ?? f, `feeSchedule names "${n.args.schedule}", not a Tier 1 schedule ({OPPS, CLFS}).`);
          }
        }
      }
    }
  }
}

// ===========================================================================
// D64 — the §4.3.1 operator argument table must match operators.ts.
// CLI-only: reads both files fresh from disk.
//
// operators.ts is the source of truth (per D64 itself: "the table is now
// derived from operators.ts rather than hand-transcribed"). Every operator
// routes its required argument keys through a small set of typed helpers
// (`requireString`, `requireNumber`, `requireStringArray`,
// `requirePredicateNode(Array)`, `requireRankField`) or, for `optionIs`'s
// `equals`, a direct `rec['equals']` access — always with the key as a
// string LITERAL, which makes a source-text scan reliable for THIS
// specific, narrow question ("what keys does this operator's code read as
// required?"), even though parsing the *spec's* free-text Argument column
// into an equivalent structured key set is not reliable (rows use prose —
// "a condition node", "an array of condition nodes" — not one uniform
// grammar). So the check runs in one direction only: every key operators.ts
// treats as required must appear (whole-word) in the operator's own §4.3.1
// table row. That is exactly the direction D64's actual incident needs —
// rev 11's table said `value`, the code required `equals`; a rule authored
// from the table validated at load and faulted at evaluation. A
// substring-containment check on the corrected wording ("equals") against
// the corrected table row correctly distinguishes the two.
//
// THREE operators route through a SHARED helper (`readRankSpec`,
// `readClaimMatchArgs`, `readClaimSumFilter`) rather than reading `rec`
// directly in their own describe()/argSpec() bodies, so a per-operator
// source-block scan alone would miss their keys entirely. Their key sets
// are hardcoded below, verified against operators.ts's current source (see
// each constant's comment) — a future edit to one of those three helpers
// that changes its keys would silently desync this table from the code,
// which is this gate's one known blind spot, called out here and in the
// final report rather than left undiscovered.
// ===========================================================================

const SHARED_HELPER_KEYS = {
  // readRankSpec(rec, op): field (requireRankField), among (rec['among']),
  // tiebreak (rec['tiebreak']), fallbackField (rec['fallbackField'], optional).
  readRankSpec: ['field', 'among'],
  // readClaimMatchArgs(rec, op): si/code, both optional (exactly one required) — optionalStringArray, so not asserted as "required."
  readClaimMatchArgs: [],
  // readClaimSumFilter(rec, op): code/si, both optional (exactly one required) — same as above.
  readClaimSumFilter: [],
};

/**
 * Each operator is `export const NAME: ConditionOperator|EffectOperator =
 * { ... };`, and every one of these object literals closes on its own
 * `\n};` line (verified against this file's current formatting). Cutting
 * at that closing brace — not at "start of the next operator" — matters:
 * several non-operator helper functions (`readRankSpec`,
 * `readClaimMatchArgs`, `readClaimSumFilter`, `describeRankSpec`, ...) live
 * BETWEEN two operator declarations in this file, and a
 * next-export-const-starts cut would sweep their `rec[...]`/`require*()`
 * calls into the PRECEDING operator's block by mistake (caught while
 * building this gate: it credited `dosBefore` with `field`/`among`/
 * `tiebreak`/`fallbackField`, which actually belong to `readRankSpec`,
 * sitting between `dosBefore` and `isHighestBy` in the file).
 */
function extractOperatorBlocks(sourceText) {
  const re = /export const (\w+): (ConditionOperator|EffectOperator) = \{/g;
  const blocks = {};
  let m;
  while ((m = re.exec(sourceText)) !== null) {
    const start = m.index;
    const closeIdx = sourceText.indexOf('\n};', start);
    const end = closeIdx === -1 ? sourceText.length : closeIdx + 3;
    blocks[m[1]] = sourceText.slice(start, end);
  }
  return blocks;
}

function extractRequiredKeys(blockText) {
  // Only `require*(rec, 'key', ...)` counts as REQUIRED for this gate —
  // `optional*(rec, 'key', ...)` is deliberately not asserted against the
  // spec table (see this function's caller's header comment).
  const requiredOnly = new Set();
  let m;
  const reqRe = /\brequire(?:String|Number|StringArray|RankField)\(rec,\s*'([a-zA-Z]+)'/g;
  while ((m = reqRe.exec(blockText)) !== null) requiredOnly.add(m[1]);

  const bracketRe = /rec\[\s*'([a-zA-Z]+)'\s*\]/g;
  while ((m = bracketRe.exec(blockText)) !== null) requiredOnly.add(m[1]);

  for (const helperName of Object.keys(SHARED_HELPER_KEYS)) {
    if (blockText.includes(`${helperName}(`)) {
      for (const k of SHARED_HELPER_KEYS[helperName]) requiredOnly.add(k);
    }
  }
  return requiredOnly;
}

function parseSpecArgTable(specText) {
  const headerIdx = specText.indexOf('#### 4.3.1 Operator signatures');
  if (headerIdx === -1) return null;
  const nextSectionIdx = specText.indexOf('\n### ', headerIdx);
  const section = specText.slice(headerIdx, nextSectionIdx === -1 ? undefined : nextSectionIdx);
  const rows = section.split('\n').filter((l) => l.trim().startsWith('|') && l.includes('|', l.indexOf('|') + 1));
  /** @type {Map<string,string>} operator name -> raw row text (argument column onward) */
  const table = new Map();
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    if (cells.length < 3) continue;
    const [, opCell, ...rest] = cells;
    if (!opCell.includes('`')) continue; // header/separator rows
    const argText = rest.join(' | ');
    const names = [...opCell.matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1]);
    for (const name of names) table.set(name, argText);
  }
  return table;
}

function checkD64(operators, report, info, deferGate) {
  const operatorsSrc = readFileSync(path.join(ROOT, 'src', 'dsl', 'operators.ts'), 'utf8');
  const specText = readFileSync(path.join(ROOT, 'docs', 'ref', 'opps-adjudicator-scope.md'), 'utf8');

  const blocks = extractOperatorBlocks(operatorsSrc);
  const specTable = parseSpecArgTable(specText);
  if (specTable === null) {
    deferGate('D64_SPEC_TABLE_MATCH', '§4.3.1', 'Could not locate the "#### 4.3.1 Operator signatures" heading in the spec — table comparison skipped rather than silently passing.');
    return;
  }

  const moneyBearingDeferred = new Set(['chargeAtLeast', 'claimMoneyAtLeast', 'claimDayCountAtLeast', 'setAmount', 'multiply', 'setCoinsurance', 'carveOut', 'exclusion', 'lesserOfCandidates']);
  // The table documents `not`/`allOf`/`anyOf` in PROSE ("a condition node",
  // "an array of condition nodes"), not as a `{key: type}` shape — that is
  // the spec's own deliberate choice for the three composite operators
  // (see §4.3.1's own row text), not drift. A substring-containment check
  // against a key name ("child"/"children") these rows intentionally
  // never spell out would flag every run for no actionable reason, exactly
  // the "check that fires on correct input" failure mode this unit was
  // warned against shipping — so the row-presence check still runs for
  // these three (catching a genuinely MISSING row), but their
  // required-key check is skipped.
  const proseOnlyRows = new Set(['not', 'allOf', 'anyOf']);

  let opsChecked = 0;
  let keysChecked = 0;
  for (const [opName, blockText] of Object.entries(blocks)) {
    if (operators[opName] === undefined) continue; // not a real registered operator (shouldn't happen, but defensive).
    opsChecked++;
    const rowText = specTable.get(opName);
    if (rowText === undefined) {
      if (moneyBearingDeferred.has(opName)) continue; // documented deferred, not a table row (D65).
      report('D64_SPEC_TABLE_MATCH', '§4.3.1', `operators.ts:${opName}`, `operator "${opName}" has no row in the spec's §4.3.1 argument table.`);
      continue;
    }
    if (proseOnlyRows.has(opName)) continue;
    const requiredKeys = extractRequiredKeys(blockText);
    for (const key of requiredKeys) {
      keysChecked++;
      const re = new RegExp(`\\b${key}\\b`);
      if (!re.test(rowText)) {
        report('D64_SPEC_TABLE_MATCH', '§4.3.1', `operators.ts:${opName}`, `operator "${opName}" requires argument key "${key}" (per its own require*() calls), but the spec's §4.3.1 row does not mention it: ${JSON.stringify(rowText)}`);
      }
    }
  }
  info.push(`D64_SPEC_TABLE_MATCH: ${opsChecked} operator(s) matched to a spec row (or a documented D65 deferral), ${keysChecked} required-key mention(s) checked.`);
}

// ===========================================================================
// REGISTRY_MIRROR_STALE — src/registry/index.ts (generated) must match
// src/registry/*.json (authored). A stale mirror is exactly what ran a
// fix's rules under the OLD logic earlier today per this unit's brief.
// CLI-only.
// ===========================================================================

function checkMirrorFresh(rawBySource, report) {
  for (const s of rawBySource) {
    const rawText = JSON.stringify(s.rows);
    const mirrorText = JSON.stringify(s.mirror);
    if (rawText !== mirrorText) {
      report('REGISTRY_MIRROR_STALE', 'D63 / §2.7', s.file, `src/registry/index.ts's ${s.mirrorName} does not match ${s.file} — run "npm run gen:registry".`);
    }
  }
}

// ===========================================================================
// RANKING_FIELD_NO_FALLBACK's data source — built from the REAL loaded CY2026
// data (src/data/opps.cy2026.ts's `OPPS_ROWS`, `[code, si, apc, weight,
// rateMils]` per operators.ts's own row shape), not from the TypeScript
// type. CLI-only: `lintRules` takes the resulting object as the
// `rankFieldNullability` dependency so tests can inject a synthetic one
// instead of editing the generated data file (see test/lint-registry.test.ts).
// ===========================================================================

export function buildRankFieldNullability(rows) {
  const nullSiByField = { rateMils: new Set(), weight: new Set() };
  const nullCounts = { rateMils: 0, weight: 0 };
  const anyNull = { rateMils: false, weight: false };
  for (const row of rows) {
    const si = row[1];
    const weight = row[3];
    const rateMils = row[4];
    if (rateMils === null) {
      nullSiByField.rateMils.add(si);
      nullCounts.rateMils++;
      anyNull.rateMils = true;
    }
    if (weight === null) {
      nullSiByField.weight.add(si);
      nullCounts.weight++;
      anyNull.weight = true;
    }
  }
  return {
    totalRows: rows.length,
    nullCounts,
    nullSiByField,
    isNullableInData(field, siValues) {
      if (field !== 'rateMils' && field !== 'weight') return false; // chargeMils/unitCount: never null by type — nothing to check.
      if (siValues === null) return anyNull[field]; // domain not statically resolvable -> conservative whole-dataset answer.
      return siValues.some((si) => nullSiByField[field].has(si));
    },
  };
}

// ===========================================================================
// CLI. Runs ONLY when this file is executed directly, never on import (see
// file header) — `test/lint-registry.test.ts` imports `lintRules` above
// with no side effects.
// ===========================================================================

// `isMainModule` detects "was this file executed directly" — true in the
// plain `node tools/lint-registry.mjs` invocation, and false when imported
// as a module (e.g. by test/lint-registry.test.ts under vitest, whose own
// runner is argv[1], not this file). It gates ONLY the relaunch decision.
// It is deliberately NOT used to decide whether to run `main()`: `vite-node`
// runs the target file through its own entry script, so inside the
// relaunched child process `process.argv[1]` is `vite-node.mjs` itself, not
// this file (verified empirically — isMainModule reads false there even
// though this IS the CLI run) — the `OPPS_LINT_VIA_VITE_NODE` env var alone
// is what the child uses to know it should proceed straight to `main()`.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule && process.env.OPPS_LINT_VIA_VITE_NODE !== '1') {
  const viteNodeEntry = path.join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
  if (!existsSync(viteNodeEntry)) {
    console.error(
      'error: node_modules/vite-node not found (it ships as a dependency of the vitest devDependency).\n' +
        'Run `npm install` first. See this file\'s header for why a TS loader is needed at all.',
    );
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [viteNodeEntry, __filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, OPPS_LINT_VIA_VITE_NODE: '1' },
  });
  process.exit(result.status === null ? 1 : result.status);
}

if (process.env.OPPS_LINT_VIA_VITE_NODE === '1') {
  await main();
}

async function main() {
  const { operators } = await import('../src/dsl/operators.ts');
  const { adjudicate } = await import('../src/index.ts');
  const { EXEMPT_RULES, PACKAGING_RULES, DISPOSITION_RULES } = await import('../src/registry/index.ts');
  const { isKnownFlagCode } = await import('../src/flags.ts');
  const { OPPS_ROWS } = await import('../src/data/opps.cy2026.ts');
  const rankFieldNullability = buildRankFieldNullability(OPPS_ROWS);

  const args = process.argv.slice(2);
  const JSON_OUTPUT = args.includes('--json');

  // Load the hand-authored JSON directly — the primary source per this
  // file's header. Order matches tools/gen-registry.mjs / src/index.ts's
  // own combination order, so REGISTRY_MIRROR_STALE compares like-for-like.
  const REGISTRY_DIR = path.join(ROOT, 'src', 'registry');
  const SOURCES = [
    { file: 'opps.exempt.json', mirrorName: 'EXEMPT_RULES', mirror: EXEMPT_RULES },
    { file: 'opps.packaging.json', mirrorName: 'PACKAGING_RULES', mirror: PACKAGING_RULES },
    { file: 'opps.dispositions.json', mirrorName: 'DISPOSITION_RULES', mirror: DISPOSITION_RULES },
  ];

  function readJsonArray(file) {
    const abs = path.join(REGISTRY_DIR, file);
    const text = readFileSync(abs, 'utf8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error(`${file}: expected a top-level JSON array, got ${typeof parsed}`);
    return parsed;
  }

  const RAW_BY_SOURCE = SOURCES.map((s) => ({ ...s, rows: readJsonArray(s.file) }));
  const RULES = RAW_BY_SOURCE.flatMap((s) => s.rows.map((rule) => ({ rule, sourceFile: s.file })));

  const { violations, info, d45, d66Guard } = lintRules(RULES, { operators, isKnownFlagCode, rankFieldNullability });

  info.push(
    `RANKING_FIELD_NO_FALLBACK data source: ${rankFieldNullability.totalRows} total rows loaded; rateMils null in ${rankFieldNullability.nullCounts.rateMils} row(s) (SI: ${[...rankFieldNullability.nullSiByField.rateMils].join(', ') || 'none'}); weight null in ${rankFieldNullability.nullCounts.weight} row(s) (SI: ${[...rankFieldNullability.nullSiByField.weight].join(', ') || 'none'}).`,
  );

  const deferred = [];
  function deferGate(gate, section, reason) {
    deferred.push({ gate, section, reason });
  }
  function report(gate, section, ruleId, message) {
    violations.push({ gate, section, ruleId, message });
  }

  checkMirrorFresh(RAW_BY_SOURCE, report);
  runDynamicSweep(adjudicate, report, info);
  checkD64(operators, report, info, deferGate);
  deferredGates(deferGate, report);

  const hardViolations = violations.filter((v) => !RATCHET_GATES.has(v.gate));

  const byGate = new Map();
  for (const v of violations) byGate.set(v.gate, (byGate.get(v.gate) ?? 0) + 1);

  const ok = hardViolations.length === 0 && !d45.exceeded && !d66Guard.exceeded;

  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        {
          ok,
          hardViolations,
          d45,
          d66Guard,
          deferred,
          info,
          summaryByGate: Object.fromEntries(byGate),
        },
        null,
        2,
      ),
    );
  } else {
    console.log('OPPS registry lint (tools/lint-registry.mjs, spec §15.3)\n');

    if (hardViolations.length === 0) {
      console.log('No hard-fail violations.\n');
    } else {
      console.log(`${hardViolations.length} hard-fail violation(s):\n`);
      for (const v of hardViolations) {
        console.log(`  [${v.gate}] ${v.ruleId} — ${v.message} (${v.section})`);
      }
      console.log('');
    }

    console.log(`D45 ratchet (scope must be statically decidable, §4.3): ${d45.count} violation(s), baseline ${d45.baseline}${d45.exceeded ? ' — EXCEEDED' : ''}.`);
    if (d45.count > 0) {
      for (const o of d45.offenders) console.log(`  - ${o.ruleId}: [${o.ops.join(', ')}]`);
    }
    console.log('');

    console.log(
      `D66 guard ratchet (bundleUnder "among" must exclude already-bundled lines, D66): ${d66Guard.count} violation(s), baseline ${d66Guard.baseline}${d66Guard.exceeded ? ' — EXCEEDED' : ''} — a debt baseline, not an approval; a NEW unguarded bundleUnder past this count hard-fails.`,
    );
    if (d66Guard.count > 0) {
      for (const r of d66Guard.reasons) console.log(`  - ${r.ruleId}: ${r.message}`);
    }
    console.log('');

    if (deferred.length > 0) {
      console.log('Deferred gates (cannot be checked against what exists on disk — see docs above):');
      for (const d of deferred) console.log(`  [${d.gate}] (${d.section}) ${d.reason}`);
      console.log('');
    }

    if (info.length > 0) {
      console.log('Notes:');
      for (const line of info) console.log(`  - ${line}`);
      console.log('');
    }

    console.log('Summary by gate:');
    for (const [gate, count] of [...byGate.entries()].sort()) console.log(`  ${gate}: ${count}`);
    console.log('');

    console.log(ok ? 'PASS' : 'FAIL');
  }

  process.exit(ok ? 0 : 1);
}
