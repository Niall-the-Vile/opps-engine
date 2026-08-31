// tools/lib/d45-corpus.mjs — the D45 migration's before/after regression
// corpus (see docs/BUILD_LOG.md D45 and tools/diff-d45-migration.mjs).
//
// Pure data, no engine imports, so it can be loaded directly by vitest
// (test/fix-d45-applicability.test.ts) as well as by
// tools/diff-d45-migration.mjs's vite-node-bootstrapped CLI — see that
// file's header for why the CLI needs the bootstrap and this module does
// not.
//
// COVERAGE. One representative code per CY2026 status indicator (all 28),
// plus the four codes the D45 bug report reproduces against (36415, G0463,
// 59025, 84112 — already representative of Q4/J2/T respectively, listed
// explicitly anyway so they are never accidentally dropped by a future
// edit), plus the named codes spec §3.1.1/§8.1 calls out as special cases
// (CLFS-unmatched Q4, CLFS-zero-rate Q4, the two byte-corrupted rows, the
// 8011 date-relation codes), plus multi-line combinations exercising J1
// control, C-APC 8011 (fired and each of its blockers), the Q1/Q2/Q3/Q4
// group interactions (companion packaging, the asymmetry the registry's own
// notes call out, the survivor tiebreak, the composite flag), and the
// always-exempt SIs mixed with a controlling J1/8011 to exercise the
// isExempt-disjointness argument the lint's structural-conflict gates now
// rely on (see tools/lint-registry.mjs's `provablyDisjointPair`).
//
// Each entry is `{ id, codes, dos? }` for a code-list claim (fed through
// `parseCodeList`, spec §13.2's CODE[xUNITS][:MOD] syntax) or
// `{ id, xmlFixture }` for one of the two XML fixtures (§15.1) — every
// claim inside a multi-claim fixture file is included.

export const SINGLE_SI_CLAIMS = [
  { id: 'si-J1', codes: '0071T' },
  { id: 'si-N', codes: '00100' },
  { id: 'si-A', codes: '0001U' },
  { id: 'si-M', codes: '0509F' },
  { id: 'si-C', codes: '00176' },
  { id: 'si-Q4', codes: '0002M' },
  { id: 'si-E1', codes: '0001F' },
  { id: 'si-T', codes: '0101T' },
  { id: 'si-B', codes: '0352T' },
  { id: 'si-Y', codes: 'A4238' },
  { id: 'si-Q1', codes: '0106T' },
  { id: 'si-S', codes: '0263T' },
  { id: 'si-K', codes: '90371' },
  { id: 'si-S1', codes: 'A2001' },
  { id: 'si-Q3', codes: '0362T' },
  { id: 'si-Q2', codes: '0412T' },
  { id: 'si-G', codes: 'A9506' },
  { id: 'si-L', codes: '90653' },
  { id: 'si-E2', codes: '0100T' },
  { id: 'si-R', codes: 'C9507' },
  { id: 'si-V', codes: '0811T' },
  { id: 'si-H', codes: 'C1600' },
  { id: 'si-U', codes: 'A9527' },
  { id: 'si-H1', codes: 'C9804' },
  { id: 'si-J2', codes: '99281' },
  { id: 'si-K1', codes: 'J0666' },
  { id: 'si-P', codes: 'G0129' },
  { id: 'si-F', codes: 'V2785' },
];

/** The exact four codes the D45 bug reproduction (see README/BUILD_LOG) checks applicability() against. */
export const REPRO_CODES = ['36415', 'G0463', '59025', '84112'];

export const NAMED_SPECIAL_CLAIMS = [
  // §3.1.1 — Q4 codes that convert to A and route to CLFS with a real rate.
  { id: 'named-36415', codes: '36415' },
  { id: 'named-84112', codes: '84112' },
  { id: 'named-81001', codes: '81001' },
  // §3.1.1 — Q4 codes absent from CLFS entirely (contractor-priced / data anomaly, D69).
  { id: 'named-0602T', codes: '0602T' },
  { id: 'named-0603T', codes: '0603T' },
  { id: 'named-81099', codes: '81099' },
  { id: 'named-84999', codes: '84999' },
  { id: 'named-85999', codes: '85999' },
  { id: 'named-88749', codes: '88749' },
  // §3.1.1 — Q4 codes present in CLFS at RATE=0.00/INDICATOR=L (PAID_UNPRICED, not $0).
  { id: 'named-0526U', codes: '0526U' },
  // §3.5 spot values / SI B (never payable).
  { id: 'named-99205', codes: '99205' },
  { id: 'named-99284', codes: '99284' },
  { id: 'named-G0463', codes: 'G0463' },
  { id: 'named-59025', codes: '59025' },
  { id: 'named-G0378', codes: 'G0378' },
  // §9.1 condition 5 / D48 — the two 8011 date-relation codes.
  { id: 'named-G0379', codes: 'G0379' },
  // §3.5 — byte-corrupted Addendum B rows (trailing 0xFF).
  { id: 'named-A4341', codes: 'A4341' },
  { id: 'named-G0465', codes: 'G0465' },
];

