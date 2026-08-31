/**
 * U17 Part A — the flag manifest (spec §12.7, §16).
 *
 * §12.7: "`code` [...] is enumerated in a flag manifest, so §18 criteria
 * assert on a code rather than on English prose [...] Registry lint fails
 * if a rule emits a code absent from the manifest." §16: "Every §16
 * non-goal has exactly one flag code." Neither existed before this unit —
 * logged as D9: U2's two adapter findings (`INST_XML.TOTAL_CHARGE_MISMATCH`,
 * `INST_XML.DATE_UNPARSEABLE`) used ad hoc codes with nowhere to register
 * against. This file is that registry.
 *
 * CLOSED SET, BUILT BY SEARCHING, NOT GUESSING. Every code below in the
 * first group is a code this build actually found emitted somewhere in
 * `src/` (grepped for `code: '...'` / `"code": "..."` literals across
 * every `.ts` and registry `.json` file) — see the final report for the
 * full audit. The second group is one flag code per §16 non-goal bullet,
 * several of which reuse a first-group code that already covers the same
 * non-goal (§12.7's "one code per non-goal" is about the *non-goal*, not
 * about every code being freshly minted — reusing `OPPS.Q3.COMPOSITE_NOT_EVALUATED`
 * for both the Q3 rule and the Q1/Q2 companion-flag rule is existing,
 * pre-U17 precedent for exactly this). The third group is a small number
 * of additional codes this unit's own U15 (C-APC 8011) build introduces,
 * for gaps that are real but are not literally one of the fifteen §16
 * bullets — see each entry's meaning.
 *
 * ZERO IMPORTS except the one type this file exists to constrain
 * (`FlagSeverity`, from `types.ts`, which itself has zero imports — no
 * cycle risk).
 */

import type { FlagSeverity } from './types.js';

export interface FlagManifestEntry {
  readonly severity: FlagSeverity;
  /** One line: what the code means and when it fires. */
  readonly meaning: string;
}

// ---------------------------------------------------------------------------
// Group 1 — codes already emitted somewhere in src/ before this unit.
// Grouped by emitting file, in the order a `grep -rn "code: '"` pass finds
// them, so the mapping back to source is easy to re-verify.
// ---------------------------------------------------------------------------

