import { describe, expect, it } from 'vitest';
import { adjudicate } from '../src/index.js';
import { applicability } from '../src/inspect.js';
import { loadRegistry } from '../src/registry/loader.js';
import { EXEMPT_RULES, PACKAGING_RULES, DISPOSITION_RULES } from '../src/registry/index.js';
import { parseCodeList } from '../src/adapters/codeList.js';
import type { PredicateNode } from '../src/dsl/operators.js';

/**
 * D45 (docs/BUILD_LOG.md) — before this fix, 21 rules put a claim-relational
 * predicate (`statusIn`, `isExempt`, `isHighestBy`) in `scope` rather than
 * `when`. Spec §4.3 requires `scope` to be statically decidable from a code
 * alone; a claim-relational predicate there is undecidable with no claim in
 * hand, so `inspect.applicability()` (§6.2) bucketed every Q-group and J1
 * rule as `conditional` instead of `admitted` — for EVERY code, regardless
 * of its actual status indicator. The reproduction from the bug report:
 *
 *   for (const c of ['36415','G0463','59025','84112'])
 *     console.log(c, applicability(c, registry).admitted.length) // always 0
 *
 * This file asserts the fix directly against the real, shipped registry
 * (not a synthetic fixture) — see test/inspect.test.ts for the two
 * corresponding assertions that were rewritten in place (they previously
 * encoded the bug itself as the expected behaviour).
 */

const BUNDLED_RULES = loadRegistry([...EXEMPT_RULES, ...PACKAGING_RULES, ...DISPOSITION_RULES]);

function claimFor(codes: string): ReturnType<typeof parseCodeList>['claim'] {
  return parseCodeList(codes, { dos: '20260115' }).claim;
}

// ===========================================================================
// 1. applicability() now differentiates by SI — the exact bug, asserted on
//    specific codes and specific rule ids, not merely "lengths differ".
// ===========================================================================

describe('D45 fix — applicability() differentiates by status indicator', () => {
  it('36415 (Q4) admits the Q4 packaging rules and NOT the T/J2 disposition rules', () => {
    const result = applicability('36415', BUNDLED_RULES);
    const admittedIds = result.admitted.map((r) => r.ruleId);

    expect(admittedIds).toContain('OPPS.PKG.Q4.COMPANION');
    expect(admittedIds).toContain('OPPS.PKG.Q4.CONVERT');
    expect(admittedIds).not.toContain('OPPS.DISP.T');
    expect(admittedIds).not.toContain('OPPS.DISP.J2');
    expect(admittedIds).not.toContain('OPPS.PKG.Q1.COMPANION');
  });

  it('84112 (Q4) admits exactly the same Q4-specific rule set as 36415 (both SI Q4)', () => {
    const a = applicability('36415', BUNDLED_RULES).admitted.map((r) => r.ruleId).sort();
    const b = applicability('84112', BUNDLED_RULES).admitted.map((r) => r.ruleId).sort();
    expect(a).toEqual(b);
  });

  it('G0463 (J2) admits the J2 disposition rule and the C-APC 8011 controlling rule, and NOT the Q4 rules', () => {
    const result = applicability('G0463', BUNDLED_RULES);
    const admittedIds = result.admitted.map((r) => r.ruleId);

    expect(admittedIds).toContain('OPPS.DISP.J2');
    expect(admittedIds).toContain('OPPS.CAPC8011.CONTROLLING');
    expect(admittedIds).not.toContain('OPPS.PKG.Q4.COMPANION');
    expect(admittedIds).not.toContain('OPPS.DISP.T');
  });

  it('59025 (T) admits the T disposition and MPPR-rank rules, and NOT the J2/Q4 rules', () => {
    const result = applicability('59025', BUNDLED_RULES);
    const admittedIds = result.admitted.map((r) => r.ruleId);

    expect(admittedIds).toContain('OPPS.DISP.T');
    expect(admittedIds).toContain('OPPS.DISP.T.MPPR_RANK');
    expect(admittedIds).not.toContain('OPPS.DISP.J2');
    expect(admittedIds).not.toContain('OPPS.PKG.Q4.COMPANION');
  });

  it('the four reproduction codes are pairwise different in their admitted rule-id sets, except the two same-SI Q4 codes', () => {
    const codes: readonly string[] = ['36415', 'G0463', '59025', '84112'];
    const admittedById = new Map<string, Set<string>>(codes.map((c) => [c, new Set(applicability(c, BUNDLED_RULES).admitted.map((r) => r.ruleId))]));

    const same = (a: string, b: string) => {
      const setA = admittedById.get(a);
      const setB = admittedById.get(b);
      return setA !== undefined && setB !== undefined && setA.size === setB.size && [...setA].every((id) => setB.has(id));
    };

    // 36415 and 84112 are both SI Q4 — expected to match exactly.
    expect(same('36415', '84112')).toBe(true);
    // Every other pair spans a different SI and must differ — this is
    // precisely the defect: pre-fix, every one of these pairs was IDENTICAL
    // (admitted: [] for all four).
    expect(same('36415', 'G0463')).toBe(false);
    expect(same('36415', '59025')).toBe(false);
    expect(same('G0463', '59025')).toBe(false);
  });
});

