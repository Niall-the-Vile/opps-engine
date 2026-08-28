# Build log

**Read this first if you are picking the build up cold.** It is the resume point. The repo plus this file should be enough to continue without replaying any conversation.

- **Spec:** `ref/opps-adjudicator-scope.md` — normative, rev 14. Section references below (§n) are to it.
- **Architecture plan:** `ref/opps-architecture-edit-plan.md` — Tiers C and D not yet applied to the spec.
- **Milestone 1 goal:** given a UB-04 code set, state per line whether it pays or bundles, under which line, and why. **No dollar amounts in output.**

---

## Build protocol

1. **Sonnet for implementation.** Mechanical work — adapters, generators, operator bodies, tests, front-end — goes to Sonnet subagents. Reserve close review for the evaluator's ordering semantics and the rule registry's policy content, where being subtly wrong is invisible.
2. **One unit ends with files on disk.** Never let an agent hold the only copy of its output. If a usage limit cuts a run off, the completed units survive and the interrupted one restarts from scratch — not the whole milestone.
3. **Update the table below when a unit lands**, including any decision made along the way. This file is the state, not the conversation.
4. **Small sequential units over large fan-outs.** A fan-out that dies loses every branch at once; this project has already lost three multi-agent runs to session limits.
5. **`npm run verify` must pass before a unit is marked done.** `typecheck` → `lint:registry` → `test`.

---

## Unit status

| Unit | Scope | Depends on | Status |
|---|---|---|---|
| U0 | Repo scaffold: `package.json`, `tsconfig.json`, dirs, README | — | **done** |
| U1 | `ClaimInput` type + `EngineError`/`Flag` (§12.7) + status/basis/outcome vocabularies (§5.1, §5.3, §10.3) | U0 | **done** |
| U2 | XML institutional adapter → `ClaimInput`. Feed quirks: `remote_chgid`, `charge_record_type` (DA/UN), `rev_code` with no `proc_code`, no per-line dates. PHI stops here (§2.1) | U1 | **done** |
| U3 | `gen-data.mjs`: Addendum B → `src/data/opps.cy2026.ts`. All §7.1 tokenization (`$`, thousands commas, literal `.`, `%`), byte sanitization, mils, 3-decimal precision. **Ships with the §8.1 census self-check: six patterns must partition to 18,986** | U1 | **done** |
| U4 | `gen-data.mjs`: CLFS → `src/data/clfs.cy2026.ts`, keyed `(code, modifier)`. `INDICATOR = L` never emits a rate | U3 | **done** |
| U5 | Historical validity index from the HCPCS termination file (§7.5.1) — 1,300 codes, drives `INVALID_HISTORICAL` | U3 | **done** |
| U6 | `schedule` derivation (§3.4) — OPPS-first precedence, routed lines only | U3, U4 | **done** |
| U7 | `routing.ts` — shared resolver, leaf module, imports data only (§2.3) | U6 | **done** |
| U8 | `dsl/operators.ts` — closed set per §21.1 unit 1.3. **Zero imports**; composites take an injected `evalNode`. Every operator ships `describe()` + `argSpec()` | U1 | **done** |
| U9 | `dsl/evaluate.ts` — interpreter, fact epochs E0–E3b, sub-bands, per-effect conflict resolution (§2.5, §4.3). **Review closely** | U8 | **done** |
| U10 | `trace.ts` — append-only journal outside the frozen payload (§2.2), canonical serializer, `STRUCTURAL_FIELDS`/`MONETARY_FIELDS` | U9 | **done** |
| U11 | `dsl/validate.ts` + `dsl/freeze.ts` — dependency-free schema validation, deep freeze (§12.2, §12.3) | U1 | **done** |
| U9a | Seam fixes: drop claim-wide `matchingLineIds` from 5 operators (O(rules x lines^2) hazard); dedup ranking logic into `operators.ts` | U9 | **done** |
| U12a | `phases/adjudicate.ts` + `adjudicate()` entry point in `src/index.ts` — **omitted from the original unit list**; the registry units are JSON content and nothing wired them | U9, U13 | **done** |
| U12 | `phases/classify.ts` — §8.0 gate (5 conditions) + §8.0.2 `likelySystem` routing, §8.0.1 rev-only lines, §8.1 shapes + `INVALID_HISTORICAL`, REJECTED/ROUTED split | U7, U9, U5 | **done** |
| U13 | Registry: exempt set {U,G,H,F,L,S1,H1,K1} (518 codes, S1/H1/K1 flagged UNVERIFIED_POLICY) + standard dispositions (§9.4, §9.6) | U8, U9 | **done** |
| U14 | Registry: J1 comprehensive control, payment-ranked (§9.1) | U13 | **done** |
| U15 | Registry: C-APC 8011, all six conditions (§9.1) | U14 | **done** |
| U16 | Registry: Q1/Q2/Q3/Q4 packaging, Q4→A conversion, the Q1/Q4 asymmetry (§9.2, §9.3) | U14 | **done** |
| U17 | Registry: reserved NCCI/MUE + `DELETED` slots, `dataRequired` suspension (§8.1, §9.5) | U13 | **done** |
| U18 | `lint-registry.mjs` — every gate in §15.3 | U13 | todo |
| U19a | `adapters/codeList.ts` + `tools/adjudicate.mjs` — paste codes, read an adjudication. Synthesized claim fields surfaced as stated assumptions | U12a | **done** |
| U19b | `PACKAGED` status for SI N; `determination.line` echoes its own input; conditional UNITS column | U19a | **done** |
| U19 | `inspect.ts` — explain + applicability modes (§6.1, §6.2) | U10 | **done** |
| U19c | `--why` restructured: WHY / CONSIDERED-DID-NOT-APPLY / NOT-CHECKED footer; reserved slots stated once | U19a | **done** |
| U19d | WHY text **generated** from rule condition + effects rather than printing `note`; `note` moved to `--why-verbose` | U19c | **done** |
| U9b | Fixed dangling `factRefs`: on-demand rank facts were cited but never registered into `Result.facts`, so `inspect.explain()` threw on any T-line claim | U9 | **done** |
| U20 | `diff-registry.mjs` (§6.3) | U18 | todo |
| U21 | Divergence layer + seed set (§20, §20.4) | U19 | todo |
| U22 | `gen-goldens.mjs` + `.structure.json` projections + `rule-coverage.json` (§15.2) | U19 | todo |
| U23 | Fixtures per §15.1, minus the amount-dependent ones | U22 | todo |
| U24 | `bundle.mjs` — esbuild IIFE, single `OppsEngine` global (§2.7) | U19 | **done** |
| U25 | Browser front-end. **Scoped in `docs/M25-browser-interface.md`; awaiting design.** | U24 | **done** |