const EMITTED_CODES: Readonly<Record<string, FlagManifestEntry>> = {
  // src/phases/classify.ts (§8.0-§8.3)
  'OPPS.CLASSIFY.UNITS_UNPARSEABLE': {
    severity: 'warning',
    meaning: 'A line\'s raw units string did not parse as a non-negative number; defaulted to 1.',
  },
  'OPPS.CLASSIFY.MALFORMED': {
    severity: 'warning',
    meaning: 'A procedure code failed every valid §8.1 shape pattern; the flag names the specific malformed sub-case.',
  },
  'OPPS.CLASSIFY.INVALID_HISTORICAL': {
    severity: 'info',
    meaning: 'A code absent from current data was still active on the claim\'s date of service (§7.5.1) — valid when billed, not a coding error.',
  },
  'OPPS.CLASSIFY.INVALID': {
    severity: 'warning',
    meaning: 'A code is absent from every loaded data set (Addendum B, CLFS, DMEPOS, MPFS, AFS), with no evidence it ever existed.',
  },
  'OPPS.CLASSIFY.CLFS_ONLY': {
    severity: 'info',
    meaning: 'A code has no Addendum B row (no SI) but is present in CLFS or another Tier-1/2 data set; routed as if SI A (D31).',
  },
  'OPPS.CLASSIFY.RECODE': {
    severity: 'warning',
    meaning: 'An SI B (not OPPS-recognized) code was billed on a UB-04; names the facility-equivalent recode target when known (§8.3).',
  },
  'OPPS.CLASSIFY.MODIFIER_PEELED': {
    severity: 'assumption',
    meaning: 'A 7-character procedure token with no delimiter was split into a 5-character code plus a trailing 2-character modifier; names the raw token, the adjudicated code, and the peeled modifier so the split is never silent (§8.1).',
  },

  // src/phases/adjudicate.ts (orchestration / containment, §8.0, §12.8)
  'OPPS.CLASSIFY.NOT_OPPS': {
    severity: 'info',
    meaning: 'The §8.0 claim-level applicability gate rejected the whole claim as not adjudicable under OPPS; no phase-2 determinations were produced.',
  },
  'OPPS.Q4.NO_SCHEDULE_MATCH': {
    severity: 'gap',
    meaning: 'An unpackaged Q4 line converted to SI A (§9.3) but the code has no CLFS row and matched no other loaded fee schedule (DMEPOS/AFS/MPFS) either — `basis` reports whatever routing.resolve() actually found (typically ROUTED_UNKNOWN) rather than a fabricated `CLFS` claim. A data gap on a real code, not a claim defect.',
  },
  'ENGINE.CLASSIFY_FAULT': {
    severity: 'gap',
    meaning: 'Phase 1 (CLASSIFY) faulted on a line; that line is ENGINE_ERROR/NOT_ADJUDICATED and every other line still completes (§12.8).',
  },
  'ENGINE.MISSING_DETERMINATION': {
    severity: 'gap',
    meaning: 'A line was admitted to phase 2 but the interpreter produced no determination for it — an engine-internal invariant violation, not a claim defect.',
  },

  // src/dsl/evaluate.ts (interpreter-level containment, §12.8)
  'ENGINE.RULE_FAULT': {
    severity: 'gap',
    meaning: 'A registry rule (line-scoped or claim-scoped) threw during evaluation or effect application; that line/claim result degrades to ERRORED per §12.8 and every other line still completes.',
  },

  // src/adapters/instXml.ts (D9 — the two ad hoc codes this manifest exists to reconcile)
  'INST_XML.DATE_UNPARSEABLE': {
    severity: 'warning',
    meaning: 'An institutional XML date field did not match YYYYMMDD-derivable input and was normalized to \'\'.',
  },
  'INST_XML.TOTAL_CHARGE_MISMATCH': {
    severity: 'warning',
    meaning: 'The sum of line charges does not equal the feed\'s declared @total_charge for the claim.',
  },

  // src/adapters/codeList.ts (§10.4, §13.2 — CLI/paste-a-code-list adapter)
  'CODELIST.ASSUMED_CLAIM_SHAPE': {
    severity: 'assumption',
    meaning: 'The code-list adapter synthesized claim shape (institutional, bill type 131, one line per token, a default date of service) that the pasted input never supplied.',
  },

  // src/registry/opps.packaging.json (§9.1, §9.2)
  'OPPS.J1.COMPLEXITY_NOT_APPLIED': {
    severity: 'gap',
    meaning: 'Two or more SI J1 lines are present; CMS\'s complexity-adjustment combination table (not on disk) is not applied, so the claim pays the single ranked J1 rate and may be understated (§9.1, §16).',
  },

  // src/registry/opps.exempt.json (§9.6)
  'OPPS.EXEMPT.UNVERIFIED_POLICY': {
    severity: 'assumption',
    meaning: 'S1/H1/K1\'s exemption from C-APC packaging is a structural inference, not confirmed by Addendum D1 or CMS-1834-FC (§9.6).',
  },

  // src/registry/opps.dispositions.json (§9.2, §9.4)
  'OPPS.T.MPPR_RANKING_UNVERIFIED': {
    severity: 'assumption',
    meaning: 'MPPR ranks SI T lines by relative weight (Ch.4 §10.5), not by payment (§10.4.1\'s Q-group rule) — one reviewer\'s reading, not adversarially verified.',
  },
  'OPPS.T.MPPR_NOT_PRICED': {
    severity: 'gap',
    meaning: 'An SI T line ranks 2nd-or-later by MPPR but this milestone computes no dollar amounts, so the 50% reduction is recorded (via the ordinal) but not applied to any figure.',
  },
  'OPPS.N.PACKAGED': {
    severity: 'info',
    meaning: 'SI N is always $0, no modifier override; charges are still reported for rate-setting/outlier purposes, not separately payable under any basis (§9.4).',
  },
  'OPPS.Q3.COMPOSITE_NOT_EVALUATED': {
    severity: 'gap',
    meaning: 'A Q3 line (or a Q1/Q2 line alongside a Q3 companion) pays without composite-APC evaluation — the Ch.4 §10.4.1 combination table is not on disk (§9.2, §16).',
  },
};

// ---------------------------------------------------------------------------
// Group 2 — one flag code per §16 non-goal, in the order §16 lists them.
// Four reuse a Group 1 code that already covers the same non-goal (noted
// inline); the rest are new — reserved for the units that will eventually
// need them, registered now so a future rule author has a code to reach
// for instead of inventing an ad hoc one (repeating D9).
// ---------------------------------------------------------------------------