// ===========================================================================
// 2. Non-empty admitted for codes that genuinely have admitted rules — the
//    part of the bug the reproduction states plainly ("admitted: 0" always).
// ===========================================================================

describe('D45 fix — admitted is non-empty for codes with real admitted rules', () => {
  it.each(['36415', 'G0463', '59025', '84112'])('%s has at least one admitted rule (was always 0 before the fix)', (code) => {
    const result = applicability(code, BUNDLED_RULES);
    expect(result.admitted.length).toBeGreaterThan(0);
  });

  it('OPPS.PKG.J1.CONTROL and OPPS.CAPC8011.CONTROL are admitted for every real code (their scope is `always` by design, §4.3 — not SI-derivable, since exemption is a category, not an SI)', () => {
    for (const code of ['36415', 'G0463', '59025', '84112', '00100', 'A9506']) {
      const admittedIds = applicability(code, BUNDLED_RULES).admitted.map((r) => r.ruleId);
      expect(admittedIds).toContain('OPPS.PKG.J1.CONTROL');
      expect(admittedIds).toContain('OPPS.CAPC8011.CONTROL');
    }
  });

  it('a code with no OPPS SI at all (unknown to Addendum B) admits nothing and rejects, rather than landing in conditional', () => {
    const result = applicability('ZZ9999', BUNDLED_RULES);
    // Only the two `always`-scoped, claim-relational-when rules (which admit
    // any code, since their scope alone cannot see the code has no SI) plus
    // the three reserved (dataRequired) slots are expected here.
    const admittedIds = result.admitted.map((r) => r.ruleId);
    expect(admittedIds).toContain('OPPS.PKG.J1.CONTROL');
    expect(admittedIds).toContain('OPPS.CAPC8011.CONTROL');
    expect(result.admitted.map((r) => r.ruleId)).not.toContain('OPPS.DISP.T');
    expect(result.conditional).toEqual([]);
  });
});

// ===========================================================================
// 3. Data-driven: no rule's `scope` contains a claim-relational predicate.
//    Deliberately duplicates tools/lint-registry.mjs's own D45 gate — the
//    lint guards authoring, this guards the engine's own runtime view of the
//    registry (the normalized `Rule[]` `loadRegistry()` actually produces
//    and `evaluate()`/`inspect.applicability()` actually read).
// ===========================================================================

const CLAIM_RELATIONAL_OPS = new Set([
  'statusIn',
  'isExempt',
  'isHighestBy',
  'isNotHighestBy',
  'ordinalIs',
  'ordinalAtLeast',
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

function isPredicateNode(v: unknown): v is PredicateNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { op?: unknown }).op === 'string' && 'args' in v;
}

function walkPredicateTree(node: PredicateNode, visit: (op: string) => void): void {
  visit(node.op);
  const args = node.args;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return;
  const rec = args as Record<string, unknown>;
  if (Array.isArray(rec.children)) {
    for (const child of rec.children) if (isPredicateNode(child)) walkPredicateTree(child, visit);
  }
  if (isPredicateNode(rec.child)) walkPredicateTree(rec.child, visit);
  if (isPredicateNode(rec.among)) walkPredicateTree(rec.among, visit);
}

describe('D45 fix — no rule scope contains a claim-relational predicate (data-driven, mirrors the lint gate)', () => {
  it.each(BUNDLED_RULES.filter((r) => r.scopeTarget === 'line').map((r) => r.id))('rule %s’s scope is statically decidable', (ruleId) => {
    const rule = BUNDLED_RULES.find((r) => r.id === ruleId);
    expect(rule).toBeDefined();
    const offendingOps: string[] = [];
    if (rule !== undefined) {
      walkPredicateTree(rule.scope, (op) => {
        if (CLAIM_RELATIONAL_OPS.has(op)) offendingOps.push(op);
      });
    }
    expect(offendingOps).toEqual([]);
  });

  it('exactly 0 line-scoped rules in the shipped registry violate D45 (the true count, matching the lowered lint baseline)', () => {
    let violatingCount = 0;
    for (const rule of BUNDLED_RULES) {
      if (rule.scopeTarget !== 'line') continue;
      let offends = false;
      walkPredicateTree(rule.scope, (op) => {
        if (CLAIM_RELATIONAL_OPS.has(op)) offends = true;
      });
      if (offends) violatingCount++;
    }
    expect(violatingCount).toBe(0);
  });
});