export const MULTI_LINE_CLAIMS = [
  // --- J1 comprehensive control (§9.1, OPPS.PKG.J1.CONTROL) ---------------
  { id: 'j1-two-j1-lines', codes: '38240 69930' }, // two distinct J1 codes: the lower-paid one must bundle under the higher.
  { id: 'j1-plus-t', codes: '0071T 0101T' }, // J1 present -> T line bundles under J1 (not its own OPPS_APC disposition).
  { id: 'j1-plus-exempt-g', codes: '0071T A9506' }, // exempt SI G must NOT bundle under J1 (isExempt guard).
  { id: 'j1-plus-exempt-s1', codes: '0071T A2001' }, // UNVERIFIED_POLICY-exempt S1 must also not bundle.
  { id: 'j1-plus-all-exempt', codes: '0071T A9506 A9527 C1600 90653 A2001 C9804 J0666' }, // J1 + every always-exempt SI at once.

  // --- C-APC 8011 (§9.1, OPPS.CAPC8011.CONTROL/CONTROLLING) --------------
  { id: 'capc8011-fires', codes: 'G0378x8 99284' }, // all conditions met -> fires, 99284 controls, packages the claim.
  { id: 'capc8011-split-units', codes: 'G0378x4 G0378x4 99284' }, // §19.7 — units split across two identical lines still sum to 8.
  { id: 'capc8011-blocked-by-t', codes: 'G0378x8 99284 0101T' }, // SI T present -> 8011 must NOT fire.
  { id: 'capc8011-blocked-by-j1', codes: 'G0378x8 99284 0071T' }, // SI J1 present -> J1 control takes over instead.
  { id: 'capc8011-insufficient-units', codes: 'G0378x4 99284' }, // only 4 units -> 8011 must NOT fire.
  { id: 'capc8011-plus-exempt', codes: 'G0378x8 99284 A9506 A9527' }, // 8011 fires; always-exempt lines must stay unbundled.

  // --- Q-group companion packaging (§9.2, the asymmetry the registry's own notes call out) ---
  { id: 'q1-plus-t', codes: '0106T 0101T' }, // Q1 bundles under T (STV-packaged).
  { id: 'q1-plus-s', codes: '0106T 0263T' }, // Q1 bundles under S.
  { id: 'q1-plus-v', codes: '0106T 0811T' }, // Q1 bundles under V.
  { id: 'q2-plus-t', codes: '0412T 0101T' }, // Q2 bundles under T.
  { id: 'q2-plus-s-no-bundle', codes: '0412T 0263T' }, // Q2's trigger list is narrower than Q1's -- must NOT bundle against S alone.
  { id: 'q4-plus-j2-no-8011', codes: '0002M 99281' }, // Q4's trigger list includes J2 even without 8011 firing.
  { id: 'q1-vs-q4-j2-asymmetry', codes: 'G0463 0106T 0002M' }, // the exact asymmetry OPPS.PKG.Q4.COMPANION's note documents: Q4 bundles under the bare J2 line, Q1 does not (pays its own APC).
  { id: 'q4-bare-converts', codes: '0002M' }, // no trigger present -> Q4 converts to A, routes to CLFS.
  { id: 'q1q2-survivor-tiebreak', codes: '0106T 0412T' }, // Q1 + Q2, no S/T/V trigger -> neither companion-bundles; the lower-paid of the two bundles under the higher via OPPS.PKG.Q.SURVIVOR_TIEBREAK.
  { id: 'q3-composite-flag-with-q1', codes: '0362T 0106T' }, // Q3 present -> Q1 pays its own APC but carries OPPS.Q3.COMPOSITE_NOT_EVALUATED.
  { id: 'q3-composite-flag-with-q2', codes: '0362T 0412T' },

  // --- the richest single interaction: one of every packaging-relevant SI ---
  { id: 'all-nine-packaging-sis', codes: '0071T 99281 0263T 0101T 0811T 0106T 0412T 0362T 0002M' }, // J1,J2,S,T,V,Q1,Q2,Q3,Q4 — same representative codes tools/lint-registry.mjs's dynamic sweep uses, for cross-referencing.
];

export const XML_FIXTURES = [
  { id: 'xml-inst-cah-revonly', xmlFixture: 'inst-xml-inpatient-cah-revonly.xml' },
  { id: 'xml-outpatient-13x-hcpcs', xmlFixture: 'outpatient-13x-hcpcs.xml' },
];

export function fullCorpus() {
  return [...SINGLE_SI_CLAIMS, ...NAMED_SPECIAL_CLAIMS, ...MULTI_LINE_CLAIMS, ...XML_FIXTURES];
}