---

## Decisions made during the build

Record every one here, with a spec section if it belongs in the spec too.

| # | Decision | Spec |
|---|---|---|
| D1 | `lineId = chargeId \|\| 'idx:' + index`; collision throws `LINE_ID_NOT_UNIQUE` | §19.14 |
| D2 | Engine defines its own `ClaimInput`; does not import the viewer's `Claim` | §2.1 |
| D3 | Adjudicate all claims under current data standards; disclose DOS/vintage gap | §7.5 |
| D4 | The §8.0 gate names the likely payment system, advisory, with evidence | §8.0.2 |
| D5 | S1/H1/K1 join the exempt set, flagged UNVERIFIED_POLICY (518 codes, was 202) | §9.6 |
| D6 | Duplicate identical lines are never collapsed — ordinary lines, separate occurrences | §19.7 |
| D7 | `claimId` never falls back to `pcn`, even though M1.1's mapping table lists `pcn` as an alternate source. `pcn` is on the §14 forbidden-field list ("never carried through"); that instruction is stricter and wins over the mapping table's "`pcn` or a supplied id" wording. Falls back to positional `idx:<n>` instead. This is a real contradiction in M1.1, not a stylistic choice — flagged for the spec to resolve explicitly. | §2.1, §14 |
| D8 | Money-field parse failure (non-decimal string, missing required `@charge`/`@total_charge`/`@value_amt_N`, or a malformed `<claims>`/`<claim>` structure) throws `EngineError` with code `CLAIM_SCHEMA_INVALID` — the closest of the eleven §12.7 codes. M1.1's validation point 4 says "reject NaN" but names no code. | §12.7 |
| D9 | U2's two non-fatal adapter findings use ad hoc flag codes `INST_XML.TOTAL_CHARGE_MISMATCH` and `INST_XML.DATE_UNPARSEABLE`. §12.7 says `Flag.code` is enumerated in a flag manifest, but that manifest doesn't exist yet (later unit) — these codes are not yet registered anywhere and will need to be reconciled with the manifest when it's built. | §12.7 |
| D10 | Date normalization (`YYYY-MM-DD` → `YYYYMMDD`) is applied to `occurrenceCodes[].date` as well as `statementFrom/Through` and line dates, even though the field-mapping table's `occurrenceCodes` row only says "pair by index" and doesn't mention normalization. Treated as an oversight in the table rather than an intentional exception, for consistency with every other date field. | — |
| D11 | The committed fixture's own header comment (lines 17–18 of `inst-xml-inpatient-cah-revonly.xml`) says lineId "falls back to `idx:` form" for this claim, but every `<charge>` in the fixture actually carries a non-empty, unique `remote_chgid` (`129543`…`129544`). Implemented per M1.1's "Test expectations" section instead, which explicitly requires `lineIdScheme === 'feed'` — and that is what the actual fixture data produces under the §19.14 rule. The fixture comment appears to describe the *bug being fixed* (reading `chgid` instead of `remote_chgid`), not the adapter's correct behavior; it should be reworded so a future reader doesn't trust the comment over the data. | §19.14 |