// ===========================================================================
// 4. Regression: packaging outcomes the migration's own before/after corpus
//    diff (tools/diff-d45-migration.mjs) established as unchanged stay
//    unchanged. Picking the most interesting multi-line interactions rather
//    than the whole 71-claim corpus — full coverage lives in that tool.
// ===========================================================================

describe('D45 fix — packaging outcomes are unchanged (regression, from the migration corpus diff)', () => {
  it('J1 present bundles a companion T line under the J1 (OPPS.PKG.J1.CONTROL still fires correctly with scope=always)', () => {
    const result = adjudicate({ claim: claimFor('0071T 0101T') });
    const [j1, t] = result.determinations;
    expect(j1?.code).toBe('0071T');
    expect(j1?.status).toBe('PAID');
    expect(j1?.basis).toBe('OPPS_APC');
    expect(j1?.bundledUnder).toBeNull();
    expect(t?.code).toBe('0101T');
    expect(t?.status).toBe('BUNDLED');
    expect(t?.basis).toBe('NONE');
    expect(t?.bundledUnder).toBe(j1?.lineId);
  });

  it('an always-exempt SI (G) is never bundled under a controlling J1 (isExempt exclusion survives moving to `when`)', () => {
    const result = adjudicate({ claim: claimFor('0071T A9506') });
    const [j1, g] = result.determinations;
    expect(j1?.status).toBe('PAID');
    expect(g?.code).toBe('A9506');
    expect(g?.status).toBe('PAID');
    expect(g?.basis).toBe('OPPS_DRUG_ASP');
    expect(g?.bundledUnder).toBeNull();
  });

  it('C-APC 8011 still fires and packages the claim (scope=always for OPPS.CAPC8011.CONTROL, isHighestBy/isExempt now in when)', () => {
    const result = adjudicate({ claim: claimFor('G0378x8 99284') });
    const [g0378, j2] = result.determinations;
    expect(g0378?.status).toBe('BUNDLED');
    expect(g0378?.bundledUnder).toBe(j2?.lineId);
    expect(j2?.status).toBe('PAID_UNPRICED');
    expect(j2?.basis).toBe('OPPS_COMPREHENSIVE');
    expect(j2?.flags.map((f) => f.code)).toContain('OPPS.8011.RATE_UNAVAILABLE');
  });

  it('the Q1-vs-Q4 asymmetry survives: a bare J2 line bundles the Q4 lab but not the Q1 line (OPPS.PKG.Q4.COMPANION/Q1.COMPANION notes)', () => {
    const result = adjudicate({ claim: claimFor('G0463 0106T 0002M') });
    const [j2, q1, q4] = result.determinations;
    expect(j2?.status).toBe('PAID');
    expect(q1?.status).toBe('PAID'); // Q1's trigger list is S/T/V only — a bare J2 line does not bundle it.
    expect(q1?.bundledUnder).toBeNull();
    expect(q4?.status).toBe('BUNDLED'); // Q4's trigger list includes J2 even without 8011 firing.
    expect(q4?.bundledUnder).toBe(j2?.lineId);
  });

  it('the Q1/Q2 survivor tiebreak still bundles the lower-paid line under the higher-paid one when neither companion-packages', () => {
    const result = adjudicate({ claim: claimFor('0106T 0412T') }); // Q1 + Q2, no S/T/V trigger present.
    const [q1, q2] = result.determinations;
    expect(q1?.code).toBe('0106T');
    expect(q1?.status).toBe('BUNDLED');
    expect(q1?.bundledUnder).toBe(q2?.lineId);
    expect(q2?.code).toBe('0412T');
    expect(q2?.status).toBe('PAID');
    expect(q2?.basis).toBe('OPPS_APC');
  });

  it('a bare unpackaged Q4 line still converts to SI A and routes to CLFS (OPPS.PKG.Q4.CONVERT, scope narrowed to bare siIn:[Q4])', () => {
    const result = adjudicate({ claim: claimFor('0002M') });
    const [q4] = result.determinations;
    expect(q4?.resolvedSI).toBe('Q4');
    expect(q4?.effectiveSI).toBe('A');
    expect(q4?.status).toBe('PAID');
    expect(q4?.basis).toBe('CLFS');
  });
});