const NON_GOAL_CODES: Readonly<Record<string, FlagManifestEntry>> = {
  'OPPS.NCCI_MUE.NOT_EVALUATED': {
    severity: 'gap',
    meaning: '§16 non-goal 1/15 (NCCI PTP and MUE evaluation): reserved slots NCCI.PTP.PAIR and MUE.LIMIT report NOT_EVALUATED — no NCCI/MUE file on disk (§9.5).',
  },
  'OPPS.DELETED.NOT_EVALUATED': {
    severity: 'gap',
    meaning: '§16 non-goal 2/15 (DELETED / code-termination checking): reserved slot OPPS.CLASSIFY.DELETED reports NOT_EVALUATED — no termination date for any loaded code (§8.1).',
  },
  // 3/15 (Q3 composite APC evaluation) reuses 'OPPS.Q3.COMPOSITE_NOT_EVALUATED' from Group 1 — same non-goal, §9.2.
  'OPPS.8011.RATE_UNAVAILABLE': {
    severity: 'gap',
    meaning: '§16 non-goal 4/15 (C-APC 8011 rate determination): the controlling J2 line of a fired 8011 packages the claim but yields PAID_UNPRICED — no APC 8011 rate is on disk (§9.1, §12.7\'s own worked example).',
  },
  'OPPS.NONGOAL.COMMERCIAL_PAYER': {
    severity: 'info',
    meaning: '§16 non-goal 5/15: this engine never adjudicates a commercial payer\'s rules; §20\'s divergence layer only annotates commentary against them.',
  },
  // 6/15 (J1 complexity adjustment) reuses 'OPPS.J1.COMPLEXITY_NOT_APPLIED' from Group 1 — same non-goal, §9.1.
  'OPPS.NONGOAL.MPPR_SESSION_SCOPE': {
    severity: 'gap',
    meaning: '§16 non-goal 7/15: MPPR ranks SI T lines claim-wide, not scoped to the same operative session (§19.20) — no operative-session boundary is modeled.',
  },
  'OPPS.NONGOAL.CONTRACT_REBUNDLING': {
    severity: 'info',
    meaning: '§16 non-goal 8/15: a payer contract (phase 4) may never re-bundle a phase-2 packaging determination — architecturally excluded (§11.1).',
  },
  'OPPS.NONGOAL.WAGE_INDEX': {
    severity: 'info',
    meaning: '§16 non-goal 9/15: this engine prices at national rates only — no wage-index or locality adjustment (the same constraint that puts MPFS/DMEPOS/AFS in Tier 2).',
  },
  'OPPS.NONGOAL.TIER23_PRICING': {
    severity: 'info',
    meaning: '§16 non-goal 10/15: Tier 2 schedules (MPFS, DMEPOS, AFS) are named/routed only, never priced; Tier 3 is out of scope entirely (§3.2, §3.3).',
  },
  'OPPS.NONGOAL.MODIFIER_LOGIC': {
    severity: 'info',
    meaning: '§16 non-goal 11/15: modifier handling is limited to 73/74/PN/PO detection; no broader modifier-driven pricing logic is modeled.',
  },
  'OPPS.NONGOAL.PROFESSIONAL_ADJUDICATION': {
    severity: 'info',
    meaning: '§16 non-goal 12/15: this engine never adjudicates a CMS-1500/MPFS professional claim, only institutional UB-04/OPPS claims.',
  },
  'OPPS.NONGOAL.CLAIM_WORKFLOW': {
    severity: 'info',
    meaning: '§16 non-goal 13/15: claim submission, remittance posting, and appeals workflow are out of scope — this engine states an adjudication, it does not transact one.',
  },
  'OPPS.NONGOAL.NSA_GFE_PPDR': {
    severity: 'info',
    meaning: '§16 non-goal 14/15: No Surprises Act, Good Faith Estimate, and PPDR pathways are out of scope by policy — AB\'s disputes rest on common-law reasonable value plus FDCPA/FCRA grounds instead.',
  },
  'OPPS.NONGOAL.NETWORK_TELEMETRY': {
    severity: 'info',
    meaning: '§16 non-goal 15/15: this engine makes no network call and reports no telemetry; it is offline by design (§2.4\'s determinism requirement depends on it).',
  },
};

// ---------------------------------------------------------------------------
// Group 3 — additional codes this unit's own U15 build introduces for a real
// gap that is not literally one of the fifteen §16 bullets (it is one of
// the four items docs/BUILD_LOG.md's "Unverified policy" section tracks
// separately from §16's non-goals).
// ---------------------------------------------------------------------------

const OTHER_CODES: Readonly<Record<string, FlagManifestEntry>> = {
  'OPPS.8011.DATE_RELATION_UNVERIFIED_POLICY': {
    severity: 'assumption',
    meaning: 'C-APC 8011\'s condition 5 (visit date of service same day as, or the day before, the observation service; G0379 same day) is one reviewer\'s reading of Ch.4, never adversarially verified, and is not mechanically enforced by the registry rule — the closed DSL operator set has no cross-line date-relational operator (§9.1, §19 open decisions).',
  },
  // Test-only marker — used exclusively by test/evaluate.test.ts's synthetic
  // fixture rules (invented purely to exercise the interpreter's own
  // mechanics, per that file's own header — not real registry content) to
  // mark whether a fixture rule fired. Distinguished by message text, not
  // by code, precisely so this manifest check does not force every
  // interpreter-mechanics test to invent a fake production flag code.
  // Never emitted by any real registry rule.
  'TEST.EVALUATE_FIXTURE': {
    severity: 'info',
    meaning: 'Test-only marker emitted by test/evaluate.test.ts synthetic fixture rules; never emitted by real registry content.',
  },
};

/**
 * The full closed flag-code set (§12.7). Read-only; every entry pairs a
 * code with its `severity` and a one-line `meaning`.
 */
export const FLAG_MANIFEST: Readonly<Record<string, FlagManifestEntry>> = Object.freeze({
  ...EMITTED_CODES,
  ...NON_GOAL_CODES,
  ...OTHER_CODES,
});

/** True iff `code` is registered in {@link FLAG_MANIFEST} (§12.7 — closed set, no ad hoc codes). */
export function isKnownFlagCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(FLAG_MANIFEST, code);
}