---

## Open, and blocking

Do not guess these. They change output.

- **§19.25** bill-type conventions in this feed — blocks U12's routing table. `81A` with room & board and a CAH taxonomy do not sit together; confirm what the feed puts in `type_of_bill`.
- **§19.2** unit semantics — U2 preserves `charge_record_type`; milestone 1 needs only the `G0378` unit total for 8011.

**Unblocked since rev 10:** §19.7 (duplicates — never collapsed, D6), §19.18 (S1/H1/K1 — provisionally exempt, D5), §19.24 (gate names the system, D4). U9, U12, and U13 are no longer waiting on a decision.

## Unverified policy — ships flagged, not silent

Four §9 assertions rest on one reviewer's reading of Ch. 4 and were never adversarially verified. Rules implementing them carry an `UNVERIFIED_POLICY` flag until a human confirms against the manual.

MPPR's weight ranking (§10.5) · the 8011 date relation · the Q4 dual reading (§19.19) · the S1/H1/K1 exclusion question (§19.18).

**Why this is called out:** if a rule is coded wrong and its fixture is written to match, the two agree and the test suite goes green. The flag is the only thing standing between that and a wrong answer nobody notices.

| D12 | `schedule` is **computed** per `(code, effectiveSI)` by `routing.resolve()`, not stored as a per-code column. A code-level column is ill-defined for Q4 codes, whose schedule is CLFS only after conversion to A. Spec §3.4/§7.2 corrected to match. | §3.4, §7.2 |
| D13 | §3.4 step 1 tests the **passed** `effectiveSI`, not the record's stored SI, so `resolve()` is a general function and the OPPS-first guard is testable with any SI. | §3.4 |
| D14 | MPFS membership = **either** total-RVU column non-zero. Correct for Tier 2 naming; revisit if MPFS pricing enters scope. | §19.26 |
| D15 | CLFS routing membership uses the bare (`''`) modifier row only. `QW` is a pricing nuance, not a routing one. Revisit at the CLFS-pricing phase. | §3.1 |
| D16 | Ambulance AFS source is `.xlsx`; U6 emits an empty AFS set with a TODO rather than adding an xlsx dependency. **AFS routing is therefore inert until converted.** | §3.2 |
| D17 | Operator argument shapes are declared per operator (§4.3.1): single-dimension operators take a bare payload, multi-dimension take a named object. Rev 10 left this implied by two inconsistent examples, so deep validation of operator args was impossible. | §4.3.1 |
| D18 | `route` takes no arguments — a rule cannot name a target schedule, since schedule is computed from `(code, effectiveSI)` per D12. Supersedes the `{schedule}` shape used during U8. | §4.3.1 |
| D19 | `codePattern` is glob (`*`/`?`), not regex — hand-authored JSON should not invite catastrophic backtracking. | §4.3.1 |
| D20 | `dimension` vocabulary gains `rate` and `weight` so `hasRate`/`hasWeight` have an honest `argSpec` home. | §4.4 |
| D21 | `EngineOptions` declared in §5.1. `assertions` fields default to absent = "not asserted", never `false`. U11's provisional options shape is superseded. | §5.1 |
| D22 | Argument normalization lives in `operators.ts` via a per-operator `normalizeArgs()`; the registry loader calls it. A loader-side normalizer would re-encode every operator's shape outside the module that owns it. | §4.3.1 |
| D23 | `route` is a structural marker; the phase calls `routing.resolve()`. The interpreter never imports `routing` — keeps the graph acyclic, and schedule is computed at the phase's call time, not the interpreter's. | §4.3 |
| D24 | `alwaysEvaluate` is per-rule, not per-band. Nothing else reifies a band as an object; lint checks per-band consistency. | §4.3 |
| D25 | `counterfactualRef` is the rule id, not a numeric index. Rev 10's "an index into `Result.counterfactuals[ruleId]`" was self-confused. | §5.3a |
| D26 | Effects earlier in a rule's `then[]` are **not** rolled back if a later one throws. Line ends `ERRORED` so output isn't corrupted, but application is not atomic. Accepted simplification; revisit if it bites. | §4.3 |
| D27 | Shared trace/fact vocabulary (`Epoch`, `Fact`, `Evaluation`, `EffectApplication`, `ScopeExclusion`, `Phase`) lives in `src/types.ts`, upstream of both `evaluate.ts` and `trace.ts`, since §2.6 forbids `trace.ts` importing `evaluate.ts`. | §2.6 |
| D28 | `validate.ts` claim-level dates use the or-empty helper. `statementThrough` is absent on the reference claim, and requiring it threw `CLAIM_SCHEMA_INVALID` before the §8.0 gate could run — found only by routing the fixture through the real `adjudicate()` rather than calling `classify()` directly. | §12.2 |
| D29 | Registry authored in full named-object arg form throughout; §4.3.1's bare shorthand is not implemented and is removed from the spec. | §4.3.1 |
| D30 | J1's own controlling line uses basis `OPPS_APC`. `OPPS_COMPREHENSIVE` is reserved for C-APC 8011. | §9.1 |
| D31 | The 17 CLFS-only codes have no OPPS SI to classify against; treated as ROUTED with synthetic `resolvedSI: 'A'` so the shared resolver applies uniformly, flagged `OPPS.CLASSIFY.CLFS_ONLY`. | §8.1 |
| D32 | SI `N` → `status: PAID`, `basis: NONE` — not `BUNDLED`, since there is no controlling line to name. **Imperfect fit; flagged as an open vocabulary question.** | §9.4 |
| D33 | Q1/Q2 composite-not-evaluated flag uses presence of an SI Q3 line as the operational proxy, since no data source defines "composite-eligible companion". | §9.2 |
| D34 | CAH taxonomy detection is exact-match on `282NC0060X` only — no NUCC taxonomy table on disk. Narrow, known gap, not a general classifier. | §8.0 |
| D35 | `adjudicate()` signature omits `data` (no injectable seam in `data/index.ts`'s singleton) and `contracts` (phase 4, out of scope). | §5.1 |
| D36 | **D32 closed.** SI `N` uses new status `PACKAGED` (not `PAID`) — `basis: NONE`, `bundledUnder: null`. `PAID` with no amount told a reader the line pays when it pays nothing separately. Distinct from `BUNDLED`, which names a controlling line. | §5.1, §9.4 |
| D37 | `determination.line` echoes the raw `ClaimLineInput` (procCode, modifiers, units, dates, revenueCode, chargeMils). The flattened `code`/`revCode`/`chargeMils` fields are kept, not removed — `Determination` is a public export and the CLI plus tests read them; narrowing a public surface was out of scope for a fix unit. | §5.1 |
| D38 | CLI `--dos` defaults to `DATA_VINTAGE_EFFECTIVE_DATE = '20260101'`, a constant traced to CLFS `effFrom` — never `Date.now()`. The engine has no clock (§2.4) and the CLI must not smuggle one in through the adapter. | §2.4, §7.5 |
| D39 | The CLI self-relaunches through `node_modules/vite-node` (already vitest's dependency). `node --experimental-strip-types` strips types but does not do the `.js`→`.ts` specifier remap this source relies on. No new dependency added. | — |
| D40 | A rule that a milestone **defers** must still be declared as a reserved slot with `dataRequired`, so it reports `NOT_EVALUATED`. Found by running `G0378x8 99284` with C-APC 8011 unbuilt: the answer looked complete with no hint a major packaging rule had not been considered. Applies to U15 and U17. | §9.5 |
| D41 | **U25 (browser front-end) deferred; the CLI is the interface for now.** A design pass was offered and postponed deliberately: the hard problem in this UI is the trace's information architecture — how to show every rule considered, including non-firing ones with counterfactuals, without drowning the reader — and nobody yet knows which parts of that output a bill processor actually reads versus skips. Using the CLI on real claims first produces exactly that information. Design then build, not the reverse. | §13.1 |
| D42 | 8011's criteria are **sourced from Ch. 4**, not paraphrased. Two of three criteria groups (observation-time documentation, physician evaluation) are medical-record facts and **not derivable from a claim at all** — 8011 can never be fully determined here. Permanent limitation, absent from every prior revision. | §9.1 |
| D43 | "Any SI J2 present" is **exact, not a proxy**: the 13 CY2026 J2 codes are precisely the manual's named list (99281-99285, G0380-G0384, G0463, 99291, G0379). The generator asserts this per refresh so a future J2 addition fails the build rather than silently over-firing 8011. | §9.1 |
| D44 | 8011 criterion 2a's date relation is **sourced and precise** but **inexpressible**: same-day-or-day-before for the visit codes, same-day-only for G0379. Needs a cross-line date operator; the data is already present. No longer an unverified policy — now an unimplemented one. | §19.27 |
| D45 | `scope` must be **statically decidable from a code alone**; `statusIn`/`isExempt` removed from the scope-selector list and a claim-relational predicate in `scope` is a lint error. Rev 13 allowed them and the registry also used `isHighestBy` there, which defeated applicability mode entirely — it could decide no Q-group or J1 rule. **Registry not yet migrated; rules still carry these in `scope`.** | §4.3 |
| D46 | Registry node form is `{op, args}`, not the single-key form earlier spec examples showed. Spec follows implementation. | §4.2 |
| D47 | The reader-facing WHY text is **generated from rule structure**, never authored prose. `note` is developer rationale and drifted so far from the outcome that it omitted the actual reason a line bundled. Generated explanations cannot disagree with the logic; authored ones do. | §6.1 |
| D48 | `G0379` is also SI J2 with a **higher rate** than `99284` (608,430 vs 426,300 mils), so on a claim carrying both, payment-ranking makes the direct-referral line control instead of the ED visit — backwards. **Open, flagged not fixed.** | §9.1 |
| D49 | U25 scoped rather than built (`docs/M25-browser-interface.md`). The design questions are real ones — trace volume (55 rows at 10 lines, ~1,400 at the 250-line ceiling §18.29 requires), bundling as a relationship rather than a row attribute, and NOT_OPPS-with-conflicting-evidence as a first-class answer. Design first, build against it. | §13.1 |
| D50 | Web front-end implements the user's design (`docs/ref/M25-design-reference.dc.html`) in **vanilla JS**. The design was authored as a `.dc.html` canvas using `support.js`, a React runtime needing a CDN — impossible under §2's `file://`-with-no-network constraint. Palette, layout, seven views, status/outcome/flag colour maps, and the 28px bundled-line indent all carried over faithfully. | §13.1 |
| D51 | Google Fonts dropped: cannot load offline. The design's own `font-family` fallbacks (Georgia / system-ui / Menlo) are used. Embedding font files as base64 is the only offline alternative and was judged not worth the weight. | §2.7 |
| D52 | **Every mock determination in the design was discarded**, not adapted — most were factually wrong. Beyond the three found in review (`36415` SI Q4 not N, `59025` SI T not S, `84112` BUNDLED not PACKAGED): `G0463` is J2 not Q3, `00100` is PACKAGED/N not ROUTED, `99284` PAID not bundled, and **all 13 invented rule ids** (`R-SI-CLASSIFY`, `R-ONE-VISIT-PER-CLAIM`, `R-ANESTHESIA-ROUTE`, …) are fictional. Real ids are `OPPS.DISP.T`, `OPPS.PKG.Q4.COMPANION`. Normal for a prototype; recorded so nobody later mistakes the design's sample text for engine behaviour. | §13.1 |
| D53 | `why` text extracted from `tools/adjudicate.mjs` into `tools/lib/why.mjs` and shared by CLI and web, so both generate identical explanations from one source. Per D47 the explanation is generated, never authored — the design's hand-written `why` strings did not ship. | §6.1 |
| D54 | Design gaps filled: `Status` needed 4 more values (`MALFORMED`, `INVALID`, `DELETED`, `NOT_ADJUDICATED`), `Outcome` needed 3 (`NOT_EVALUATED` — present on essentially every real claim via the reserved slots — plus `ERRORED`, `RETIRED`), and `--r-pill` was referenced by every badge but never declared. `FlagSeverity` was complete. | §5.1, §5.3 |
| D55 | Web calls `adjudicate()` with `traceLevel: 'full'` rather than the engine default `'standard'`, so counterfactuals arrive resolved instead of as refs. Deliberate for an audit UI; means browser output is richer than a bare CLI run. | §5.3a |
| D56 | Reference tables are generated from the registry (§13.1) — 31 real rows against the design's 7 hand-typed. Only the SI table was built: it is the only one the design drew, and the routing table **cannot** be argSpec-generated because `routing.resolve()` is imperative TypeScript rather than a declarative rule. | §13.1 |
