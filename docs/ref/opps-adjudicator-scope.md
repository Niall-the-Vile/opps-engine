# Scope — OPPS Adjudication Engine + Rule Inspector

### CY2026 · Anabaptist Brotherhood, Plan ID 4350

**Document status:** build specification for a ground-up rewrite.
**Supersedes:** `OPPS_SI_Relationships_CY2026_5.html` (defective — see §17).
**Primary deliverable:** a portable, DOM-free adjudication **engine** whose rules are data. The browser tool is one front-end over it; `837-claim-viewer` is the other.

**Revision note (rev 15).** Found by a review pass that read the operator table against `operators.ts` line by line instead of trusting it.

- **§4.3.1's argument table was still rev 11's bare-payload form**, three revisions after rev 13 reversed that decision — 15 operators documented as taking bare `string`/`number`/`string[]` where the code requires a named object, plus `optionIs`/`optionAtLeast` naming a `value` field the code calls `equals`/`atLeast`, and `flag` marking a required `message` optional. The table is now derived from the implementation. This mattered more than a typo: authoring a rule from the old table produces one that **passes load-time validation, faults at evaluation, and reports itself as an unrelated failure** — the exact incident rev 13 existed to prevent, still reachable from the document that caused it.
- **§4.3.1's `normalizeArgs` paragraph described a mechanism that has never existed** and is now removed. `src/registry/loader.ts` already documented its absence; the spec did not.
- **§4.3 gained `statusIn`**, implemented and load-bearing but absent from every category list, so by §4.3's own rule it was not formally in the closed set.
- **The money-bearing operators are now marked deferred** (`chargeAtLeast`, `claimMoneyAtLeast`, `claimDayCountAtLeast`, and the phase-4 effects). They were offered by the spec and omitted by `operators.ts` with no marker, so a rule authored against one fails to load with no hint the gap was deliberate — the failure shape §9.5 forbids.
- **§9.3 — a Q4 conversion's basis is `CLFS` only when the code is actually CLFS-present, not unconditionally.** Rev 12's fix ("forced `CLFS`, never trust `routing.resolve()`") overcorrected: it was right that `resolve()` degrades the 18 CLFS-present-but-unrated codes to `ROUTED_UNKNOWN` and that forcing `CLFS` for those is correct, but it also forced `CLFS` onto the 6 codes (`0602T`, `0603T`, `81099`, `84999`, `85999`, `88749`) that have no CLFS row **or any other fee-schedule match at all** — fabricating provenance CMS's own data does not support. The phase now checks CLFS membership directly (`lookupClfs`, §3.4) before deciding whether to trust `resolve()`'s basis; the 6 unmatched codes report `ROUTED_UNKNOWN` and raise `OPPS.Q4.NO_SCHEDULE_MATCH` (§12.7, severity `gap`) instead. The never-`OPPS_APC` guarantee is unchanged.

**Revision note (rev 14).** Found by building the inspector, and by reading Ch. 4 instead of paraphrasing it.

- **§9.1 — the 8011 criteria are now sourced from the manual**, and two of its three criteria groups (observation-time documentation, physician evaluation) are **not derivable from a claim at all**. 8011 can never be fully determined here; a fired 8011 must say so. Absent from every prior revision.
- **§9.1 — "any SI J2" is exact rather than a proxy.** The 13 CY2026 J2 codes are precisely the manual's named list. The generator now asserts that equivalence per refresh, so a future J2 addition fails the build instead of silently over-firing 8011.
- **§19.27 — the date relation needs an operator, not data.** Two variants: same-day-or-day-before for the visit codes, same-day-only for `G0379`.
**Also in rev 14.** Found by building the inspector — the feature that reads the registry rather than executing it.

- **§4.3 — `scope` must be statically decidable from a code alone.** `statusIn` and `isExempt` are removed from the scope-selector list, and a claim-relational predicate in `scope` is now a lint error. Rev 13 permitted them, and the shipped registry also used `isHighestBy` in a scope, which was never listed. The consequence was that applicability mode (§6.2) could not decide **any** Q-group or J1 rule and returned an empty `admitted` list — the mode's entire purpose defeated. Moving these predicates to `when` costs nothing: they still gate firing, so they still prevent the cross-band `setStatus` error.
- **§4.2 — node form is `{op, args}`.** The spec's examples used a single-key form; the implementation uses `{op, args}`, which is unambiguous under nesting. Spec follows implementation.

**Revision note (rev 13).** Two defects found by running the CLI — the first unit whose output a human reads.

- **§5.1 / §9.4 — new `PACKAGED` status.** SI `N` reported `PAID` with no basis and no amount, which says the line pays when it pays nothing separately. Backwards, not imprecise. Distinct from `BUNDLED`, which names a controlling line. This closes the vocabulary question logged as D32.
- **§5.1 — the determination must echo its own line input.** `determination.line` was an empty object, and `units`/`modifiers`/dates appeared nowhere in the output. Units feed the C-APC 8011 count test and modifiers feed the 73/74/PN/PO rules, so a determination that does not echo what it received cannot be checked against it — which is the point of an auditable trace.
- **§9.5 — a deferred rule must be a declared reserved slot, not an absence.** A suspended rule reports `NOT_EVALUATED`; a rule that does not exist reports nothing, and the output looks complete.

**Revision note (rev 12).** Corrections from batch 2, where the engine first adjudicated a claim end to end. Every item below was found by running code, not by re-reading the spec.

- **§4.3.1 — argument form is now uniformly named-object.** Rev 11's bare-payload shorthand is reversed on evidence: a rule authored per that table passed load-time validation, faulted at evaluation, and reported itself as an unrelated trace-dedup failure. Valid at load, broken at run, diagnosed elsewhere.
- **§12.2 — registry validation inspects operator payloads**, not just the envelope. That gap is what let the above reach runtime. Also: claim-level dates may legitimately be empty — requiring `statementThrough` rejected the reference fixture before the §8.0 gate it exists to exercise could run.
- **§12.1 — the engine imports no JSON modules.** A direct registry import forced `resolveJsonModule` into the engine's tsconfig, which would break criterion 3's no-config-change guarantee for the consumer.
- **§9.3 — a converted Q4 line's basis is `CLFS` by construction**, not from `routing.resolve()`, which returns `ROUTED_UNKNOWN` for the 6 codes with no CLFS row. Also corrected: **24** Q4 codes lack a usable rate, not 6.
- **§8.0.2 — routing signals are independent.** The "bill type is unhelpful" qualifier was unsatisfiable against the reference claim, which needs three signals to fire at once.
- **§12.8 — line-local faults do not repeat in `Result.errors`.** §12.7's code set is closed to load-time, claim-fatal codes.

Also folded in here: the U9/U10 review corrections (`counterfactualRef` is a rule id, `route` is a structural marker, `alwaysEvaluate` is per-rule) and the two seam fixes in U9a, which had been recorded under rev 11's bullets rather than getting a note of their own.

**Revision note (rev 11).** Corrections found by building the data layer (U3–U7).

- **§3.4 / §7.2 — `schedule` is computed, not stored.** It is a function of `(code, effectiveSI)`, not a property of a code, because a Q4 code routes to CLFS only after conversion to A. The generated artifacts are the membership sets; resolution happens at call time in `routing.resolve()`. A stored column would have been ill-defined for exactly the codes that matter, and matchable by an `inSchedule` selector while stale.
- **§8.1 — the shape counts are pre-sanitization**, which is why they sum to 18,984 with the two byte-corrupted codes listed as separate recoveries. Emitted data shows 7,457 for `[A-V]\d{4}`. Both correct; stated so the difference is not read as a bug.
- **§19.26 — MPFS membership uses either total-RVU column.** Fine for Tier 2 naming; must be revisited if MPFS pricing is ever in scope.
- **§4.3.1 — operator signatures are now declared.** Rev 10 gave two examples with different argument shapes and never stated the rule joining them, so a registry loader could not deep-validate operator arguments at all. Found by building the validator, which rejected this document's own example rule. Also: `route` takes no arguments (a rule cannot force a schedule, per §3.4), `codePattern` is glob not regex, and `dimension` gains `rate`/`weight`.
- **§4.3.1 — argument normalization belongs to `operators.ts`.** The bare form is an authoring convenience; every operator normalizes its own args. A loader-side expansion would duplicate each operator's shape outside the module that owns it.
- **§4.3 — `route` is a structural marker**, not a computation; the phase calls `routing.resolve()`. And `alwaysEvaluate` is per **rule**, not per band.
- **§5.3a — `counterfactualRef` is the rule id**, not a numeric index. The rev-10 phrasing ("an index into `Result.counterfactuals[ruleId]`") was self-confused: if the collection is keyed by rule id then the ref is that id.
- **Two seam defects fixed in code (U9a):** `operators.ts` returned a claim-wide `matchingLineIds` from five claim-relational operators, reintroducing the O(rules × lines²) amplification §2.5 exists to prevent; and ranking logic was implemented twice, once in `operators.ts` and again in `evaluate.ts` — the worst place for drift, since that is where the `weight`-vs-`rateMils` and `fallbackField` rules live.
- **§5.1 — `EngineOptions` declared.** Referenced by §5.3a, §12.2, and §13.2 since rev 6; never defined. `assertions` default to absent meaning "not asserted", never `false`.

**Revision note (rev 10).** Three decisions taken.

- **§8.0.2 — the gate names the fee schedule that does apply.** `NOT_OPPS` alone is a dead end for whoever holds the bill. The gate now reports a `likelySystem` with `confidence` and the `evidence` behind it. Advisory, never an adjudication, and where signals conflict — as they do on the rev-9 test claim, which shows hospice bill type, inpatient room & board, and a CAH taxonomy at once — it reports all three rather than picking a winner.
- **§9.6 — `S1`, `H1`, `K1` added to the exempt set, flagged `UNVERIFIED_POLICY`.** No source on disk states their C-APC status: Addendum D1 is not in this folder, and the local pricing index returns "Unknown status indicator" for `S1` and `H1`. The case is structural — all three sit in APC ranges for statutorily separately-paid categories (skin substitutes 6xxx, device pass-through 2xxx, drugs 9xxx), and `S1` appears in Addendum B's own 340B list alongside `S`. The exempt set goes from 202 to 518 codes. Error direction is recorded: over-exempting raises the benchmark, which costs AB money rather than exposing the position.
- **§19.7 — duplicate identical lines are ordinary lines, never collapsed.** Each classifies, adjudicates, and bundles independently, and each counts as a separate occurrence for every ranking and ordinal. `claimUnitsAtLeast` sums across matching lines, which is what makes the C-APC 8011 `G0378` unit test correct when units are split across two lines.

**Revision note (rev 9).** Vintage policy decided: **adjudicate everything under current standards.**

- **§7.5 rewritten.** Date of service no longer selects data. One active vintage; `DATA_VERSION` stays a stamp. Vintages archive **prospectively** from the next refresh forward — nothing is backfilled — and the loader interface stays vintage-shaped so DOS-accurate adjudication remains a data addition rather than a rewrite. §8.0's `DATA_VINTAGE` gate is removed; no claim is rejected for vintage.
- **The methodology is disclosed on every output.** Where the date of service precedes the loaded vintage, the result says so next to the totals. A stated methodology is defensible; an undisclosed one is not.
- **§7.5.1 — the one real cost, priced.** 685 HCPCS Level II codes were billable on 2020-08-25 and **all 685** are absent from CY2026 Addendum B. Under §8.1 each would return `INVALID` — "nonexistent code, RTP" — which is confidently wrong advice about a properly billed line. New verdict `INVALID_HISTORICAL` separates "was valid when billed" from "never existed." The 685 is a floor: it excludes CPT deletions.
- **§19.4 reversed, usefully.** The HCPCS termination file was judged useless for `DELETED`, correctly — no current code carries a termination date. It is the inverse file, and it exactly answers the question retrospective review asks: was this absent code alive on that date? Loaded as a historical validity index.
- **§19.23 closed** — no archive to acquire.

**Revision note (rev 8).** Driven by testing one real institutional claim against the spec. It was not adjudicable, for three independent reasons, and finding out why changed more than the six-lens architecture review did.

- **§7.5 — data is a vintage set, selected by date of service.** The test claim is dated 2020-08-25 against CY2026 data. Rev 7 would have flagged it and adjudicated nothing. Since AB does retrospective bill review, a historical date of service is the *normal* case, so `DATA_VERSION` becomes a lookup rather than a stamp, and every determination states the vintage that produced it.
- **§8.0 — a claim-level applicability gate, before any line is classified.** Rev 7 checked only `formType === 'ub04'`. The test claim cleared that intent and still had nothing an OPPS engine could say: bill type `81A` (not 13X), room & board with 6 covered days (inpatient), and a Critical Access Hospital taxonomy (cost-based, already Tier 3). `NOT_OPPS` is now a first-class answer rather than a failure.
- **§8.0.1 — revenue-code-only lines.** All 16 lines of the test claim carried `rev_code` and no `proc_code`. That is normal institutional billing, not an error, and the spec had no disposition for it. Adjudication is keyed on the Status Indicator, which is a property of a HCPCS code; with no HCPCS there is no SI.
- **§2.1 — the engine defines its own input type and owns its adapters.** Institutional claims arrive as **XML**; only CMS-1500s arrive as JSON, and the viewer has no XML support at all. So there is no existing parser to reuse for the only claim type this engine cares about. Coupling to `837-claim-viewer` drops to a shared shape, and the XML adapter is milestone 1.1's first task.
- **§19.2 — the unit qualifier exists in the feed** as `charge_record_type` (`DA` days / `UN` units). Units are not dimensionless.
- **§19.14 note** — the feed's line id is `remote_chgid`, not `chgid`, so the fallback decided in rev 7 fires on the first real claim.

**Revision note (rev 7).** Scope additions, not corrections:

- **§1.2 — bundling is the product; pricing is milestone 2.** The document still specifies §10 and §11 in full, deliberately, so the bundling layer is not built in a way that cannot host them. But they are not built first. One consequence to watch: bundling still needs `rateMils` and `weight`, because the controlling J1 and the surviving Q-group line are payment-ranked — rates are an internal ordering key in milestone 1, never an output.
- **§2.1 — the input is the claim JSON, not raw X12.** This is a separate program adjacent to `837-claim-viewer`, coupled by the shared `Claim` format rather than by shared source. That demotes §12.1's vendoring to milestone 4 and promotes the JSON contract to the real interface. `formType` must be `'ub04'`; the adapter is where PHI stops.
- **§20 — payer divergence layer.** New. Annotates where a commercial payer is likely to bundle differently than Medicare, as advisory commentary that never alters the determination and carries an explicit confidence and basis.
- **§21 — delivery milestones**, with milestone 1 broken into ten sub-milestones and its own (smaller) blocking-decision set.
- **§19.17 closed.** `Institutional.typeOfBill` exists, so C-APC 8011's 13X restriction is evaluable and all six of its firing conditions are now in scope.

**Revision note (rev 6).** Rev 5 was reviewed by six **software-architecture** lenses — scale, module structure, failure modes, testability, change cost, and an adversarial challenge to the architecture itself. 66 findings. Rev 6 applies the foundational tier; the remaining tiers are in `opps-architecture-edit-plan.md` alongside this file. Material rev-5 defects:

- **§2.2 / §5.1 — the freeze and the trace contradicted each other.** Phases received the prior phase's output deep-frozen while `trace` was nested *inside* `Determination` and phases 2–4 all appended to it. Either the freeze was real and appending was impossible, or the trace was silently exempt and §18.7 asserted less than it claimed. The trace is now an append-only journal outside the payload.
- **§5.2 / §5.3 — the trace was O(rules × lines²)** and did not fit. A 250-line claim measured 42.2 MiB minified, 125.2 MiB pretty, past GitHub's per-file limit. Facts are now referenced rather than copied, scope exclusions moved off the per-line record, and counterfactuals deduplicated by rule — bringing the same claim to ≈2.33 MiB with the audit default unchanged.
- **§15.2 — the golden-trace mechanism was unworkable.** 22.2 MiB and 881,004 lines per fixture; a one-field mismatch under the consumer's own `toEqual` golden pattern produced 34.2 MB of failure output. Replaced with three projections. The in-browser runner is deleted outright.
- **§2.7 — `bundle.mjs` could not be a concatenation.** `import`/`export` are syntax errors in a classic script, and the composite operators make `operators` ↔ `evaluate` a real cycle that flat concatenation turns into a load-time `ReferenceError` — §17 defect 3, reintroduced.
- **§12.1 — JSDoc-annotated `.js` failed four ways** (no sibling declarations → `TS7016`; nothing emitted or packaged; `/data` never vendored; no non-null assertion under `noUncheckedIndexedAccess`). The engine is authored in **TypeScript**, which dissolves all four.
- **§2.6 — the shared routing resolver had no home**, forcing a phase↔phase cycle in the one place the spec called a clean seam.
- **§12.7 / §12.8 — there was no error channel at all.** "Hard error" was used as a defined term three times and defined nowhere; `Result` had no field an error could land in, and `adjudicate` had no signature.

**Rev 5 note, retained.** Rev 4 was reviewed by a domain lens (Medicare policy against Ch. 4) and a DSL lens (operator sufficiency). Both found blockers. The material rev-4 defects:

- **§4.3 — no effect could write an amount or a `basis`**, so every pricing rule in the document was inexpressible. Added `setAmount` / `setBasis`.
- **§4.3 — `ordinalBy` returned a rank, not a boolean**, so it could not appear in a `when` and MPPR was inexpressible. Replaced with `ordinalIs` / `ordinalAtLeast`.
- **§4.2 — no way to declare a claim-scoped rule.** `Evaluation` carried `scopeTarget` but the rule shape had no such field, so 8011, `perDiem`, `caseRate`, `stopLoss`, and the disclosures would have fired once per line and applied their effects N times.
- **§9.1 — a fired C-APC 8011 no longer packaged the rest of the claim.** Rev 4 made the J2 line `PAID_UNPRICED` and lost the packaging effect, so every other line would pay its own APC — the opposite of comprehensive payment. A regression rev 4 introduced.
- **§9.2 / §9.4 — MPPR's ranking authority was misattributed.** Ch. 4 §10.4.1 ranks the *Q-group* survivor by highest **paid**; MPPR's authority is §10.5, which ranks by highest **weight**. Rev 4 applied payment ranking to both.
- **§10.1 — the coinsurance rule read the wrong column** and wrongly declared the statutory copayment cap incomputable. See below.
- **§9.4 / §9.6 — 81 exempt-set codes carry no rate** and had no status, no basis, and no disclosure. And the Ch. 4 SI-based C-APC exclusion list is exactly {U, G, H, F, L}; rev 4's inclusion of S1, H1, and K1 was unsourced, leaving 316 codes with no disposition at all.
- **§8.1 — two of the six shape counts were fabricated.** `\d{5}` is 9,802 (not 12,254) and `[A-V]\d{4}` is 7,455 (not 6,655); the printed table summed to 20,636 against a file of 18,986.
- **§3.1.1 — 24 Q4 codes lack a usable CLFS rate, not 6.** Six are absent; 18 more carry `RATE = 0.00` with `INDICATOR = L`, which §3.1 itself forbids emitting.
- **§7.1 — money-field tokenization was unspecified.** 3,881 `Payment Rate` cells carry thousands separators, all 7,312 carry `$`, and 7,214 `National Unadjusted Copayment` cells hold a literal `.` placeholder. A naive numeric parse yields `NaN` and silently degrades rated codes to "no rate."
- **§19.4 — `termDate` is unsourceable.** Closed; `DELETED` is suspended via the §9.5 mechanism rather than deleted.

**Rev 4 note, retained.** Rev 3 was reviewed against the on-disk source files and the consumer repository. Rev 4 applied those findings. Substantive rev-3 corrections:

- **§2.2 / §8.2** — rev 3 classified SI A as a phase-1 "jurisdictional failure" while also requiring it to be CLFS-priced, contradicting its own rule that a line rejected at phase 1 never receives an amount. Phase-1 outcomes now split into **REJECTED** and **ROUTED**.
- **§2.5** — one fact pass is insufficient; `convertSI` and `bundleUnder` change state that later rules read. Replaced with **fact epochs**.
- **§2.7 / §12.1** — the claim that `837-claim-viewer` can typecheck a plain-`.js` engine under its existing `tsc --noEmit` with no config change is **false**. Replaced with a vendoring mechanism (§12.1).
- **§5.1** — the assumed line shape mismatches the consumer's `ServiceLine` on five of six fields. Corrected, and §19.8 is now closed.
- **§7.2** — integer cents cannot hold 648 Addendum B rates that carry three decimals. Money is now integer **mils**.
- **§8.1** — the valid-shape list omitted PLA (`\d{4}U`) and MAA (`\d{4}M`), which would have RTP'd 555 codes including 226 SI Q4 labs.
- **§9.4 / §10.2** — rev 3 claimed SI K, R, and P lines have no computable amount. Addendum B carries a payment rate for **all 526 K and all 41 R** codes. Only the 4 SI P codes lack one.
- **§10.3** — the three-value `basis` enum could not express outcomes the rest of the doc requires. Now a closed twelve-value vocabulary.
- **§11** — phase 4 was underspecified to the point of being unbuildable. Substantially expanded; term semantics, attribution, and required DSL extensions are now stated.
- **§18** — criteria that were unfalsifiable as written are restated as assertions, and phase 4 has criteria for the first time.
- **§19** — decisions #1 and #8 are **closed** with definite answers.

---

## 1. Purpose

An adjudication engine for hospital outpatient (OPPS) claims, and a tool for inspecting its reasoning. Given the codes on a UB-04 it answers, per line:

1. **Is this line valid as submitted?** (format, existence, fee-schedule jurisdiction)
2. **Does it pay, or does it bundle — and under which line?** (Status Indicator + IOCE packaging order)
3. **Which rules and edits were considered, which fired, and what would have changed the outcome?**
4. **At what benchmark amount?** (secondary — see §10)

Two purposes, in this order:

- **Method.** To establish and document *how* a claim adjudicates, so AB can reason about, dispute, and defend line-level outcomes from an auditable record rather than an assertion.
- **Portability.** To be the reference implementation that gets built into AB's own software (`837-claim-viewer`), with a trace format good enough to verify that reimplementation line by line.

Reference-based-pricing benchmarking is a real output, but a consequence of correct adjudication rather than the point.

### 1.1 Primary users

Bill processing staff at AB, and AB's own developers. Assume domain fluency (they know what an APC and an SI are) but **not** JavaScript. The tool must be operable by pasting codes and reading a table; the engine must be readable by whoever ports it.

### 1.2 Vision and sequencing

**Bundling is the product. Pricing is a later milestone.**

The question the engine exists to answer is: *given this set of codes, how would Medicare OPPS bundle them, and why?* Everything else — national rates, percentage rules, coinsurance, totals, contract terms — is downstream of that answer and is explicitly sequenced after it (§21).

Two consequences worth stating plainly, because they invert how this document reads:

- **§10 (Benchmark) and §11 (Contracts) are not milestone-1 work.** They stay fully specified, because specifying them cheaply now prevents the bundling layer from being built in a way that cannot host them. They are not built first.
- **Bundling nevertheless depends on rates — as ordering keys, not as output.** The controlling J1 is the highest-**paid** J1, and the surviving Q-group line is the highest-**paid** survivor (Ch. 4 §10.4.1). So `rateMils` and `weight` must be loaded in milestone 1 even though no dollar amount is reported. This is the one part of §7 that cannot be deferred, and §21.1 accounts for it.

**Second purpose: divergence context.** Medicare's answer is the benchmark, but AB's counterparty is usually a commercial payer whose bundling differs. The engine therefore annotates its Medicare determination with where a commercial payer is likely to bundle differently, and why — as advisory commentary that never alters the Medicare result (§20). Knowing that Medicare bundles a line and that a given payer probably does not is more actionable to a bill processor than either fact alone.

### 1.3 What this is not

- Not a billing/submission system. It never generates a claim.
- Not a locality pricer. National unadjusted amounts only; wage adjustment is the user's next step.
- Not a coding-advice tool for providers. Output is internal to AB.
- Not a complete edit engine. NCCI PTP and MUE are modeled as reserved slots, not implemented (§9.5).

---

## 2. Engine-first architecture

### 2.1 The engine is the deliverable; UIs are front-ends

```
                    ┌──────────────────────────────┐
                    │   ENGINE  (DOM-free ESM)     │
  claim input  ───► │  registry (JSON rules)       │ ───►  Determination[]
  options      ───► │  evaluator (closed DSL)      │       + facts + trace
  data bundle  ───► │  trace recorder              │
                    └──────────────────────────────┘
                           ▲                ▲
              ┌────────────┘                └────────────┐
   browser tool (this repo)                   837-claim-viewer (TS/Electron)
   paste codes, inspect rules,                vendored copy, fed by its
   print reference tables                     existing 837 parser
```

The engine has **zero** DOM, network, filesystem, and clock access. It is a pure function of `(claim, options, registry, data)`.

**This is a separate program, adjacent to `837-claim-viewer`, not a feature of it.** The two are coupled by a **shared input format**, not by shared source. That reprioritizes §12.1: source vendoring is a later-milestone convenience, and the binding constraint is the claim JSON contract below.

**The engine defines its own input type, and owns its own adapters.** Rev 7 had it consume the viewer's `Claim` model. That is wrong, for a reason discovered by testing a real claim:

> **Institutional claims arrive as XML. Only CMS-1500s arrive as JSON.**

And the viewer has **no XML support at all** — zero XML references in `837-claim-viewer/src`, and its file dialog accepts only `json`, `dat`, `edi`, `txt`, `837`. Its `jsonClaimSource` maps `'1500'` and nothing else, which is not an oversight: the JSON feed only ever carries 1500s. So the viewer cannot open an institutional claim from the clearinghouse feed today, and **there is no existing parser this engine can reuse for the only claim type it cares about.**

Consequences, all of which simplify the design:

- The engine takes a **`ClaimInput`** type it defines itself, in this repo. Not an import from the viewer.
- **The first adapter to write is XML → `ClaimInput`.** It does not exist anywhere yet.
- Coupling to `837-claim-viewer` drops to near zero — a shared *shape* to aim at, not a dependency. That fits "separate program" better than rev 7 did, and it removes the vendoring question from the critical path entirely.
- `837-claim-viewer/src/model/claim.ts` remains the **reference** for field naming and semantics (`ServiceLine`, `Institutional.typeOfBill`, `Payer`), so the two programs describe a claim the same way. §5.1 records those names. An adapter from that model can be written later if the viewer gains XML support.

Adapters, in priority order: **XML institutional** (required for milestone 1), X12 837I (already proven to yield `formType: 'ub04'` and a populated `institutional` block), viewer `Claim` (optional), and a bare code list for the paste box.

**Feed field names differ from the viewer's model**, so adapters must be feed-specific rather than generic. Observed in the institutional XML: line id is `remote_chgid` (not `chgid`); the unit qualifier is `charge_record_type` (`DA` days / `UN` units); lines carry `rev_code` with **no** `proc_code`; there are no per-line dates, only `hosp_from_date`. Attributes are flat on `<claim>`, with repeating `<charge>` children — isomorphic to the JSON feed's flat-plus-`charge`-array shape, differently serialized.

**The adapter is where PHI stops.** The feed carries `pat_name_l`, `pat_dob`, `pat_addr_1`, `ins_number`, `mrn`, `pcn`. None of it reaches the engine. The adapter passes codes, revenue codes, dates, units and their qualifier, charges, modifiers, type of bill, condition/occurrence/value codes, billing taxonomy, and payer identity — nothing else. §14 forbids persisting even what does cross.

Claim-level fields the engine needs, all present in that model:

| Field | Used for |
|---|---|
| `formType` | Must be `'ub04'`. Any other value is a claim-fatal input error (§12.7) — an OPPS engine has nothing to say about a CMS-1500 or a dental claim. |
| `institutional.typeOfBill` | C-APC 8011's 13X restriction (§9.1) |
| `institutional.conditionCodes`, `occurrenceCodes`, `valueCodes` | available for future packaging conditions; not consumed in milestone 1 |
| `institutional.statementFrom` / `statementThrough` | claim period; the fallback when a line supplies no date |
| `payer.name`, `payer.id` | keys the §20 divergence layer |
| `claimId` | correlation only |

**The adapter is where PHI stops.** `Claim` carries `patient.name`, `dob`, `accountNumber`, and `insured` — none of which the engine may receive. The adapter passes codes, dates, units, charges, modifiers, revenue codes, type of bill, and payer identity, and nothing else. §14 forbids persisting even what does cross.

### 2.2 Phases and the two phase-1 outcome classes

Strictly ordered. Each phase receives the previous phase's **determination and fact payload** deep-frozen (§12.3) and may not mutate it.

**The trace is not part of that payload**, and rev 5 was self-contradictory on this point: it froze the prior phase's output while nesting `trace` inside `Determination` and having phases 2, 3, and 4 all append to it. Either the freeze was real and appending was impossible, or the trace was silently exempt and §18.7 asserted less than it claimed. `trace.ts` therefore owns an **append-only journal outside the payload**, keyed by `lineId` and by claim for claim-scoped rules. Phases may write it and may not read it. `Result.determinations[i].trace` and `Result.trace` are assembled from the journal once, at output, and frozen there alongside the §2.4 canonical serialization step. §11.1's guarantee is unaffected — what phase 4 must not alter is phase 3's amounts, which stay inside the frozen payload.

```
INPUT
  ├─► [1] CLASSIFY    format, existence, fee-schedule jurisdiction
  ├─► [2] ADJUDICATE  SI packaging, bundling, edits, exemptions
  ├─► [3] BENCHMARK   Medicare national amount (§10)
  └─► [4] CONTRACT    plan/provider contract terms (§11)
OUTPUT: Determination[] + facts + trace
```

Phase 1 produces two structurally different outcomes, and rev 3's failure to distinguish them was a contradiction:

- **REJECTED** — `MALFORMED`, `INVALID`, `DELETED`, and the non-payable SIs (`B`, `C`, `E1`, `E2`, `M`). The line stops. It never reaches phase 2, 3, or 4, and **never receives an amount**.
- **ROUTED** — SI `A` and SI `Y`. The line is payable but not under OPPS. It **skips phase 2 packaging entirely** and proceeds directly to phase 3, where it is priced if its schedule is Tier 1 (§3.1) or named-only if Tier 2 (§3.2).

A line bundled at phase 2 resolves to `$0.00` and names its controlling line. `$0.00` on a bundled line is an *amount*, deliberately; the §18.5 prohibition applies only to REJECTED lines.

Phase 4 never alters the phase 3 Medicare result. Both amounts survive to output, because "Medicare would recognize X, the contract says Y" is the entire advocacy position.

### 2.3 The routing resolver is shared, not phase-bound

Phase 1 routes SI A and Y. Phase 2 *also* produces routing outcomes, because an unpackaged Q4 line is converted by IOCE to SI A and paid under CLFS (§9.3). A bare `36415` claim is the common path, not an edge case.

Fee-schedule routing is therefore a **shared resolver callable from both phases**, taking a code and an *effective* SI (original or post-conversion) and returning `{schedule, rateMils, basis}`. Neither phase re-enters the other. This is the one deliberate exception to strict forward ordering, and it exists because IOCE behaves this way.

### 2.4 Determinism is a hard requirement

Same inputs must produce a byte-identical trace, or the trace is useless as the porting test (§15.2).

- Every rule carries an explicit integer `order`. Never rely on array or object key order.
- No clock access inside the engine. Dates are passed in per line (§5.1).
- All sorts have explicit tiebreaks (J1 rank: payment desc, then `code` asc — §9.1).
- Money is integer **mils** (1/1000 dollar). No floats in predicates, ever. §7.2.
- No `Math.random`, no locale-dependent formatting, no `Intl` inside the engine.
- Trace serialization is canonical: keys emitted in declared order, no undefined-vs-absent ambiguity. §15.2.

### 2.5 Fact epochs, not a single fact pass

Some rules are claim-relational — MPPR needs "is this the highest-paid T line," J1 control needs "is this the ranked J1." Rev 3 specified one fact pass, which is wrong: `convertSI` changes a line's SI, and `setStatus`/`bundleUnder` change which lines are still live. Rules after those effects must read post-effect facts.

The evaluator therefore runs **fact epochs**. Facts are recomputed at explicit barriers between rule bands:

| Epoch | Recomputed after | Facts available |
|---|---|---|
| `E0` | initial | SI census, code census, per-code unit totals, payment rank orderings, presence flags |
| `E1` | exempt determination (band 1000) | + exempt line set |
| `E2` | J1 / 8011 control (bands 2000–3000) | + controlling line, bundled set |
| `E3a` | companion packaging (band 4000, sub-band a) | + lines bundled by companion trigger |
| `E3b` | Q-group survivor tiebreak (band 4000, sub-band b) | + surviving unpackaged set, effective SI after conversions |
| `E4` | standard disposition (band 5000) | + final live/paid set, for phase 3 ordinal rules |

**Band 4000 needs two epochs, not one.** The Q-group survivor tiebreak (§9.2) must read the results of the companion-packaging rules that precede it in the same band. With a single epoch per band, that rule reads pre-effect facts and `bundleUnder` can name a line that is itself already bundled. Sub-bands are the general mechanism: any band whose later rules depend on its earlier rules' effects declares sub-epochs, and the lint rejects a rule that reads an epoch at or after its own position.

Every `Evaluation` records **which epoch it read** (§5.2). A rule may only read facts from its own sub-band's epoch or earlier; the registry lint enforces this (§15.3), and each band is handed only its own epoch's frozen fact object so the discipline holds by construction rather than by lint alone.

**An `Evaluation` references a fact; it never copies one.** `examined.factRefs` holds `factId` strings resolving in `Result.facts[epoch]`, where each fact is stored once per epoch as `{factId, kind, dimension, values, lineIds[]}`. `examined.subjectLineId` is the line under evaluation; contributing lines live in the fact record, named exactly once.

Auditability is unchanged — the fact still names which line supplied it, and the `Evaluation` names the fact — but the trace becomes O(rules × lines) instead of **O(rules × lines²)**. That exponent is not hypothetical: a 250-line claim whose relational `Evaluation`s inline their contributing sets measures 42.2 MiB minified and 125.2 MiB pretty-printed (6.79M lines), past GitHub's 100 MB per-file limit. The same content gzips to 1.42 MiB, which is the measure of how redundant the inlined form was.

### 2.6 Repository layout

```
/engine/                       ← the deliverable. DOM-free, ESM TypeScript
  registry/
    opps.si.json               SI definitions + dispositions
    opps.packaging.json        J1 / 8011 / Q-group rules
    opps.exempt.json           exempt set
    opps.benchmark.json        §10.1 percentage + coinsurance rules
    edits.reserved.json        NCCI/MUE slots — declared, unloaded (§9.5)
    contracts/<id>.json        contract term sets (§11)
  dsl/
    operators.js               closed operator set; describe() + argSpec each
    evaluate.js                the interpreter
    validate.js                dependency-free schema validation (§12.2)
    freeze.js                  deep freeze (§12.3)
  routing.ts                   the §2.3 shared fee-schedule resolver. A leaf:
                               imports /engine/data only. Must not import
                               phases/ or trace.ts.
  phases/
    classify.ts  adjudicate.ts  benchmark.ts  contract.ts
  trace.ts                     append-only journal + canonical serializer (§2.2)
  inspect.ts                   explain / applicability / diff queries (§6)
  errors.ts                    EngineError + flag manifest (§12.7)
  index.ts                     public API + ENGINE_CONTRACT_VERSION

/data/                         generated — do not hand-edit (§7)
  opps.cy2026.js  clfs.cy2026.js  routing.cy2026.js

/tools/                        build-time only, never shipped
  package.json                 devDependencies: typescript, esbuild, vitest
  gen-data.mjs                 source files → /data/*.ts (§7)
  gen-goldens.mjs              adjudication run → golden projections (§15.2)
  bundle.mjs                   esbuild IIFE → dist/engine.bundle.js (§2.7)
  sync-to-consumer.mjs         vendor engine + registry + data (§12.1)
  lint-registry.mjs            registry invariants (§15.3)
  diff-registry.mjs            rule diff between versions (§6.3)

/dist/
  engine.bundle.js             shipped classic-script build for the browser tool

/web/                          browser front-end
  index.html  css/app.css  js/app.js  js/render.js  js/inspector.js

/test/
  fixtures/                    claim fixtures (§15.1)
  traces/                      <fixture>.structure.json + .amounts.json (§15.2)
  rule-coverage.json           corpus-wide rule x fixture x outcome (§15.4)
```

`routing.cy2026.ts` holds the Tier 2 membership sets (§3.2) — the schedule-name lookup for codes the engine routes but does not price.

**Import direction is stated, not left to discipline:** `index → phases/ → dsl/evaluate → dsl/operators`, with `routing` a leaf above `data`, and `trace`/`inspect` importing `dsl/operators` only. **`dsl/operators` has zero imports** — the composite operators (`allOf`/`anyOf`/`not`) receive an injected `evalNode` callback from the interpreter rather than importing it, which is what keeps `operators` ↔ `evaluate` from being a cycle. Both `phases/classify` and `phases/adjudicate` import `routing`; neither imports the other.

Rev 5 declared the routing resolver "a shared resolver callable from both phases" while listing only the four phase files — which forced it to live inside one phase and be imported by the other, a phase↔phase cycle in exactly the place the spec called a clean seam.

The registry ships **inside** `dist/engine.bundle.js` as frozen literals, inlined by esbuild's JSON loader: under `file://` a classic script carries no `import`, and `fetch`/XHR of a `.json` sibling is blocked. The hand-authored JSON stays the reviewable source of truth and is what `verifyRegistry`, `lint-registry.mjs`, `diff-registry.mjs`, and vitest load directly under Node. §2.1's filesystem prohibition binds the engine, not its host: a thin host-side loader outside `/engine` reads the registry and passes it as the `registry` argument, and §18.2's source scan is scoped to `/engine`.

**Both shipped artifacts are tested against the same goldens.** Two builds from one source is a divergence risk no care in `bundle.mjs` removes, and the bundle is the artifact staff actually run. The golden suite is parameterized over the entry point and runs twice — once against the ESM build, once against `dist/engine.bundle.js` through a shim reading the IIFE global. Byte-identical canonical traces from both, or the build fails.

### 2.7 Build story

The engine is authored **once, as TypeScript**. Rev 5 specified JSDoc-annotated `.js`; that was wrong in four separate ways at once, all of which this single change dissolves (§12.1).

- **The browser tool** loads `dist/engine.bundle.js`, an **IIFE build produced by `esbuild`** (`--format=iife --global-name=OppsEngine --target=es2022 --loader:.json=json`, unminified). **Not a concatenation.** `import`/`export` are syntax errors in a classic script, and §4.3's `allOf`/`anyOf`/`not` composites make `dsl/operators` ↔ `dsl/evaluate` a genuine cycle that flat concatenation resolves into a TDZ `ReferenceError` at load — which is §17 defect 3, the exact failure this rewrite exists to eliminate. It assigns exactly one global: `window.OppsEngine = {adjudicate, inspect, describeBuild, ENGINE_CONTRACT_VERSION, REGISTRY_VERSION, DATA_VERSION}`. `esbuild` is a build-time devDependency in `/tools`, and is already the established bundler in `837-claim-viewer` for its preload build.
- **`837-claim-viewer`** receives the vendored **`.ts` sources** under its own `rootDir`. Its existing `include: ["src", …]` typechecks them under its existing `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` with **no config change**, and its existing bare `tsc` in `build:app` compiles them into `dist/src/engine/` — which the `electron-builder` `files` allowlist (`dist/src/**/*`) already ships.

All engine relative imports carry the `.js` extension (`import { evalNode } from './dsl/evaluate.js'`), satisfying both the consumer's `moduleResolution: "Bundler"` and Node ESM, and matching the consumer's existing convention.

The distinction that keeps §18.1 honest: **the shipped browser artifact requires no server and no build at run time; the repo has build-time tooling.** §18.1's no-build requirement was always scoped to the shipped artifact, and that artifact was already produced by a build step — which is why authoring in TypeScript costs nothing against it.

---

## 3. Fee schedules in scope

Normative.

### 3.1 Tier 1 — priced in-tool

| Schedule | Why | Source | Coverage |
|---|---|---|---|
| **OPPS / APC** | The subject. National unadjusted rate. | `data files in format/ASC - Ambulatory Surgical Center/508 Version 2026 January Web Addendum B/2026 January Web Addendum B.12.29.25.csv` | 18,986 codes; **7,312** carry a payment rate |
| **CLFS** | Mandatory, see §3.1.1. National single rate, no locality or facility adjustment. | `data files in format/CLFS - Clinical Lab Fee Schedule/clfs-cy2026-q2v1/PUF_CLFS_CY2026_Q2V1.csv` | **2,179 records over 2,055 distinct codes** |

**CLFS is records, not codes.** 124 rows carry modifier `QW` (CLIA-waived) as a second row for the same HCPCS. The record shape (§7.2) therefore needs a modifier dimension; a code-keyed map silently drops one of each pair.

**49 CLFS rows carry `RATE = 0.00`, all with `INDICATOR = L`.** These must never emit a `$0.00` benchmark — that is precisely the fabricated value §10.4 forbids. They resolve to `PAID_UNPRICED` with the indicator surfaced. Confirm what `L` denotes against `PUF CLFS CY2026 Q2V1.pdf` in the same folder before shipping; the file contains only `N` (2,130) and `L` (49).

#### 3.1.1 Why CLFS is mandatory

1,346 SI Q4 codes carry no OPPS rate. An unpackaged Q4 converts to SI A and pays CLFS (§9.3), so a single-line lab claim is routine:

| Code | Addendum B | CLFS | Bare-claim outcome |
|---|---|---|---|
| `36415` | Q4, no APC, no rate | $9.34 | converts to A → CLFS $9.34 |
| `84112` | Q4, no APC, no rate | $98.11 | converts to A → CLFS $98.11 |
| `81001` | Q4, no APC, no rate | $3.17 | converts to A → CLFS $3.17 |

Name-only CLFS returns `—` on the most frequently disputed line type AB handles.

**Twenty-four Q4 codes have no usable CLFS rate**, in two distinct classes rev 4 collapsed into one undercount of six:

- **Absent from CLFS (6):** `0602T`, `0603T`, `81099`, `84999`, `85999`, `88749`. Four are unlisted/not-otherwise-specified laboratory codes, which Medicare pays by **contractor pricing** rather than not at all — the determination should say "contractor-priced," not "no rate." The two CPT III codes carry SI Q4 while being absent from CLFS, which contradicts Ch. 4's definition of the Q4 population; that is a **data anomaly the engine names** rather than a lookup miss.
- **Present at `RATE = 0.00` / `INDICATOR = L` (18):** `0526U`, `0531U`, `0541U`, `0542U`, `0573U`, `0574U`, `0590U`, `0594U`, `0596U`, `0600U`, `0601U`, `0602U`, `0603U`, `0604U`, `0606U`, `0609U`, `0610U`, `87182`. §3.1 forbids emitting these as `$0.00`, so they are unpriced despite having a CLFS row — and they are indistinguishable from a bundled line's `$0.00` unless `basis` and `status` carry the difference.

All 24 resolve to `PAID_UNPRICED` with a reason-specific flag, appear in the §10.2 disclosure, and §15.1 fixtures one from each class.

### 3.2 Tier 2 — identified and routed, never priced

| Schedule | Reached via | Why not priced | Membership source |
|---|---|---|---|
| MPFS | SI A | Needs GPCI locality + facility/non-facility election. Excluded by §16. | `RVU - Relative Value Units/PPRRVU2026_Jan_nonQPP.csv` |
| DMEPOS | SI A, SI Y | Needs rural ZIP + former-CBA status. Excluded by §16. | `DME - Durable Medical Equipment/DMEPOS26_JAN.csv` |
| Ambulance (AFS) | SI A | Needs GPCI + rural ZIP. Excluded by §16. | `ASC - Ambulatory Surgical Center/Copy_of_AFS2026_PUF_ext.xlsx` |

Of 2,008 SI A codes, **672 are in CLFS** (Tier 1, priced). The remaining 1,336 route to Tier 2 or resolve to `null` schedule.

**SI K, R, and G are no longer here.** See §9.4 — Addendum B prices them.

The Tier 1 / Tier 2 line is one test: **can the correct national amount be produced without asking for a geography or a provider attribute?**

### 3.3 Tier 3 — out entirely

ASC · IPPS/MS-DRG · ESRD PPS · FQHC PPS · RHC AIR · Anesthesia CF · Hospice · HHA PPS · SNF PPS · IPF/IRF/LTCH PPS · CAH cost-based · ADLT.

Several have complete CY2026 data in this folder. Presence is not scope.

### 3.4 `schedule` is computed, not curated and not stored

**Corrected in rev 11.** Earlier revisions made `schedule` a generated per-code column. That was wrong: **`schedule` is not a property of a code**, it is a function of `(code, effectiveSI)`. A Q4 lab code's schedule is `CLFS` only *after* conversion to A (§9.3); before that it is an OPPS line. A code-level column is therefore ill-defined for exactly the codes that matter, and a stale one could be matched by an `inSchedule` scope selector.

What is **generated** is the membership sets — CLFS, DMEPOS, AFS, MPFS. What is **computed at call time** is the resolution, by `routing.resolve(code, effectiveSI)` (§2.3).

Precedence, first match wins. **Step 1 tests the passed effective SI**, and exists so that 10 OPPS-rated SI Q1 codes present in CLFS are not misrouted:

1. Has an OPPS payment rate in Addendum B **and** an SI that pays its own APC → `OPPS`, stop.
2. In CLFS → `CLFS`
3. In DMEPOS → `DMEPOS`
4. In AFS → `AFS`
5. In MPFS with non-zero total RVU → `MPFS`
6. No match → `null`, degrading per §10.4

Rev 3's precedence began at CLFS, which would label **10 OPPS-rated SI Q1 codes** as `schedule = "CLFS"` and misroute lines §9.2 says pay their own APC.

Derivation is scoped to lines that actually need routing (effective SI `A` or `Y`); it is not a global relabeling of every code.

The generator emits a per-bucket count and the list of unmatched routed codes to the build log. A growing unmatched count means a source file changed shape.

`alt` (§7.2) stays curated but is small — the office/outpatient E/M → `G0463` map is substantially all of it.

### 3.5 Verified against source

Checked by direct file read. Counts are from the January 2026 Addendum B and CLFS CY2026 Q2V1.

**SI coverage.** All 28 SIs present receive a disposition: `A`/`B`/`C`/`E1`/`E2`/`Y`/`M` in §8.2; `J1`/`J2`/`Q1`/`Q2`/`Q3`/`Q4` in §9.1–§9.3; `S`/`T`/`V`/`N`/`R`/`K`/`P`/`G`/`U`/`H`/`L`/`F`/`S1`/`H1`/`K1` in §9.4; and `U`/`G`/`H`/`F`/`L` are additionally exempt from C-APC packaging per §9.6. Coverage means an assigned status **and** basis, not merely an exemption — rev 4 satisfied itself with the latter and left 316 codes with no payment outcome. No unhandled SI; no legacy `D`. Counts: J1 3445 · N 2076 · A 2008 · M 1549 · C 1438 · Q4 1346 · E1 1334 · T 1052 · B 1017 · Y 778 · Q1 741 · S 674 · K 526 · S1 298 · Q3 183 · Q2 177 · G 117 · L 48 · E2 43 · R 41 · V 23 · H 19 · U 17 · H1 13 · J2 13 · K1 5 · P 4 · F 1.

**Spot values.** `99205` SI B, no APC, no rate. `G0463` SI J2, APC 5012, weight 1.4879, $136.02, min copay $27.21. `59025` SI T, APC 5411, weight 2.2595, $206.55. `99284` SI J2, APC 5024, weight 4.6634, $426.30. `G0378` SI N. CLFS: `36415` $9.34, `84112` $98.11, `81001` $3.17.

**Data hygiene hazards the generator must handle** — all confirmed present, all silent-corruption risks:

| Hazard | Extent | Consequence if unhandled |
|---|---|---|
| Rates with three decimal places | **648** of 7,312 | Integer cents truncates. §7.2 uses mils. |
| Code field with trailing `0xFF` byte | **2** rows: `A4341` (SI N), `G0465` (SI T) | Two real codes become unreachable and classify `INVALID`. |
| Rated codes with **no** relative weight | **702** — `K` 526, `G` 117, `S` 46, `T` 8, `K1` 5 | Weight-ranked selectors are undefined on these. 54 fall in Q-trigger SIs; the 8 SI T codes matter most, because MPPR ranks by weight (§9.4) and must declare `fallbackField: "rateMils"`. The same 702 are the non-conversion-factor-derived set that OQR and PN must skip (§10.1). |
| CLFS modifier-qualified duplicate rows | **124** (`QW`) | A code-keyed map drops one of each pair. |
| CLFS zero-rate rows | **49**, all `INDICATOR = L` | Emits a fabricated `$0.00`. |
| CLFS rows effective 20260401 | **17** — `0614U`–`0630U` | See below. |
| Duplicate HCPCS keys in Addendum B | **0** | — |

**The vintage mismatch is concrete and narrow.** CLFS Q2V1 differs from the January Addendum B by exactly 17 codes: `0614U` through `0630U`, all PLA, all `EFF_DATE = 20260401`, and all absent from the January Addendum B. This single set of 17 codes is simultaneously (a) the entire practical content of the quarter-vintage question in §19.1, (b) the reason `INVALID` cannot be tested against Addendum B alone (§8.1), and (c) 17 of the 555 codes rev 3's shape patterns would have rejected as `MALFORMED` (§8.1).

**No NCCI, MUE, or IOCE edit files exist in this folder.** Confirmed by search. Hence §9.5 reserves slots rather than implementing edits.

---

## 4. Rule registry and the condition DSL

**Rules are data, not code.** One source, two consumers: the evaluator executes the registry, the inspector (§6) reads it.

### 4.1 Why declarative is non-negotiable

Written as control flow, a rule can be run and observed but not enumerated, counterfactualized, or diffed against last quarter. All three are stated requirements. Declarative rules give all three from the same data.

### 4.2 Rule shape

```json
{
  "id": "OPPS.PKG.Q4.COMPANION",
  "version": "2026.1",
  "effectiveFrom": "20260101",
  "effectiveTo": null,
  "phase": "ADJUDICATE",
  "band": 4000,
  "subBand": "a",
  "order": 4200,
  "epoch": "E2",
  "scopeTarget": "line",
  "citation": "Pub 100-04 Ch.4 §10.4; IOCE conditional packaging",
  "scope":  { "op": "siIn", "args": { "si": ["Q4"] } },
  "when":   { "claimContainsAny": { "si": ["J1","J2","S","T","V","Q1","Q2","Q3"] } },
  "then":   [ { "setStatus": "BUNDLED" },
              { "bundleUnder": { "highestBy": "rateMils",
                                 "among": { "siIn": ["J1","J2","S","T","V","Q1","Q2","Q3"] },
                                 "tiebreak": "codeAsc" } } ],
  "note": "Q4's trigger list includes J2 even when C-APC 8011 did not fire; Q1's does not. On a bare G0463 claim a Q4 lab bundles while a Q1 line pays. This asymmetry is correct — see OPPS.PKG.Q1.COMPANION."
}
```

`order` is an explicit integer with gaps so a rule can be inserted without renumbering. `band` and `subBand` group rules for epoch purposes (§2.5). `epoch` declares which fact set the rule reads; lint rejects a rule reading an epoch at or after its own position. `id` is the stable identifier AB's software will reference — treat it as public API and never reuse one for different logic.

**`scopeTarget` is required, and it is `"line"` or `"claim"`.** A line-scoped rule is evaluated once per admitted line. A **claim-scoped** rule is evaluated exactly once, emits exactly one `Evaluation` into `Result.trace`, and may write only `Result.claimAmounts`, `Result.disclosures`, and a `flag` replicated onto every determination with the rule id recorded. Without this distinction C-APC 8011, `perDiem`, `caseRate`, `stopLoss`, and the §10.2 disclosures would each fire once per line and apply their effects N times.

**Ranking authority differs by rule, and rev 4 conflated them.**

- **Q-group survivor** (§9.2) ranks by **payment** — Ch. 4 §10.4.1, "highest paid."
- **MPPR** (§9.4) ranks by **relative weight** — Ch. 4 §10.5.

Every ranking selector names an explicit `tiebreak`. Because 8 rated SI T codes carry no relative weight (§3.5) — all New Technology APCs at fixed amounts — a weight-ranked selector must declare a `fallbackField`, and MPPR declares `fallbackField: "rateMils"`. A ranking selector with no fallback that encounters a null `field` is a hard error, never a silent skip.

### 4.3 The closed operator set

Deliberately small, enumerable, describable, and reimplementable. **Adding an operator is a spec change, not an implementation detail.**

**Scope selectors** (line-scoped rules): `always` · `siIn` · `codeIn` · `codePattern` · `apcIn` · `not`

**Scope must be statically decidable from a code alone — corrected in rev 14.** Rev 13 listed `statusIn` and `isExempt` here, and the shipped registry additionally used `isHighestBy` in a `scope`, which was never in the list at all. All three depend on claim state, and putting them in `scope` breaks applicability mode (§6.2): a query with no claim cannot decide them, so **every** Q-group and J1 rule landed in an "undecidable" bucket instead of answering the question the mode exists to answer.

The division is now clean: **`scope` = what this rule can ever touch, decidable from the code and its data alone. `when` = everything claim-dependent.** A claim-relational or status-dependent predicate in `scope` is a lint error (§15.3).

This costs nothing behaviourally. `not(statusIn(['BUNDLED']))` moved into `when` still gates firing, so it still prevents the cross-band `setStatus` overwrite that §4.3 makes an error — it is load-bearing and it keeps working. What changes is that applicability mode's `admitted` list becomes exact rather than empty.

`not` is valid in `scope`, not only in `when`. Without it, §9.1's "all **non-exempt** lines bundle into the ranked J1" is inexpressible: enumerating "every SI except the exempt ones" is not a workaround, because §9.6's category-based exemptions and the New Technology APC rule are not SI-derivable. `isExempt` reads the E1 exempt-line fact; rev 4 had `exempt` only as an *effect*, with nothing able to test it.

**Claim-scope selectors** (valid only when `scopeTarget` is `"claim"`): `claimAlways` · `claimContainsAny` · `claimContainsNone` · `claimContainsCode` · `claimUnitsAtLeast` · `claimLineCountAtLeast` · `claimMoneyAtLeast` · `optionIs` · `optionAtLeast` · `optionUnknown`

**Line-local conditions:** `always` · `siIs` · `siIn` · `codeIn` · `statusIn` · `hasModifier` · `ncciPtpBundled` · `unitsAtLeast` · `hasRate` · `hasWeight` · `inSchedule` · `isExempt` · `chargeAtLeast`†

`ncciPtpBundled` (U28) is line-local like `hasModifier`, not claim-scope, even though its underlying fact is computed from every other line on the claim — the cross-line lookup happens once, in the phase layer (`src/phases/classify.ts`), before the DSL ever runs; the operator itself reads only `subject.ncciPtp`, a precomputed per-line fact, the same shape as any other line-local read.

`statusIn` was listed in §4.3.1's argument table but in none of these category lists until rev 15, even though it is implemented and load-bearing — per §4.3's own rule that adding an operator is a spec change, an operator absent from every category list is not formally in the closed set at all. It belongs here, in `when`, never in `scope` (see the rev-14 note above).

`always` evaluates true — the rule fires on scope alone, which §9.4's `N` and `S` dispositions and §9.2's Q3 flag all require. Rev 4 listed `always` only as a scope selector, leaving no unconditional predicate.

**Claim-level conditions** (read from the declared epoch): `claimContainsAny` · `claimContainsNone` · `claimContainsCode` · `claimUnitsAtLeast` · `claimLineCountAtLeast` · `claimMoneyAtLeast`† · `claimDayCountAtLeast`†

† **Declared but not implemented in milestone 1 — recorded in rev 15.** `chargeAtLeast`, `claimMoneyAtLeast` and `claimDayCountAtLeast` are money-bearing, and milestone 1 reports no dollar amounts (§1.2), so `operators.ts` deliberately omits them and says so in its header. They are listed here because they are part of the intended closed set, and marked because **a rule authored against them will fail validation today.** Per §9.5's own principle — a deferred rule must still declare itself rather than be silently absent — an operator the spec offers and the engine does not implement has to be visibly marked, or the next author to reach for one discovers the gap as a load-time error with no hint it was intentional. The same applies to `setAmount`, `multiply`, `setCoinsurance`, `carveOut`, `exclusion` and `lesserOfCandidates` wherever later sections name them.

`claimUnitsAtLeast: {code?: string, si?: string[], units: int}` — sums `units` across all lines matching `code` or `si` at the read epoch; exactly one of `code`/`si` is required. Rev 4 listed the name with no argument shape, so 8011's "≥8 units of `G0378`" leg was unwritable.

**Relational conditions:** `isHighestBy` · `isNotHighestBy` · `ordinalIs` · `ordinalAtLeast`

All take `{field, among, tiebreak, fallbackField?}`; the ordinal forms add `{equals: int}` / `{atLeast: int}` and evaluate to a **boolean**. Rev 4's `ordinalBy` returned a rank position, which cannot appear in a `when` — a `when` decides FIRED/NOT_FIRED (§5.3) and the closed set has no comparison wrapper. The raw rank is recorded in `Evaluation.examined.ordinal` so the trace shows why the rule fired.

`field` is a closed vocabulary: `rateMils` · `weight` · `chargeMils` · `unitCount`. `among` is a scope selector object; if the subject line is **not** a member of `among`, every relational condition evaluates **false** and records `examined.subjectInAmong: false` — it is never an error and never vacuously true.

**Context conditions:** `optionIs` · `optionAtLeast` · `optionUnknown` · `dosOnOrAfter` · `dosBefore`

`optionAtLeast` and `optionUnknown` are required because §13.2 sources G0378 units from the options row and §10.4 requires a flag when the value is not supplied; equality alone could express neither.

**Reserved condition:** `unimplemented: {reason}` — never fires, forces `outcome: "NOT_EVALUATED"`, legal only on a rule carrying `dataRequired` (§9.5). It ships `describe()` and `argSpec` like any other operator. Rev 4's §9.5 example used `$unimplemented`, which was not in the closed set and would have failed the §15.3 lint on the spec's own registry.

**Composition:** `allOf` · `anyOf` · `not`

**Effects:** `setAmount` · `setBasis` · `setStatus` · `setCoinsurance` · `bundleUnder` · `convertSI` · `route` · `multiply` · `exempt` · `carveOut` · `exclusion` · `flag` · `stop`

- **`setAmount: {target, valueMils | fromField}`** and **`setBasis: {value}`** — rev 4 had no effect capable of writing an amount or a basis, which made every pricing rule in §6.2, §9.1, §9.3, §9.4, §10.1, and §11.3 inexpressible. `target` is `medicareMils` · `contractMils` · `coinsuranceMils` · `claimMedicareMils` · `claimContractMils`.
- **`setCoinsurance: {fromField | valueMils}`** — `fromField` is `adjCopayMils` · `minCopayMils` · `iraPct`. See §10.1.
- **`multiply: {target, factor: {num, den}}`** — a rational, not a decimal. See §10.1 stacking.
- **`route: {}`** is a **structural marker**, not a computation. It records that the line is routed; the *phase* then calls `routing.resolve(code, effectiveSI)` (§2.3). The interpreter never imports `routing` — that keeps the module graph acyclic, and since §3.4 computes schedule at call time, the interpreter's call time is the wrong moment regardless.
- **`carveOut: {fromTerm}`** and **`exclusion: {}`** — phase 4 only (§11.3). Rev 4's §11.6 enumerated required extensions that were never added here; `carveOut` had no effect at all and `lesserOf` had nothing to compare.
- **`lesserOfCandidates: {candidates: [termId]}`** — writes the minimum of the named terms' recorded amounts. Each term's own amount is retained in `Evaluation.effect.amountMils` so `lesserOf` has something to read.

**Conflict resolution — per effect, and across bands.**

| Effect | Rule |
|---|---|
| `setStatus` | Last-writer-wins by `order`, **within a band only**. A cross-band overwrite is a lint error, so band 5000 cannot un-bundle what band 2000 bundled. |
| `bundleUnder`, `convertSI`, `route`, `setBasis` | First-writer-wins; a second write is a lint error. These are structural determinations, not adjustments. |
| `setAmount`, `setCoinsurance` | Last-writer-wins, superseded value recorded. |
| `multiply` | Accumulates in `order` sequence. |

A rule may declare `"exclusive": true`, making any later same-band write of the same effect a lint error rather than a silent override. Every superseded write records `supersededBy` (§5.2).

**`stop`** halts evaluation for that line within its phase, **except** for rules declaring `alwaysEvaluate: true` — which every band 6000 rule does. The flag is per **rule**, not per band: nothing else in the design reifies a band as an object with properties, and registry lint checks a band's rules declare it consistently. Otherwise a `stop` in band 5000 would skip the reserved edit slots and make §18.18 unsatisfiable. Lines skipped by `stop` record outcome `SKIPPED` (§5.3).

#### 4.3.1 Operator signatures — declared, not implied

**Added in rev 11.** Rev 10 gave two worked examples with different argument shapes (`"siIn": ["Q4"]` bare, `"claimContainsAny": {"si": [...]}` named) and never stated the rule connecting them. Both examples were in fact correct; what was missing was the *declaration*, without which a registry loader cannot deep-validate operator arguments at all. Found by building the validator: it rejected this document's own example rule.

**Node form is `{op, args}` — recorded in rev 14 to match the implementation.** A registry node names its operator in an `op` field and its arguments in `args`, e.g. `{"op": "siIn", "args": {"si": ["Q4"]}}`. Rev 12's examples used a single-key form (`{"siIn": {...}}`); the built registry uses `{op, args}`, which is unambiguous, uniform across nesting, and trivially validatable. The spec follows the implementation here because the implementation is better.

**The rule (revised in rev 13): every operator takes a named-object argument, uniformly.** `{"siIn": {"si": ["Q4"]}}`, never `{"siIn": ["Q4"]}`. Rev 11 allowed a bare payload as an authoring convenience. That is reversed, on evidence rather than taste: a rule authored per the bare-form table **passed load-time validation, faulted at evaluation, and reported itself as an unrelated failure** in the trace's counterfactual dedup, because different lines halted at different rules. Valid at load, broken at run, diagnosed somewhere else — the worst failure shape available. One uniform form removes the normalizer, removes the ambiguity between a bare array and a malformed named object, and lets the validator check payloads at load time (§12.2). The redundancy of `{"si": [...]}` under `siIn` is a small price. Signatures are part of the closed set — adding or changing one is a spec change.

**There is no bare form and no normalizer — corrected in rev 15.** Earlier revisions described a per-operator `normalizeArgs(raw)` accepting either the bare or the named form, called by the registry loader. **That mechanism was never implemented and no longer should be:** `normalizeArgs` does not exist anywhere in `operators.ts`, and every operator's `evaluate`/`describe`/`argSpec` accepts ONLY the named-object form. `dsl/validate.ts` enforces exactly that at load time, raising `REGISTRY_SCHEMA_INVALID` on a bare or otherwise malformed payload, checked through each operator's own `argSpec()`. `src/registry/loader.ts` documents this too. Argument-shape knowledge therefore lives in exactly one place — `operators.ts` — which is what the deleted paragraph was trying to achieve by a more complicated route.

| Operator | Argument |
|---|---|
| `always` · `claimAlways` · `isExempt` · `hasRate` · `hasWeight` · `exempt` · `stop` · `route` · `ncciPtpBundled` | `{}` — no arguments |
| `siIs` | `{si: string}` |
| `codePattern` | `{pattern: string}` |
| `setStatus` | `{status: Status}` |
| `optionUnknown` | `{option: string}` |
| `dosOnOrAfter` · `dosBefore` | `{date: string}` |
| `unitsAtLeast` | `{units: number}` |
| `claimLineCountAtLeast` | `{count: number}` |
| `siIn` | `{si: string[]}` |
| `codeIn` | `{code: string[]}` |
| `apcIn` | `{apc: string[]}` |
| `statusIn` | `{status: string[]}` |
| `inSchedule` | `{schedule: string[]}` |
| `hasModifier` | `{modifier: string}` — one modifier, not an array |
| `claimContainsCode` | `{code: string}` — one code, not an array |
| `not` | a condition node |
| `allOf` · `anyOf` | an array of condition nodes |
| `claimContainsAny` · `claimContainsNone` | `{si?: string[], code?: string[]}` — at least one required |
| `claimUnitsAtLeast` | `{code?: string, si?: string[], units: number}` — exactly one of `code`/`si` |
| `isHighestBy` · `isNotHighestBy` | `{field, among, tiebreak, fallbackField?}` |
| `ordinalIs` | `{field, among, tiebreak, fallbackField?, equals: number}` |
| `ordinalAtLeast` | `{field, among, tiebreak, fallbackField?, atLeast: number}` |
| `optionIs` | `{option: string, equals: JsonValue}` — the field is `equals`, not `value` |
| `optionAtLeast` | `{option: string, atLeast: number}` — the field is `atLeast`, not `value` |
| `unimplemented` | `{reason: string}` |
| `bundleUnder` | `{highestBy, among, tiebreak, fallbackField?}` |
| `convertSI` | `{to: string}` |
| `setBasis` | `{value: Basis}` |
| `flag` | `{code: string, severity: FlagSeverity, message: string}` — `message` is required |

**`route` takes no arguments.** A rule cannot name a target schedule, because per §3.4 the schedule is *computed* from `(code, effectiveSI)` by `routing.resolve()`. A rule that could force a schedule would reintroduce exactly the stale-derived-value problem rev 11 removed.

**`codePattern` is glob syntax — `*` and `?` — not a regular expression.** Registry rules are hand-authored JSON; a raw regex there invites catastrophic backtracking and is harder to read in generated reference tables. Glob covers every case the registry needs.

**`dimension` gains `rate` and `weight`** in §4.4's vocabulary, so `hasRate` and `hasWeight` have an honest home rather than omitting the field or being forced into a misleading bucket.

### 4.4 Every operator ships `describe()` and `argSpec`

`describe()` returns plain English; `argSpec` returns the operator's arguments in machine-readable form.

```js
claimContainsAny.describe({si:["S","T","V"]})
// → "the claim also contains a line with status indicator S, T, or V"
claimContainsAny.argSpec({si:["S","T","V"]})
// → { kind: "claimPresence", dimension: "si", values: ["S","T","V"], negated: false }
```

Prose alone is insufficient: §13.1 requires the SI × companion matrix to be **generated** from the registry, and a matrix cannot be built from sentences. Registry lint fails the build if any operator in use lacks either function.

**`argSpec` output is a closed vocabulary**, or §13.1's generated tables and §18.20's assertion cannot be implemented and the lint can only check that the function exists.

```
{ kind, dimension?, values?, negated?, field?, threshold?, target? }
```

`kind` ∈ `linePredicate` · `claimPresence` · `claimQuantity` · `relational` · `context` · `composite` · `reserved` · `effect`. **Effects ship `argSpec` too** — the bundling grid needs to render what a rule *does*, not only when it fires. `dimension` ∈ `si` · `code` · `apc` · `schedule` · `status` · `modifier` · `option` · `units` · `money` · `date` · `rate` · `weight`.

Composite operators (`allOf`/`anyOf`/`not`) return `kind: "composite"` with a `children` array of `argSpec` objects, so a consumer can walk the whole condition tree.

### 4.5 Versioning

Rules version alongside data. A rule carries `version` and an effective window; the loader selects the set applicable to the line's date of service (§5.1 — dates are per line, not per claim).

- If a line's date falls outside the loaded window, the engine emits a `flag`. It never guesses.
- A rule whose logic changes gets a new `version`, not an in-place edit, so historical determinations stay reproducible.

---

## 5. The determination record

The engine's output, and the artifact everything else is built on.

### 5.1 Shape, and the consumer mismatch

Rev 3 assumed `{ seq, code, modifiers[], units, revCode?, charge? }`. The consumer's actual `ServiceLine` (`837-claim-viewer/src/model/claim.ts`) matches on **one** field. The adapter must resolve:

| Engine needs | Consumer has | Mismatch |
|---|---|---|
| line identity for `bundledUnder` | *nothing* — `ServiceLine` has no sequence number | Use array index in `serviceLines[]`, or `chargeId`. **Must be decided; `bundledUnder` is meaningless without it.** |
| `code` | `procCode` | rename |
| `units` (number) | `units` (**string**) | parse + validate; the parser also discards the X12 unit-of-measure qualifier |
| `revCode` | `revenueCode` | rename |
| `charge` (optional) | `charge: number`, required, dollars as float | required, and must convert to mils |
| `modifiers[]` | `modifiers: string[]` | matches |
| date of service | `fromDate` / `thruDate` **per line** | dates are per line, not claim-level as §13.2 assumed |

```js
Determination {
  lineId:       "0",           // array index or chargeId — see above
  line:         { procCode, modifiers[], units, fromDate, thruDate,
                  revenueCode?, chargeMils },
  resolvedSI:   "Q4",          // as found in the data
  effectiveSI:  "A",           // after any convertSI effect
  status:       "ROUTED",      // closed vocabulary below
  disposition:  "ROUTED",      // REJECTED | ROUTED | ADJUDICATED
  bundledUnder: null,          // lineId of the controlling line
  basis:        "CLFS",        // closed vocabulary, §10.3
  amounts:      { medicareMils: 9340, contractMils: null,
                  coinsuranceMils: 0 },
  flags:        [ ... ],
  trace:        Evaluation[]
}
```

**`status` closed vocabulary** — rev 3 never enumerated it and scattered inconsistent values across five sections:

`PAID` · `PAID_EXEMPT` · `PAID_UNPRICED` · `BUNDLED` · `ROUTED` · `NOT_PAID_RECODE` · `NOT_PAID_INPT_ONLY` · `NOT_PAID` · `PACKAGED` · `MALFORMED` · `INVALID` · `INVALID_HISTORICAL` · `NO_PROCEDURE_CODE` · `DELETED` · `NOT_ADJUDICATED` (engine-emitted, not rule-emitted — §12.8)

`disposition` is `REJECTED` · `ROUTED` · `ADJUDICATED` · `ENGINE_ERROR`.

Display labels (§10.3 chips) map from these; the engine never emits a display string.

**Claim-level container.** `perDiem`, `caseRate`, and `stopLoss` outcomes are claim-level and have nowhere to land in a per-line record. The engine returns:

```js
Result {
  determinations:  Determination[],
  facts:           { E0..E4 },      // each fact names contributing lineIds once
  claimAmounts:    { medicareMils, contractMils, basis, attribution },
  disclosures:     Flag[],          // §10.2, §12.7
  scopeExclusions: [{ ruleId, excludedLineIds[] }],   // §5.3a
  counterfactuals: { [ruleId]: string },              // §5.3a
  errors:          EngineError[],                     // §12.7
  engineStatus:    'OK' | 'PARTIAL',                  // §12.8
  provenance:      { dataVersion, registryVersion, contractVersion },
  meta:            { validate, traceLevel, build },   // §12.2, §5.3a
  trace:           Evaluation[]     // claim-scoped rules only
}
```

**`EngineOptions`** — referenced across §5.3a, §12.2, and §13.2 but never declared until rev 11:

```ts
EngineOptions {
  traceLevel: 'fired' | 'standard' | 'full';        // default 'standard'  §5.3a
  validate:   'inputs' | 'boundaries' | 'off';      // default 'boundaries' §12.2
  claimIds?:  string[];                             // §2.1 — never derived from feed PHI
  assertions: {                                     // user-asserted conditions, §10.1
    offCampusPbd?: 'excepted' | 'nonExcepted';
    is340B?: boolean;
    oqrFailure?: boolean;
    g0378Units?: number | 'unknown';                // 'unknown' drives the §10.4 flag
  };
}
```

Everything under `assertions` defaults to absent, which means "not asserted" — never "false". The distinction matters: an unasserted 340B status is unknown, and §10.4 forbids inferring one.

Entry point: `adjudicate({claim, options, registry, contracts, data}): Result`, throwing only `EngineError` and only with a load-time code (§12.7).

### 5.2 The Evaluation record

```js
Evaluation {
  ruleId:         "OPPS.PKG.Q4.COMPANION",
  ruleVersion:    "2026.1",
  phase:          "ADJUDICATE",
  band:           4000,
  order:          4200,
  epoch:          "E2",              // which fact set was read
  citation:       "Pub 100-04 Ch.4 §10.4",
  scopeTarget:    "line" | "claim",
  examined:       { si: "Q4", factRefs: ["E3a:siCensus:J1J2STVQ1Q2Q3"],
                    subjectLineId: "2", ordinal: null, subjectInAmong: true },
  predicate:      { claimContainsAny: { si: [...] } },
  outcome:        "NOT_FIRED",
  effect:         null,
  supersededBy:   null,              // set when a later rule overwrote this effect
  counterfactual: "would fire if the claim also contained a line with status indicator J1, J2, S, T, V, Q1, Q2, or Q3"
}
```

### 5.3 Outcome vocabulary

`FIRED` · `NOT_FIRED` · `NOT_EVALUATED` (rule exists, backing data not loaded — §8.1, §9.5) · `NOT_REACHED` (line stopped in an earlier phase) · `SKIPPED` (a `stop` earlier in this phase halted evaluation — §4.3) · `ERRORED` (§12.8) · `RETIRED` (§4.5).

`NOT_APPLICABLE` is **removed** — a scope exclusion is not a consideration, and recording one per line per rule was the largest single source of trace volume. See §5.3a.

`NOT_REACHED` is new. Rev 3's §18.13 required reserved NCCI/MUE slots to appear on *every* determination while §2.2 stopped rejected lines before reaching them — with no vocabulary for that state.

**Rules that did not fire are recorded.** Non-negotiable. A rule considered and passed over appears with `NOT_FIRED` and its counterfactual. Recording only what fired makes silence indistinguishable from an absent rule, a scoped-out rule, or a bug.

### 5.3a Trace levels, and the bound on what is recorded

**A scope exclusion is not a consideration.** A rule whose `scope` excludes the line produces **no per-line `Evaluation`**; it is recorded once per claim in `Result.scopeExclusions` as `{ruleId, excludedLineIds[]}`. The remaining outcomes stay per line, which keeps §18.18 and §9.5 true as written.

`options.traceLevel` is `fired` · `standard` (default) · `full`:

- **`fired`** — `FIRED` entries only. What §6.1 and §13.1 render before expansion, and what crosses IPC by default (§12.9). Never legal for a committed golden.
- **`standard`** — all per-line outcomes, with `counterfactual` replaced by `counterfactualRef` — **the rule id**, which is the key into `Result.counterfactuals`. One counterfactual per rule, never per line. A counterfactual is a function of the rule's `when` clause and its operators' `describe()` output, **not of the line** — which is exactly why §6.2 can generate one from a code with no claim supplied. Emitting it once per line per rule was pure amplification: 117 of the §5.2 example's 490 minified bytes.
- **`full`** — `standard` with counterfactuals inline and scope exclusions per line. Legal only within the §15.2 budget.

**The audit default does not move.** §5.3's requirement that non-firing rules be recorded is a product requirement, not a performance setting — a default that omits `NOT_FIRED` would mean the artifact AB disputes from is by default not the auditable one. What is cut is amplification, not the record.

**The resulting bound.** Roughly 25 rules admit a given line; × 250 lines = 6,250 `Evaluation`s; at 373 B minified that is ≈ **2.33 MiB**, against 42.2 MiB for the rev-5 encoding. §18.29 asserts a **4 MiB** ceiling with the measured figure recorded in the build log.

### 5.4 Facts are recorded

All epochs are emitted, each fact naming its contributing lineIds **exactly once** (§2.5).

---

## 6. Rule inspector

Two query modes plus a diff, all reading the same registry.

### 6.1 Explain mode — retrospective

Given a claim, render the full trace per line: every rule considered, in `order`, with outcome, citation, epoch, facts used, and the counterfactual for those that did not fire. Collapsed to fired rules by default; expandable to the complete set.

### 6.2 Applicability mode — prospective

Given a **code alone, no claim**, enumerate every rule whose scope admits it and the condition under which each fires. A static query over the registry.

```
84112  —  SI Q4  ·  no APC  ·  no OPPS rate  ·  CLFS $98.11

  order 4200  OPPS.PKG.Q4.COMPANION      Pub 100-04 Ch.4 §10.4      epoch E2
              fires when: the claim also contains a line with SI
              J1, J2, S, T, V, Q1, Q2, or Q3
              effect: BUNDLED, under the highest-PAID such line

  order 4300  OPPS.CONV.Q4.TO.A          IOCE conditional conversion  epoch E2
              fires when: no such companion is present
              effect: SI → A, route to CLFS, coinsurance 0

  order 7100  CLFS.PRICE                 CLFS CY2026 Q2V1             epoch E4
              fires when: effective SI is A and schedule is CLFS
              effect: benchmark = $98.11

  Reserved, not evaluated (backing data not loaded):
              NCCI.PTP.*      MUE.*
```

Generated from rule data plus `describe()`. No hand-written prose.

### 6.3 Rule diff

`tools/diff-registry.mjs` reports added, removed, and changed rules between two registry versions, and — for the same fixture set — which determinations changed. This is how a quarterly CMS update is reviewed before it ships.

---

## 7. Data layer

### 7.1 Source of truth

CY2026 OPPS Addendum B (January 2026 release, 12/29/25), CY2026 CLFS (Q2 V1), CY2026 OPPS/ASC Final Rule (CMS-1834-FC, 90 FR 53446) for policy percentages, Pub. 100-04 Ch. 4 for packaging mechanics. Chapter 4 is at `Medicare Claims Processing Manual (100-04)/Chapters/Chapter 04 - Part B Hospital (Inpatient Part B and OPPS).pdf`.

> **Verification requirement.** Regenerate every data file from the sources named in §3. Do not port the prior build's inline blob. §3.5 records the spot-checks already done; extend them before trusting output.

**The generator must sanitize, and must fail loudly when it cannot.** Specifically required, all confirmed present in §3.5: strip non-printable bytes from the HCPCS field and **report each occurrence** (2 rows carry a trailing `0xFF`); preserve three-decimal rates without truncation (648 rows); key CLFS by `(code, modifier)` not code alone (124 `QW` rows); refuse to emit a rate for `INDICATOR = L` zero-rate rows (49); and carry `EFF_DATE` through (17 rows are April-effective).

Silent coercion at any of these points produces a wrong benchmark that no downstream test would catch.

**The CSV parsing contract is part of the spec, because both source files break a naive reader.** Two further requirements, both verified against the January Addendum B:

**RFC-4180 quoted fields — never split on comma.** 7,624 data cells carry a comma inside quotes, including **3,881 in `Payment Rate`** (`"$3,307.24"`), 1,598 in `Minimum Unadjusted Copayment`, 1,159 in `Short Descriptor`, 494 in `Adjusted Beneficiary Copayment`, and 491 in `Note`. A split-on-comma reader corrupts more than half the rated rows in the file.

**Money and percentage tokenization.** No money column is a bare number:

| Column | Hazard | Extent |
|---|---|---|
| `Payment Rate` | `$` prefix on all values; thousands separators | 7,312 `$` · 3,881 commas |
| `National Unadjusted Copayment` | literal `.` as a **placeholder for "none"** | **7,214** rows |
| `Minimum Unadjusted Copayment` | `$` prefix; thousands separators | 7,312 `$` · 1,598 commas |
| `IRA Coinsurance percentage` | `%` suffix | 83 rows |
| `Adjusted Beneficiary Copayment` | `$` prefix; thousands separators | 1,113 `$` · 494 commas |

`parseFloat` on any of these yields `NaN`, which a permissive generator would store as `null` — silently degrading 3,881 rated codes to "no rate" while every structural test still passes. The tokenizer strips `$`, `,`, and `%`, and treats a lone `.` as absent, distinctly from `0.00` (§10.1 depends on that distinction).

### 7.2 Record shape

```js
{
  code:      "99205",
  si:        "B",
  apc:       null,
  weight:    null,        // absent on 702 rated codes (§3.5) — see fallbackField
  rateMils:  null,        // integer mils (1/1000 dollar)
  minCopayMils:  null,    // raw 20%-equivalent; present on ALL 7,312 rated codes
  adjCopayMils:  null,    // cap + inflation already applied by CMS; 1,113 codes
  iraPct:        null,    // IRA coinsurance percentage; 83 codes
  copayNote:     null,    // "capped" | "inflationAdjusted" | "referenceAddOn" | null
  altCode:   "G0463",     // curated recode target (SI B only)
  // NOTE: no `schedule` field. It is computed per (code, effectiveSI) — §3.4.
  clfs:      null         // { "": {rateMils, indicator, effFrom},
                          //   "QW": {rateMils, indicator, effFrom} }
}
```

**Three copayment columns, not one.** Rev 4 kept only `minCopayMils` and discarded the two that govern the actual figure. See §10.1 — using `minCopayMils` alone overstates coinsurance by up to $899,264.00 on a single line.

**`termDate` is gone.** No file in this folder carries a termination date for any code in the loaded data (§19.4). The `DELETED` verdict is suspended via the §9.5 `dataRequired` mechanism rather than deleted, which keeps it consistent with §5.1's status vocabulary and §2.2's REJECTED enumeration.

**`effFrom` moved into the `clfs` sub-record**, where the 17 April-effective codes actually live. Addendum B has no per-code effective date.

**Money is integer mils, not cents.** 648 Addendum B rates carry three decimals, which integer cents cannot hold. Mils are exact for the published precision. Rounding to cents happens **once**, at output, half-up, and the rounding step appears in the trace.

**`clfs` is keyed by modifier**, with `""` for the unmodified row. A flat rate field loses 124 `QW` variants.

**`effFrom` is per record.** Without it the 17 April-effective PLA codes would price against a January date of service.

`altCode` is curated; `schedule` and `clfs` are generated. Unknown values are `null` and degrade honestly (§10.4); never guessed.

### 7.3 Encoding

Emit array-of-arrays with a field-order header; build the index once at load. Rev 3's "under 1 MB" target is retained as a goal, not a requirement — correctness of the modifier and precision dimensions above takes precedence over size. Report the actual emitted size in the build log.

### 7.4 Refresh

SIs are reassigned quarterly and CLFS republished quarterly. Data is regenerable independently of engine and registry.

**In the Electron consumer this is not a drop-in.** That app is policy-bound to have no updater and no network, so a quarterly refresh means a rebuild and manual reinstall. The browser tool can be refreshed by replacing `/data`. State the refresh procedure for both front-ends; do not imply parity.

### 7.5 Vintage policy — current standards, disclosed

**Decided:** every claim adjudicates against the **current** data vintage, whatever its date of service. Date of service does **not** select data. Year-over-year rule drift is accepted as immaterial for AB's purpose, which is establishing what Medicare recognizes as a benchmark rather than reconstructing a historical remittance.

This is a methodology choice, and the engine's job is to apply it consistently and **say so on every output** — a stated methodology is defensible in a dispute; an undisclosed one is not.

**What follows from it:**

- **One active vintage.** `DATA_VERSION` stays a stamp, not a lookup. No archive to acquire, no backfill. §19.23 is closed.
- **Vintages accumulate going forward, not backward.** Each quarterly refresh **archives** the outgoing bundle under its own version rather than overwriting it. This costs nothing now and means that if DOS-accurate adjudication is ever wanted, the data exists from this point on rather than having to be reconstructed. The loader interface is vintage-shaped from the start even though it holds one entry, so that change would be a data addition and not a rewrite.
- **Date of service is still captured**, and still does real work: it drives the §7.5.1 historical-code verdict, the methodology disclosure, and the §8.0 gate's other conditions. It simply does not choose a data file.
- **No claim is ever rejected for vintage.** The `DATA_VINTAGE` gate is removed from §8.0.
- **Every result discloses the gap.** Where the claim's date of service precedes the loaded vintage, `Result.disclosures` carries a flag naming both — "adjudicated under CY2026 standards; date of service 2020-08-25" — and the front-ends surface it next to the totals. Not buried in the trace.

#### 7.5.1 Historical codes, and the one real cost of this policy

The cost is concentrated in a single failure mode, and it is worth naming precisely because it produces *confidently wrong advice* rather than a visible gap.

Addendum B is point-in-time: a code retired before the current release is simply absent from it. Under §8.1 an absent code is `INVALID` — "nonexistent code, RTP." For a historical claim that verdict is not merely unhelpful, it is **incorrect**: the code existed and was properly billed on that date of service.

Measured against the 2020-08-25 test claim: **685 HCPCS Level II codes were billable on that date and all 685 are absent from CY2026 Addendum B** — `A4397` (terminated 2021-12-31), `C1834` (2023-03-31), the `C527X` skin-substitute series (2025-12-31), and so on. That is a **floor**: it counts only codes the CY2026 HCPCS file still lists with a termination date, and excludes CPT deletions entirely, which are not in that file.

**So `INVALID` splits in two:**

| Verdict | Meaning | Instruction to staff |
|---|---|---|
| `INVALID` | Valid shape, absent from current data, and no evidence it ever existed | Nonexistent code — RTP as a coding error |
| `INVALID_HISTORICAL` | Absent from current data, but the HCPCS file carries a termination date **after** this claim's date of service | The code was valid when billed. Not a coding error. Verify against the DOS-era file before disputing the line. |

**And the HCPCS termination file finally earns its place.** §19.4 concluded it was useless — correctly, for the purpose rev 5 wanted it for: not one CY2026 code carries a termination date, so it can never support a forward-looking `DELETED` verdict. It is precisely the *inverse* file: 1,300 codes with termination dates spanning 2014–2025, every one of them already gone from current Addendum B. Worthless for "has this code been deleted since," valuable for "was this code alive on that date." Load it as a **historical validity index**, not a termination index.

Codes absent from both files remain plain `INVALID` — the engine cannot distinguish "retired long ago" from "never existed," and says so rather than guessing.

---

## 8. Phase 1 — Classify

### 8.0 Claim-level applicability gate, before any line is classified

New in rev 8, prompted by the first real claim tested against this spec. Rev 7 checked only `formType === 'ub04'`, which is necessary and nowhere near sufficient: a real UB-92 institutional claim cleared that intent and still had nothing an OPPS engine could say about it.

**The engine decides whether the claim is in scope at all before it classifies a single line.** The gate is claim-scoped (§4.2), traced like any rule, and its outcome is a first-class result — `NOT_OPPS` is an answer, not a failure.

| Gate | Rejects when | Basis |
|---|---|---|
| Form type | not an institutional claim | `formType` / `claim_form`. Observed feed values include `ub92`; §19.22. |
| **Bill type** | `typeOfBill` does not begin `13` | OPPS applies to hospital outpatient, 13X. Observed: `81A` — facility type 8, not 13X. |
| **Procedure codes present** | no line carries a HCPCS/CPT code | Adjudication is keyed on the Status Indicator, which is a property of a HCPCS code. A revenue-code-only claim has no SI and nothing to bundle. See §8.0.1. |
| Inpatient indicators | room & board revenue codes, or a covered-days value code, are present | Rev `011X`–`016X` with value code `80` is an inpatient stay — IPPS, not OPPS. |
| Provider type | billing taxonomy is a payment system in §3.3 | e.g. `282NC0060X` (Critical Access Hospital) is cost-based, already Tier 3. |

A claim failing any gate returns zero determinations and a flag naming the gate. It is **not** an `EngineError` — the claim is well-formed, it is simply not an OPPS claim.

#### 8.0.2 Name the schedule that does apply

Decided in rev 10: stopping at `NOT_OPPS` is a dead end for the person holding the bill. The gate names the payment system it believes governs, as **advisory routing** with its evidence attached.

```ts
Result.applicability = {
  inScope: false,
  gate: 'BILL_TYPE',
  likelySystem: 'HOSPICE' | 'IPPS' | 'CAH_COST' | 'ASC' | 'ESRD' | 'RHC_FQHC'
              | 'MPFS' | 'SNF' | 'HHA' | 'UNKNOWN',
  confidence: 'strong' | 'probable' | 'unknown',
  evidence: string[],     // the observed facts that drove it
  detail: string
}
```

Routing signals, in the order they are tested:

| Signal | Suggests |
|---|---|
| `typeOfBill` begins `11`/`12` | `IPPS` |
| `typeOfBill` begins `81`/`82` | `HOSPICE` |
| `typeOfBill` begins `83` | `ASC` |
| `typeOfBill` begins `85`, or billing taxonomy is a Critical Access Hospital | `CAH_COST` |
| `typeOfBill` begins `72` | `ESRD` |
| `typeOfBill` begins `71`/`77` | `RHC_FQHC` |
| `typeOfBill` begins `21`/`22`/`23` | `SNF` |
| `typeOfBill` begins `32`/`33`/`34` | `HHA` |
| non-institutional form | `MPFS` |
| room & board revenue codes + a covered-days value code | `IPPS` |

**Signals are independent and all are reported.** An earlier revision qualified the room-and-board signal with "and bill type is unhelpful", which is unsatisfiable: the reference claim matches the 81/82 bill-type row *and* needs the room-and-board signal alongside it to reach its three conflicting indicators. No signal suppresses another.

**This is a suggestion, not an adjudication**, and carries the same discipline as §20: it never claims more than its evidence. Where signals conflict — the rev-9 test claim has bill type `81A` (hospice or special facility), room & board with 6 covered days (inpatient), and a Critical Access Hospital taxonomy (cost-based) — the gate reports **every** signal in `evidence` and drops `confidence` to `'probable'` rather than picking a winner. Three conflicting indicators is itself the useful finding: that claim needs a human, and saying so beats a confident wrong answer.

**Bill-type decoding must be sourced before this ships.** The table above is the textbook reading of the first two digits; the feed's actual conventions are unconfirmed, and `81A` with room & board sits oddly with hospice. §19.25.

#### 8.0.1 Revenue-code-only lines

Institutional claims routinely carry revenue codes with no HCPCS — charges rolled up by department. This is normal billing, not an error, and it is what the first real test claim looked like on all 16 lines.

Such a line is neither `MALFORMED` nor `INVALID`. It gets `status: NO_PROCEDURE_CODE`, `disposition: REJECTED`, no amount, and its revenue code and charge reported for context. Do **not** confuse this with §8.1's "4 digits → likely a revenue code" malformed reason: that case is a revenue code appearing *in the procedure field*. Here the procedure field is legitimately empty and the revenue code is in its own field.

An OPPS claim must carry HCPCS per line; a claim carrying none is caught at the §8.0 gate rather than producing sixteen identical rejections.

Two outcome classes, per §2.2: **REJECTED** stops the line; **ROUTED** sends it to phase 3.

### 8.1 Syntactic rejections

| Verdict | Trigger |
|---|---|
| `MALFORMED` | Fails all valid shape patterns |
| `INVALID` | Valid shape, absent from every loaded data set, with no evidence it ever existed |
| `INVALID_HISTORICAL` | Absent from current data, but terminated **after** this claim's date of service (§7.5.1) — valid when billed, not a coding error |
| `DELETED` | **Suspended** — `dataRequired: "hcpcs-term-dates"`, unloaded. See below. |

**Valid shapes** — rev 3's list was incomplete and would have rejected 555 real codes. Counts are the verified census; rev 4 printed two fabricated figures that summed to more codes than the file contains.

| Pattern | Family | Count in Addendum B |
|---|---|---|
| `\d{5}` | CPT I | **9,802** |
| `[A-V]\d{4}` | HCPCS II (incl. 847 `D` dental codes) | **7,455** |
| `\d{4}T` | CPT III | 607 |
| `\d{4}F` | CPT II (informational/non-payable) | 565 |
| `\d{4}U` | **PLA** — proprietary laboratory analyses | **541** |
| `\d{4}M` | **MAA** — multianalyte assays | **14** |
| | *sum* | **18,984** |
| | *+ 2 rows recovered by byte sanitization (§7.1)* | 18,986 |

The six patterns admit every code in the file once sanitization has run, and the census reconciles exactly. **The counts above are pre-sanitization**: the two `0xFF`-corrupted codes match no 5-character pattern until cleaned, which is why the table sums to 18,984 and the recoveries are listed separately. Emitted data shows `[A-V]\d{4}` = 7,457 once sanitized. Both figures are correct; a reader comparing 7,455 against the generated rows should not read the difference as a bug. Any future drift in that reconciliation is a generator bug, and §18 asserts it.

**`DELETED` is suspended, not implemented.** No file in this folder supplies a termination date for any code in the loaded data. Verified against `data files in format/HCPCS/hcpc2026_jan_anweb_01122026/HCPC2026_JAN_ANWEB_01122026.txt` (`TERM_DT`, field 29, positions 285–292): it holds 8,623 procedure records, **all HCPCS Level II** — zero `\d{5}` CPT I and zero `\d{4}[TFUM]` codes — covering only 6,610 of Addendum B's 18,986 codes, and **not one of those 6,610 carries a termination date**. All 1,300 populated values are 2014–2025 and belong to codes already dropped from CY2026. CLFS fares worse: 2,013 of 2,055 codes are absent from the HCPCS file entirely.

The rule is therefore declared with `dataRequired: "hcpcs-term-dates"` and reports `NOT_EVALUATED` on every determination, exactly like the NCCI/MUE slots (§9.5). This keeps `DELETED` coherent in §5.1's status vocabulary and §2.2's REJECTED list while stating on every output that termination was not checked — and it satisfies the §15.3 reachability gate through the existing `dataRequired` exemption rather than needing a new one.

The 555 `U` and `M` codes rev 3 omitted include **226 SI Q4 labs** — the line type §3.1.1 calls the most frequently disputed AB handles — plus 316 SI A and 12 SI E1.

**`INVALID` is tested against every loaded data set, not Addendum B alone.** 17 payable CLFS codes (`0614U`–`0630U`) are absent from the January Addendum B; testing against Addendum B alone would RTP all 17.

Malformed sub-cases must give a **specific** reason:

- 4 digits → likely a revenue code or dropped leading zero
- 1–3 digits → too short
- 11 digits → NDC in the procedure field
- ICD-10 shape → diagnosis in the procedure field
- More than 5 chars after normalization → stray modifier or concatenation

**Normalization:** uppercase; strip whitespace, hyphens, and non-printable bytes; peel a trailing 2-character modifier into its own field. Do **not** auto-pad a 4-digit token to 5 — ambiguous with a revenue code, and silently inventing a procedure line is unacceptable on a bill AB may dispute. Flag it.

### 8.2 Jurisdictional dispositions

Valid and current, but not adjudicated under OPPS. Rev 3 called all of these "failures," which was wrong — two of them pay.

| SI | Disposition | Status | Action |
|---|---|---|---|
| `A` | **ROUTED** | `ROUTED` | Payable, not via APC. Priced if CLFS (672 of 2,008 codes); named-only if Tier 2. Skips phase 2. |
| `Y` | **ROUTED** | `ROUTED` | Bill the DME MAC. Named, never priced. Skips phase 2. |
| `B` | REJECTED | `NOT_PAID_RECODE` | Not OPPS-recognized; surface `altCode` as an instruction. |
| `C` | REJECTED | `NOT_PAID_INPT_ONLY` | Inpatient-only. On an outpatient claim a structural red flag, not a typo. |
| `E1` | REJECTED | `NOT_PAID` | Not payable on any outpatient bill type. |
| `E2` | REJECTED | `NOT_PAID` | No payment / not priceable as submitted. |
| `M` | REJECTED | `NOT_PAID` | Not billable to the MAC. |

**SI A is the trap.** It is payable, so a naive engine benchmarks it against an APC — the wrong table. It is peeled off before phase 2, and it is a *routing*, not a rejection.

SI A and Y lines do **not** count as companions in any phase 2 packaging trigger. No trigger list includes either.

### 8.3 Recode recommendation

For SI B, an actionable target rather than a hedge.

- `altCode` present → *"professional/MPFS code on a UB-04 — recode → bill **G0463** instead"*
- absent → *"professional/MPFS code on a UB-04 — confirm the facility equivalent"*

Highest-volume mapping: office/outpatient E/M `99202–99205`, `99211–99215` → `G0463`.

**Do not** include ED E/M `99281–99285` — OPPS-payable as billed.

---

## 9. Phase 2 — Adjudicate

### 9.1 Bands and evaluation order

Order is load-bearing and expressed as rule `order` integers, not control flow. Bands align with fact epochs (§2.5).

| Band | Content | Epoch read |
|---|---|---|
| 1000 | Statutory exempt set (§9.6) | `E0` |
| 2000 | J1 comprehensive control | `E1` |
| 3000 | C-APC 8011 | `E1` |
| 4000 | Conditional packaging, Q-group (§9.2) | `E2` |
| 4500 | *(reserved)* — moved out of the packaging band | — |
| 5000 | Standard disposition (§9.4) | `E3` |
| 6000 | Reserved edit slots (§9.5) | `E3` |

Rev 3 placed the reserved-edit example at order 4500, inside the band it reserved for Q-group packaging. Reserved edits are band 6000.

**J1 control.** If any J1 is present, the ranked J1 controls and all non-exempt lines bundle into it. Rank by **payment** desc, tiebreak `code` asc — Ch. 4 assigns packaging to the most costly primary procedure, so payment ranking is correct here.

**J1 complexity adjustment is not modeled, and its omission understates payment.** When specified J1 combinations appear together, CMS moves the claim to a higher-paying APC in the same clinical family. Rev 4 dropped this entirely — it appeared in no section, no non-goal, and no open decision — while §15.1 fixtures exactly the `<J1> <J1>` claim shape the adjustment applies to. The combination table is not on disk. Until it is sourced, a multi-J1 claim pays the single ranked J1 rate and **carries a flag stating that complexity adjustment was not applied and the amount may be understated**. Listed as a non-goal (§16) and an open decision (§19.16).

**C-APC 8011 packaging is the point, and rev 4 lost it.** When 8011 fires, the J2 visit controls and **all non-exempt lines bundle into it** — the same packaging power a controlling J1 has. Rev 4 specified only that the J2 line becomes `PAID_UNPRICED`, which would leave every other separately payable line paying its own APC: the opposite of comprehensive payment, and a strictly worse outcome than not firing 8011 at all.

**What pays is still unresolved and must not be guessed.** No source in §3 or §7 supplies an APC 8011 rate; Addendum B carries 934 distinct APCs and **none** in the 8000-range, and no OPPS Addendum A exists in this folder. So a fired 8011 packages the claim, and the controlling J2 line yields `PAID_UNPRICED` with basis `OPPS_COMPREHENSIVE` plus a flag naming the missing rate. Packaging and pricing are separate concerns; the missing rate does not excuse skipping the packaging. See §19.12.

**The 8011 criteria, sourced.** Rev 14 read Pub 100-04 Ch. 4 directly (the "Comprehensive Observation Services APC (APC 8011)" criteria list) rather than relying on a reviewer's paraphrase. The manual states three criteria groups; only some are checkable from claim data at all.

| Criterion | Manual text, condensed | Checkable from a claim? |
|---|---|---|
| **1d** | "The number of units reported with HCPCS code `G0378` must equal or exceed 8 hours." | **yes** — built |
| **2a** | The claim must include one of: a Type A or B ED visit (`99281`–`99285` or `G0380`–`G0384`), a clinic visit (`G0463`), critical care (`99291`), or a direct referral (`G0379`) | **yes** — built |
| **2a date** | "The additional services … must have a line item date of service **on the same day or the day before** the date reported for observation." `G0379` is stricter: it "must be reported on the **same date of service** as the date reported for observation services." | **yes in principle, not expressible** — see below |
| **2b** | "No procedure with a T status indicator or a J1 status indicator can be reported on the claim." | **yes** — built |
| bill type | "Only visits, critical care and observation services that are billed on a **13X bill type**" may qualify. | **yes** — enforced at the §8.0 gate |
| **1a–c** | Observation time documented in the medical record; billing begins at the documented clock time; ends when interventions complete. | **never** — medical-record facts |
| **3a–b** | Beneficiary in a physician's care throughout, documented; physician explicitly assessed patient risk. | **never** — medical-record facts |

**Two of the three criteria groups are not derivable from a claim, ever.** 8011 therefore can never be *fully* determined by this engine, and a fired 8011 must say so — the engine has checked the claim-data criteria and cannot see the documentation ones. This is a permanent limitation, not a milestone gap, and it was absent from every prior revision.

**"Any SI J2 present" is exact, not a proxy — for CY2026.** The 13 J2 codes in CY2026 Addendum B are precisely the manual's named list: `99281`–`99285`, `G0380`–`G0384`, `G0463`, `99291`, `G0379`. SI J2 *is* CMS's encoding of criterion 2a. That equivalence is a property of the loaded data rather than a guarantee, so the generator asserts it on every refresh: if a future quarter adds a J2 code absent from the manual's list, the rule would over-fire and the build must fail rather than drift.

**The date relation needs a new operator, not more data.** The dates are already present — every line carries `fromDate`. What is missing is an operator comparing *one line's date to another line's*: `dosOnOrAfter`/`dosBefore` compare a line's date to a literal baked into the rule at authoring time, and no ranking operator accepts a date field. Adding one is a deliberate change to the closed set (§4.3), and it must cover both variants — same-day-or-day-before for the visit codes, same-day-only for `G0379`. Until then 8011 fires on the criteria it can check and flags the date relation as unevaluated. §19.27.


### 9.2 Trigger lists differ, and the difference is real

| SI | Packages to $0 when the claim contains | Otherwise |
|---|---|---|
| `Q1` | S, T, or V | Pays own APC |
| `Q2` | T only | Pays own APC (pays alongside S or V) |
| `Q3` | — never companion-packaged | Pays own APC unless its composite combination is met |
| `Q4` | J1, J2, S, T, V, Q1, Q2, or Q3 | Converts to A → routes to **CLFS**, priced, coinsurance 0 |

**The Q1/Q4 asymmetry must be preserved.** Q4's list includes J2 even when 8011 did not fire; Q1's does not. On a bare `G0463` claim a Q4 lab bundles while a Q1 line pays. Correct, and it belongs in the rule's `note` (§4.2) so the inspector surfaces it — the prior build carried it as a code comment nobody reading the output could see.

**Q-group tiebreak:** where multiple Q1/Q2 lines survive unpackaged, the highest-**paid** pays and the rest bundle into it (Ch. 4 §10.4.1), tiebreak `code` asc.

**Q3's composite combination is not specified and has no data source.** Rev 3 named the mechanism with no rule, no operator, no source, and no fixture. Until the composite APC combination table is sourced, Q3 pays its own APC and every Q3 line carries a flag stating that composite evaluation was not performed. This is a known gap, not a modeled rule. §19.13.

**The composite flag must reach Q1 and Q2 as well.** Ch. 4 §10.4.1 provides that when a claim carries STV-packaged or T-packaged codes alongside codes payable through a composite APC, the Q1/Q2 payment is packaged into the composite. Since composite evaluation is not performed, any claim carrying a Q1 or Q2 line together with a composite-eligible companion carries the same "composite not evaluated" flag — rev 4 put it on Q3 lines only, which understates where the gap bites.

**Ch. 4 states the Q4 rule twice, and the two readings diverge.** §10.4 C.5 gives it once as the enumerated SI list this table uses, and once as "not billed on the same claim as another separately payable service." The readings disagree on a claim whose only companion is SI `K`, `R`, `U`, or `S1` — all separately payable, none in the enumerated list. This spec adopts the enumerated list, which is what IOCE implements, and records the divergence here so the choice is visible rather than accidental. §19.19.

### 9.3 Q4 conversion is the CLFS entry point

An unpackaged Q4 converts to SI A and prices under CLFS **when the code actually has a CLFS row** (§3.1.1). Its `basis` is `CLFS` because the code is CLFS-present — checked directly via `lookupClfs` (§3.4), not inferred from whatever `routing.resolve()` returns — never `OPPS_APC`. `resolve()`'s own guard already makes `OPPS_APC` structurally unreachable here (its `OPPS_APC` branch requires `paysOwnApc(effectiveSI)`, false for every Q4 conversion's post-conversion SI `A`), and the phase asserts that defensively rather than trusting it silently.

**Corrected in rev 15** (found reviewing rev 12's own fix): forcing `basis: 'CLFS'` unconditionally for *every* Q4 conversion — including the 6 codes absent from CLFS entirely — was itself wrong, not merely a resolver limitation to route around. Those 6 codes (`0602T`, `0603T`, `81099`, `84999`, `85999`, `88749`) match no row in CLFS **or any other loaded fee schedule**; `routing.resolve()`'s `ROUTED_UNKNOWN` for them is the honest answer, and claiming `CLFS` fabricates provenance CMS's own data does not support — the resolver was never actually wrong for these 6, only for the 18 CLFS-present-but-unrated codes it also degrades to `ROUTED_UNKNOWN`. The phase now checks CLFS presence directly: present (whether or not it carries a usable rate) → `basis: CLFS`; absent, and no match in DMEPOS/AFS/MPFS either → report whatever `resolve()` found (`ROUTED_UNKNOWN` for these 6) and raise `OPPS.Q4.NO_SCHEDULE_MATCH` (§12.7 manifest, severity `gap`) disclosing the data gap. The never-`OPPS_APC` guarantee is unaffected either way.

Twenty-four Q4 codes have no usable CLFS rate and resolve to `PAID_UNPRICED` — 6 absent from CLFS entirely (basis `ROUTED_UNKNOWN`, flagged, as of rev 15), 18 present at `RATE = 0.00` / `INDICATOR = L` (basis `CLFS`, §3.1.1). Never `$0.00`.

### 9.4 Standard disposition

- `S` — pays 100%, never discounted when multiple.
- `T` — MPPR: highest-**weighted** pays 100%, each additional 50%, via `ordinalIs`/`ordinalAtLeast` (§4.3). Authority is Ch. 4 **§10.5**, which ranks by weight; rev 4 wrongly applied §10.4.1's payment ranking, which governs the Q-group survivor instead. Because 8 rated T codes carry no weight — all New Technology APCs — the rule declares `fallbackField: "rateMils"` (§4.2).
- `V` — pays own visit APC.
- `S1`, `H1`, `K1` — separately payable on their own basis: `S1` pays its own APC (298 codes, all rated); `K1` pays as a drug/biological (5 codes, all rated, basis `OPPS_DRUG_ASP`); `H1` is a pass-through device with **no rate** (13 codes, APC assigned, no dollar amount) → `PAID_UNPRICED`, basis `COST`. Rev 4 declared all three exempt from packaging and then gave them no disposition, no status, and no basis — 316 codes with no payment outcome. Their presence in the exempt set was also unsourced; see §9.6.
- `J2` unfired — pays own visit APC; **zero packaging power** over other lines.
- `N` — **`status: PACKAGED`**, `basis: NONE`, `bundledUnder: null`. Always $0, no modifier override; charges still reported for rate-setting/outliers. 2,076 codes, **none** carrying a rate.
  `PACKAGED` was added in rev 13 because the CLI made the earlier choice untenable: SI `N` reported `status: PAID` with no basis and no amount, which tells a bill processor the line pays when it pays nothing separately — backwards, not merely imprecise. It is distinct from `BUNDLED`, which names a controlling line in `bundledUnder`; a packaged line is packaged into the claim with no single controlling line to name.
- `K` — **priced.** All 526 carry an Addendum B payment rate. Basis `OPPS_DRUG_ASP`.
- `G` — **priced.** All 117 carry a rate. Basis `OPPS_DRUG_ASP`. Exempt per §9.6.
- `U` — **priced.** All 17 carry a rate. Basis `OPPS_APC`. Exempt per §9.6.
- `R` — **priced.** All 41 carry a rate. Basis `OPPS_BLOOD`.
- `P` — unpriced. 4 codes, none rated. `PAID_UNPRICED`, basis `PHP_PER_DIEM`.
- `H`, `L`, `F` — **unpriced, cost-based.** `H` 19 codes (APC assigned, no rate — pass-through device), `L` 48 (vaccines), `F` 1 (corneal tissue / CRNA / Hep B). All paid at reasonable cost, so no rate is a *correct* data state, not a gap. `PAID_UNPRICED`, basis `COST`.

**The unpriced population is 85 codes, not 4.** Rev 3 said 571 (wrong high — it discarded rates the engine had already loaded for 567 K and R codes). Rev 4 said 4 (wrong low — it missed the exempt set entirely). Verified census of payable codes with no Addendum B rate: `P` 4 · `L` 48 · `H` 19 · `H1` 13 · `F` 1 = **85**, of which **81 are in the exempt set** and therefore survive packaging and reach phase 3 with nothing to pay. All 85 appear in the §10.2 disclosure list; none may emit `$0.00`.

### 9.5 Reserved edit slots — NCCI PTP and MUE

No NCCI, MUE, or IOCE edit files exist in this folder (§3.5). The registry **declares** these rules with `dataRequired` and no backing data:

```json
{ "id": "NCCI.PTP.PAIR", "phase": "ADJUDICATE", "band": 6000, "order": 6100,
  "dataRequired": "ncci-ptp", "citation": "NCCI Policy Manual, PTP tables",
  "scopeTarget": "line", "scope": { "always": true },
  "when": { "unimplemented": { "reason": "requires PTP pair table" } } }
```

The loader marks any rule whose `dataRequired` set is unloaded as suspended. It appears in every trace as `NOT_EVALUATED`, or `NOT_REACHED` on lines rejected in phase 1. Adding NCCI later is a data drop plus a `when` clause, not a re-architecture.

**Reserved rules are exempt from the §15.4 coverage requirement.** They can never reach `FIRED`, so requiring both states of them would fail the build on the spec's own registry. `lint-registry.mjs` exempts rules with an unloaded `dataRequired` from both the coverage gate and the reachability gate, and **reports the exemption count** so the exemption cannot quietly grow.

This is the honest position: the tool reports on every determination that PTP and MUE were not applied.

**The same mechanism covers a rule that is specified but not yet built.** A suspended rule reports `NOT_EVALUATED`; a rule that simply does not exist reports nothing at all, and the output looks complete. That difference is invisible to the reader and therefore dangerous — found by running `G0378x8 99284` before C-APC 8011 was implemented and getting a plausible answer with no hint that a major packaging rule had not been considered. **Every rule §9 requires but a milestone defers must be declared as a reserved slot with `dataRequired`, so the gap is stated on every determination rather than inferred from its absence.**

### 9.6 Exempt set

**SI-based: `U`, `G`, `H`, `F`, `L`** — Ch. 4's stated C-APC exclusion list, five SIs, 202 codes — **plus `S1`, `H1`, `K1`**, added in rev 10 and flagged `UNVERIFIED_POLICY`. Eight SIs, 518 codes.

**Why the three are included, and what would confirm it.** No source on disk states their C-APC status: Addendum D1 (the SI definitions table) is not in this folder, and the local CY2026 pricing index returns *"Unknown status indicator"* for both `S1` and `H1` — they are new enough that its SI table predates them. The case for exempting them is structural rather than cited, and it is coherent:

| SI | Example | APC | Reading |
|---|---|---|---|
| `S1` | `A2002` Mirragen wound matrix | 6001 | skin substitute, in CY2026's new 6xxx skin-substitute series |
| `H1` | `C9804` elastomeric non-opioid pump | 2048 | device, in the device pass-through 2xxx series |
| `K1` | `J1096` dexamethasone ophthalmic insert | 9308 | drug, in the drug 9xxx series |

All three sit in APC ranges reserved for categories Congress or CMS pays **separately by statute** — which is exactly what the existing exempt set is: pass-through drugs (`G`), pass-through devices (`H`), brachytherapy (`U`), vaccines (`L`), corneal tissue and CRNA (`F`). `S1` also appears in Addendum B's own 340B header list alongside `S`, so it behaves as a separately paid, non-packaged indicator. The `H1`/`K1` examples are recognizably non-opioid pain management products, a category with its own statutory separate-payment mandate.

**Direction of the error, stated so the risk is priced.** Exempting these wrongly means 518 rather than 202 codes survive packaging, so more lines pay separately and the Medicare benchmark comes out **higher**. Since AB pays a multiple of that benchmark, an error in this direction costs AB money rather than exposing a position to challenge — which makes it the safer default to carry while unverified, not the cheaper one.

**To confirm:** CY2026 OPPS Addendum D1, or the C-APC exclusion discussion in CMS-1834-FC. Until then every rule reading this set emits `UNVERIFIED_POLICY`, and §19.18 stays open with the specific artifact named.

Category-based: ambulance, preventive services, self-administered drugs not functioning as supplies, C9399, PT/OT/SLP on a separate recurring-services claim, screening mammography — flag as manual checks where not derivable.

**New Technology APC services are derivable** from Addendum B by APC range and are modeled as a rule, not a manual check. Rev 3 wrongly grouped them with the undetectable categories.

Every bundled line records **which line it bundled under** — the field staff actually use when disputing.

---

## 10. Phase 3 — Benchmark

Deliberately thin. Price is a consequence of adjudication, not the product.

### 10.1 Percentage and coinsurance rules

Registry rules with citations and trace entries like any other; a multiplier that applied silently is exactly what this rewrite exists to eliminate. Individually toggleable, default off unless the user asserts the condition.

| Rule | Effect | Applies to | Reduces copay? |
|---|---|---|---|
| MPPR (multiple T) | 100% / 50% via `ordinalIs`/`ordinalAtLeast` | SI T, ranked by **weight** (§9.4) | **yes** |
| Terminated procedure, mod 73 / 74 | 50% / 100% | the flagged line | yes |
| Non-excepted off-campus PBD (mod PN) | 40% of OPPS | conversion-factor-derived lines, excluding intensive cardiac rehab | yes |
| Excepted off-campus PBD (mod PO) | 40% | G0463 + drug admin APCs only | yes |
| 340B remedy offset | × 0.9951 | SI `J1, J2, P, Q1, Q2, Q3, R, S, S1, T, U, V`, offset-subject hospitals | **yes** |
| OQR reporting failure | × 0.9805 | **conversion-factor-derived lines only** | **yes** |
| Beneficiary coinsurance | `setCoinsurance` | OPPS-priced lines — see below | — |

**Every reduction reduces copayment, not just 340B.** Rev 4 marked only the 340B row as touching copay, which would leave beneficiary coinsurance at the unreduced figure on MPPR-discounted, PN-reduced, and OQR-reduced lines. Under OPPS the reduction rides the payment, and copayment follows it.

**OQR and PN apply only to conversion-factor-derived payment.** The 0.9805 factor rides the conversion factor, so it does not touch payment that is not CF-derived: ASP-based drugs, New Technology services paid at a fixed amount, and cost-based services. That is **702 of the 7,312 rated codes** — precisely the set carrying no relative weight (`K` 526, `G` 117, `S` 46, `T` 8, `K1` 5), which is why weight-absence is the usable test for CF-derivation. Rev 4 applied both factors to all "OPPS-priced lines."

### 10.1.1 Coinsurance — read the adjusted column

Addendum B carries **four** copayment-related columns. Rev 4 used one and declared the rest incomputable.

| Column | Populated | Meaning |
|---|---|---|
| `Minimum Unadjusted Copayment` | **all 7,312** rated rows | raw 20%-equivalent, before cap or adjustment |
| `IRA Coinsurance percentage` | 83 | inflation-adjusted coinsurance rate |
| `Adjusted Beneficiary Copayment` | **1,113** | the actual figure — cap and adjustment already applied by CMS |
| `Note` | 484 capped · 76 inflation-adjusted · 7 both · 31 reference add-on | which adjustment applied |

The adjusted figure **differs from the minimum on 560 rows**, and the divergence is not marginal:

```
J3391 (SI K)   minimum $901,000.00   adjusted $1,736.00   overstated by $899,264.00
J1411 (SI G)   minimum $737,053.34   adjusted $1,736.00   overstated by $735,317.34
```

**Resolution order for `setCoinsurance`:**

1. `adjCopayMils` if present (1,113 codes) — CMS has already applied the cap and any inflation adjustment.
2. Else `minCopayMils`, which is present on **every** rated row.
3. There is no third branch. Rev 4's "else 20%" is unreachable — no rated code lacks a minimum copayment — so it is removed rather than left as dead, untestable logic.

**Zero is a value, not an absence.** 55 rated codes carry a minimum copayment of exactly `$0.00` against a non-zero rate — preventive and screening services with statutory zero coinsurance: `71271` (lung-cancer LDCT), `74263` (CT colonography), `76706` (AAA ultrasound), `77080`/`77081` (bone density), `99406` (tobacco cessation), and others. A truthiness test on this field charges 20% coinsurance on all 55. The generator distinguishes `0` from `null`, and the tokenizer distinguishes `0.00` from the literal `.` placeholder (§7.1).

**The statutory copayment cap is computable; the beneficiary's deductible is not.** Rev 4 conflated these. The per-service OPPS copayment cap is a published dollar figure — $1,736.00 for CY2026, stated in the `Note` column and already applied in `Adjusted Beneficiary Copayment`, binding on 491 codes. What the engine cannot know is a *particular beneficiary's remaining* Part A deductible. Only the latter is a stated limitation; refusing to apply the former was refusing to read a column CMS provides.

Q4 lines converted to A carry coinsurance 0.

### 10.1.2 Stacking arithmetic

Rev 4 said "computed in mils, rounded to cents once at output," which is not a computable definition: every multiplier in the chain produces a non-integer mil value, forcing either floats or per-step truncation — and neither yields traces that survive reimplementation.

Multipliers are therefore **rationals**, not decimals: `multiply: {factor: {num, den}}` — MPPR is `{1,2}`, PN and PO are `{2,5}`, 340B is `{9951,10000}`, OQR is `{9805,10000}`. The engine carries an exact rational accumulator per amount (integer numerator and denominator, reduced by GCD at each step), applies the whole chain, and converts to integer cents **once**, half-up, at output. No intermediate rounding, no floats anywhere.

The trace records the ordered factor chain, the final rational, and the single rounding step. This is what makes §18.28's byte-identical claim assertable across the JS engine and its TypeScript reimplementation.

Verify every percentage against CMS-1834-FC before shipping. The 340B ratio and its SI scope are verified (§3.5); the rest are not. §19.3, §19.5.

Verify every percentage against CMS-1834-FC before shipping. The 340B ratio and its SI scope are verified (§3.5); the rest are not.

### 10.2 Totals and disclosures

- Sum only lines with a computed amount.
- **Count and disclose** paid lines with no computable amount, by reason. Each disclosure names its count and reason; none may be silently omitted, and none may emit `$0.00`:

| Reason | Population |
|---|---|
| Engine error, line not adjudicated (§12.8) | per line |
| Tier 2 routed (MPFS / DMEPOS / AFS) | per claim |
| Cost-based, exempt set — `L` 48, `H` 19, `H1` 13, `F` 1 | **81 codes** |
| SI P, PHP per-diem | 4 codes |
| SI Q4 with no usable CLFS rate | **24 codes** — 6 absent, 18 at `RATE = 0.00` |
| Fired C-APC 8011, no rate source (§9.1) | per claim |
| J1 complexity adjustment not applied (§9.1) | per multi-J1 claim |
| Q3 composite not evaluated (§9.2) | per Q3 line |
| NCCI PTP / MUE not applied (§9.5) | every claim |
| `DELETED` not checked (§8.1) | every claim |
- RBP reference: **150% of Medicare** for facility. (AB's physician benchmark is 120%; professional lines are out of scope.)
- State that NCCI PTP and MUE were not applied (§9.5).

### 10.3 `basis` closed vocabulary

Rev 3's three values could not express outcomes the rest of the doc required.

`OPPS_APC` · `OPPS_DRUG_ASP` · `OPPS_BLOOD` · `OPPS_COMPREHENSIVE` · `CLFS` · `COST` · `PHP_PER_DIEM` · `ROUTED_MPFS` · `ROUTED_DMEPOS` · `ROUTED_AFS` · `ROUTED_UNKNOWN` · `CONTRACT` · `NONE`

`COST` is new in rev 5 and covers the 81 reasonable-cost exempt-set codes (§9.4) that rev 4's vocabulary could not express at all.

Every amount carries one. Display chips map from these; the engine emits no display strings.

### 10.4 Honest degradation

Unknown `altCode` → "confirm the facility equivalent." Unknown `schedule` → `ROUTED_UNKNOWN`, "a non-OPPS fee schedule." Tier 2 → name the schedule, say rate lookup is next. No rate → `—` plus the basis. **No inferred or fabricated values.** A zero rate is never emitted as a benchmark. Every assumption the engine makes (G0378 units not supplied, Q3 composite not evaluated, 8011 rate unavailable) becomes an explicit `flag`.

---

## 11. Phase 4 — Contract application

Plan and provider contract terms, applied after and on top of the Medicare determination.

### 11.1 The immutability rule

Phase 4 receives a deep-frozen phase 3 result and may not alter it. Output carries `medicareMils` and `contractMils` side by side, always both. Not a style preference: the advocacy position is "Medicare would recognize X, the contract says Y," and collapsing them destroys it.

**Consequence, stated because rev 3 left it open as if undecided:** a phase 4 that cannot mutate phase 3 output **cannot re-bundle lines**. "Contract bundling overrides OPPS packaging" is therefore unimplementable in this architecture, not merely undecided. If AB needs contract-driven bundling, it requires a second adjudication pass with a contract-supplied registry — a different design, and out of scope here. §19.9 is closed on that basis.

### 11.2 Contract registry and selection

```json
{
  "id": "CONTRACT.<provider>.<agreement>",
  "version": "1",
  "providerScope": { "tin": [...], "npi": [...] },
  "effectiveFrom": "20260101", "effectiveTo": null,
  "precedence": 100,
  "terms": [ { "id": "...", "band": 100, "order": 100, "epoch": "E4",
               "citation": "<agreement §>", "scope": {...},
               "when": {...}, "then": [...], "note": "..." } ]
}
```

Terms carry the **same** fields as OPPS rules (`id`, `version`, `band`, `order`, `epoch`, `citation`, `scope`, `when`, `then`, `note`) so they produce conforming `Evaluation` records and pass registry lint. Rev 3's term shape omitted most of these.

**Provider identity must be supplied.** `providerScope` selects on TIN/NPI, and nothing in rev 3 carried either: not the line shape, not the options row. Provider identity comes from the claim header in `837-claim-viewer/src/model/claim.ts` (confirm exact field names when writing the adapter) and must be an explicit input to the engine. In the browser front-end it is a manual entry field. §14 forbids **persisting** it; supplying it per adjudication is required and not in conflict.

**Selection is deterministic and single-winner.** Zero matching contracts → phase 4 is a no-op and every determination carries a flag saying so. Exactly one → it applies. More than one → the highest `precedence` wins, tiebreak `id` asc, and the trace records every contract considered and why each lost. A tie on both is a hard error, not a silent pick.

`facility` is dropped from `providerScope`; it had no definition in the consumer's claim model.

### 11.3 Term types and their semantics

Rev 3 listed term types with no evaluation semantics at all. Required definitions:

| Term type | Operand(s) | Level |
|---|---|---|
| `percentOfMedicare` | × `medicareMils` | line |
| `feeSchedule` | a rate from a **Tier 1** schedule only | line |
| `perDiem` | per covered day × day count | claim |
| `caseRate` | flat amount for the claim | claim |
| `carveOut` | excludes matching lines from an enclosing claim-level term | line |
| `lesserOf` | **min of two or more named candidate terms** | line or claim |
| `stopLoss` | `claimMoneyAtLeast(threshold)` → alternate rate | claim |
| `exclusion` | line pays 0 under the contract; Medicare amount unaffected | line |

**Evaluation semantics:**

- **All matching terms apply**, in `order`. `multiply` effects accumulate; a second `setStatus`-equivalent is last-writer-wins with `supersededBy` recorded.
- **`stop` is available** in phase 4 and halts remaining terms for that line only.
- **Ordering is layered, not flat.** Line-level terms resolve first (band 100), then carve-outs (200), then claim-level terms (300), then `lesserOf` (400), then `stopLoss` (500). `lesserOf` cannot evaluate until its candidates have produced amounts, which is why it has its own band rather than an arbitrary `order`.
- **`lesserOf` compares named terms, not implicit quantities.** It takes `{candidates: [termId, termId, ...]}`. Rev 3 left the operands undefined, and the three plausible readings — billed charge vs contract rate, contract rate vs percent-of-Medicare, contract rate vs a fee schedule — give different dollars on the same claim. Billed charge is available as `chargeMils` and may be named as a candidate explicitly.
- **`feeSchedule` is restricted to Tier 1.** Naming a Tier 2 or Tier 3 schedule would require pricing a schedule the engine never loads, contradicting §16 and §18.10. Lint rejects it.

### 11.4 Attribution of claim-level outcomes

A `perDiem`, `caseRate`, or `stopLoss` result is a single claim amount that must be reconcilable to lines. It lands in `Result.claimAmounts` (§5.1) with an explicit `attribution`:

`NONE` (claim-level only, lines show `contractMils: null` and a flag) · `PRO_RATA_BY_MEDICARE` · `PRO_RATA_BY_CHARGE`.

The method is a property of the contract term, never an engine default, and it appears in the trace. Without this, `perDiem` and `caseRate` have nowhere to land — rev 3's `amounts.contract` was per line only.

### 11.5 Traced identically

Every term evaluation produces an `Evaluation` with the same fields including counterfactuals. "Which contract term applied, and what would have applied instead" is the same question as "which rule fired."

### 11.6 Required DSL extensions, enumerated

§4.3 forbids ad-hoc operators, so the extensions phase 4 needs are named here rather than left to the implementer: `chargeAtLeast`, `claimMoneyAtLeast`, `dayCountAtLeast`, `lesserOfCandidates`, and the `exclusion` effect. All are additions to the closed set in §4.3, not local inventions.

---

## 12. Interface contracts and typed boundaries

Separate concern from §11.

### 12.1 Typing and delivery into the consumer — corrected

Rev 3 claimed `837-claim-viewer` could typecheck the engine "under that repo's existing `tsc --noEmit` with `checkJs`," with no transpile and no config change. That was false. Rev 5's fix — vendored `.js` plus a scoped `tsconfig.engine.json` — was also wrong, in four further ways the architecture review found:

- **No sibling declarations.** An aggregate `types.d.ts` leaves `import … from './engine/index.js'` typed `any`, which `strict: true` turns into a hard `TS7016`.
- **No packaging emit path.** Bare `tsc` with `allowJs` off emits nothing for `.js`, and the `electron-builder` config excludes `!src/**/*`, so the engine would typecheck and then not ship.
- **`/data` was never vendored at all.** The engine is a pure function of the data it is handed; if the data does not travel in the same artifact, the vendored copy has nothing to hand it.
- **JSDoc has no non-null assertion**, which is constant friction under the consumer's `noUncheckedIndexedAccess`.

**Authoring in TypeScript dissolves all four.** The mechanism:

1. `tools/sync-to-consumer.mjs` vendors `/engine`, `/registry`, and `/data` into `837-claim-viewer/src/engine/`, `src/engine/registry/`, and `src/engine/data/`.
2. **No consumer tsconfig change, and none is permitted.** The vendored `.ts` is typechecked by the consumer's existing `typecheck` target and emitted by its existing `tsc` in `build:app`. Registry `.json` is the one non-`.ts` payload and needs a copy step: `sync-to-consumer.mjs` emits `scripts/copy-engine-registry.mjs`, added to `build:app` after `tsc` — exactly as the repo's existing `scripts/copy-fonts.mjs` already does, and for the reason its own header states: `tsc` only emits `.js` from `.ts`, it never copies non-TypeScript assets.
3. `/data` is emitted by `gen-data.mjs` as `.ts`, not `.js`, so it travels the same path.
4. **The engine imports no JSON modules.** Registry JSON stays the authored source of truth, but a generator emits it as a `.ts` literal — the pattern `/data` already uses — so the engine needs no `resolveJsonModule`. A JSON module import forces that flag into the consumer's repo-wide config and breaks criterion 3.
5. Raw indexing into §7.3's array-of-arrays is confined to `/engine/data/index.ts`, which builds the index at load and exposes `lookup(code)` and `lookupClfs(code, modifier)`. No other engine module indexes a data row, and **no engine module uses a non-null assertion (`!`) on a data access** — a `!` there is precisely how a bad row becomes a wrong benchmark silently.
6. The vendored copy is generated and never hand-edited (§12.5).

The repo is ESM (`module: ESNext`, `verbatimModuleSyntax: true`), so the ESM assumption holds. Because `verbatimModuleSyntax` is on, engine types crossing into consumer `.ts` must be imported with `import type`.

### 12.2 Runtime validation at every boundary

Types vanish at runtime and the registry is JSON a human will hand-edit.

Two boundaries face input the engine did not produce: **(a)** claim, options, and provider identity; **(b)** registry, contracts, and data bundle at load. Both are validated **unconditionally, in every mode**, and a violation is claim-fatal per §12.7 — never a silent coercion.

**Registry validation inspects operator payloads, not just the envelope.** Each `scope`/`when`/`then` node's `args` is checked against the operator that will receive it, at load time, throwing `REGISTRY_SCHEMA_INVALID` with the rule id and offending node. An envelope-only check is precisely what let the rev-11 bare-form defect reach evaluation time and misdiagnose itself. The validator consults each operator's own argument descriptor rather than re-encoding shapes (§4.4).

**Claim-level dates may legitimately be empty.** `statementThrough` is absent on the reference institutional claim, and requiring it rejected that fixture before the §8.0 gate it exists to exercise could run.

**Phase-output validation is an assertion, not a runtime boundary.** `options.validate ∈ 'inputs' | 'boundaries' | 'off'`, default `'boundaries'`, recorded in `Result.meta.validate` and in the trace header — so a trace can never be read without knowing which gates ran. A determination produced under `'off'` is not a defensible artifact, and neither front-end offers it.

The validator is dependency-free **so the vendored subtree adds nothing to the consumer's `dependencies`** — not because of `file://`, which `bundle.mjs` resolves by inlining. Rev 5 gave the wrong reason.

### 12.3 Deep freeze, not `Object.freeze`

`Object.freeze` is shallow and a no-op on `Set` and `Map` contents, so rev 3's mechanical guarantee did not exist. `dsl/freeze.ts` deep-freezes recursively and replaces `Set`/`Map` fact collections with frozen plain structures before handing them to a phase.

**Freeze determinations, `claimAmounts`, and the epoch fact sets. Never freeze the trace journal** (§2.2) — it is append-only and lives outside the payload. Rev 5's freeze cost fell almost entirely on the trace, which is also what made it self-contradictory.

`structuredClone` of a frozen graph returns an **unfrozen** clone, so this guarantee is in-process and stops at the §12.9 process boundary.

### 12.4 Versioned public API

`index.js` exports `ENGINE_CONTRACT_VERSION`. Consumers assert on load. Breaking the input or output shape requires a major bump, and golden traces (§15.2) are regenerated as a reviewed change.

### 12.5 Consumer-driven contract tests

`837-claim-viewer` owns a fixture set asserting the boundary shapes it depends on, plus the §12.1 drift check. Because the engine is vendored rather than referenced, the drift check is what makes an engine change visible in the consumer's suite — without it, the consumer would never see a change until someone re-ran the sync.

### 12.7 Error taxonomy and error shape

Rev 5 used "hard error" as a defined term three times (§4.2, §11.2, §12.2) and defined it nowhere; `Result` had no field an error could land in, and `adjudicate`'s signature was never given.

**Errors are data, on the same terms as determinations.** The engine throws exactly one class, and only for faults that make the whole run meaningless:

```ts
EngineError { name: 'EngineError', code: EngineErrorCode,
              path: 'registry.rules[41].then[0].factor.den',
              detail: 'denominator is 0', claimId: string | null }
```

**`code` is closed** — all load-time, all fail-closed before any determination exists: `CONTRACT_VERSION_MISMATCH` · `DATA_BUNDLE_INVALID` · `DATA_TABLE_MISSING` · `REGISTRY_SCHEMA_INVALID` · `REGISTRY_INVARIANT_VIOLATION` · `CLAIM_SCHEMA_INVALID` · `OPTIONS_SCHEMA_INVALID` · `PROVIDER_IDENTITY_INVALID` · `LINE_ID_NOT_UNIQUE` · `CONTRACT_SELECTION_TIE` · `DOS_OUT_OF_WINDOW_ALL_LINES`.

**Flags get a shape too** — every §10.4 disclosure and every gap flag in §8.1, §9.1, §9.2, §9.5, §11.2, and §4.5 emits one:

```ts
Flag { code: 'OPPS.8011.RATE_UNAVAILABLE',
       severity: 'info' | 'warning' | 'assumption' | 'gap',
       message: string, ruleId: string | null,
       citation: string | null, lineIds: string[] }
```

`code` and `severity` are both closed, with `code` enumerated in a **flag manifest**, so §18 criteria assert on a code rather than on English prose and the front-ends group flags without parsing sentences. **Every §16 non-goal has exactly one flag code.** Registry lint fails if a rule emits a code absent from the manifest.

### 12.8 Failure containment

**Load-time faults are claim-fatal; evaluation faults are line-local.** A bill processor holding a 250-line UB-04 is better served by 249 adjudicated lines and one that says exactly why it failed than by nothing at all.

- **Claim-fatal** — every §12.7 code. All are properties of the inputs, detectable before evaluation, and not improved by a partial answer.
- **Line-local** — any operator, selector, or effect that faults on one line. That line emits `disposition: "ENGINE_ERROR"`, `status: "NOT_ADJUDICATED"`, `basis: "NONE"`, all amounts `null`, the trace accumulated to the fault, a terminal `Evaluation` with `outcome: "ERRORED"` naming the rule and operator, and a `Flag` at `severity: 'gap'`. Every other line completes. `Result.engineStatus` becomes `PARTIAL`. The fault does **not** repeat in `Result.errors`: §12.7's `EngineErrorCode` is closed to load-time, claim-fatal codes, and a line-local fault is neither. It lives on the line — its `ERRORED` trace entry and its `gap`-severity flag — which is where anyone reading that determination looks.
- **A claim-scoped rule that faults** degrades to `ERRORED` on its single `Evaluation`, sets `PARTIAL`, and leaves `Result.claimAmounts` null with a flag. It does not discard determinations already produced.
- **Totals never absorb a failure.** §10.2 already sums only lines with a computed amount; it gains a disclosure row so a partial result can never read as a complete one.

### 12.9 Process boundary

In the Electron consumer the parsed claim lives in the main process. Surfacing determinations to the UI requires an IPC channel, a serializable determination DTO, and a preload method. The determination record is designed to be structured-clone-safe (no functions, no `Map`/`Set`, no cycles) so it crosses that boundary unchanged. Budget this work; it is not a function call.

---

## 13. Front-ends

### 13.1 Browser tool

Single page, print-first.

1. **Adjudicator** — claim input, adjudicate button, results panel.
2. **Trace panel** — explain mode (§6.1), collapsed to fired rules, expandable to the full set.
3. **Code inspector** — applicability mode (§6.2).
4. **Master table** — all CY2026 SIs, filterable.
5. **Bundling outcome grid** — SI × companion matrix.
6. **Percentage rules** reference.
7. **J1/J2 mechanics** explainer.
8. **Cross-schedule routing** table, reflecting the §3 tiers.
9. **Detail cards** per SI, expandable.

Sections 4, 5, and 8 are **generated from the registry and data at load** via `argSpec` (§4.4), not typed as static HTML. A reference table that can disagree with the engine is worse than no reference table.

**Input must express more than codes.** A bare code list cannot reach the modifier rules in §10.1 or any charge-dependent contract term in §11.3, which would leave them unreachable from the only shipped UI and unfixturable. The input accepts a per-line tabular form: `code[xUnits] [modifiers] [charge] [revCode] [fromDate]`, with the simple space-separated code list remaining valid for the common case. Fixtures use the same syntax.

### 13.2 Options row

Provider identity (TIN/NPI, for §11.2) · off-campus PBD status · 340B and OQR flags · G0378 units (or explicit "unknown," surfaced as a stated assumption) · a claim-level default date of service used only where a line supplies none.

Dates are **per line** (§5.1). Rev 3's single claim-level DOS was wrong against the consumer's `ServiceLine`, which carries `fromDate`/`thruDate` per line.

### 13.3 `837-claim-viewer` integration

Vendored per §12.1, fed by the existing 837 parser via the §5.1 adapter, crossing to the UI per §12.9. Not built in this phase, but the input contract is designed against it from the start.

---

## 14. Persistence

`localStorage` in the browser front-end only. The engine never touches it.

- **Keys** namespaced `opps.v1.*`, with a `schemaVersion` integer.
- **Stored:** last-used option settings (PBD status, 340B, OQR); a history of the last **20** adjudications, evicted oldest-first.
- **History stores inputs, not outputs.** Re-opening **re-runs** the engine rather than replaying a stored determination, so a data or registry update cannot leave a stale verdict on screen.
- **Version mismatch:** a `schemaVersion` the build does not recognize is discarded silently and the control reports how many entries were dropped.
- **Not stored:** PHI. Codes, dates, units, charges, and option flags only — no member names, no account numbers, **and no provider identifiers**. Provider identity is entered per session and never persisted, which means a restored history entry cannot re-run phase 4; the restore surfaces that explicitly rather than silently producing Medicare-only output.
- Visible "clear stored data" control.

---

## 15. Testing

The trace is the test artifact.

### 15.1 Claim fixtures

Placeholder codes are resolved to real ones, because a fixture with `<a Q1 code>` cannot anchor a golden trace.

| Fixture | Expected |
|---|---|
| `59025 84112 81001` | T pays; both Q4 labs bundle under 59025 |
| `99205` alone | `NOT_PAID_RECODE`, recommends G0463 |
| `36415` alone | Q4 unpackaged → converts to A → basis `CLFS`, priced, coinsurance 0 |
| `84112` alone | Q4 → CLFS priced, non-zero |
| `81099` alone | Q4, absent from CLFS → `PAID_UNPRICED`, contractor-priced reason |
| `0526U` alone | Q4, CLFS row at `RATE = 0.00` / `INDICATOR = L` → `PAID_UNPRICED`, **not** `$0.00`, and distinguishable from a bundled line |
| `71271` alone | rated, `minCopay` exactly `$0.00` → coinsurance **0**, not 20% |
| `J3391` alone | `adjCopayMils` used, not `minCopayMils` — coinsurance $1,736.00, not $901,000.00 |
| `<L code>` alone | exempt, no rate → `PAID_UNPRICED`, basis `COST`, disclosed |
| `<S1 code>` alone | pays own APC — has a disposition, a status, and a basis |
| `G0378x8 99284 <S code>` | 8011 fires **and packages** the S line; S does not pay its own APC |
| `0614U` alone | valid PLA shape; in CLFS, absent from Addendum B → payable, **not** `INVALID` |
| `G0463 84112` | Q4 bundles (J2 is a Q4 trigger) |
| `G0463 <Q1 code>` | Q1 **pays** — the asymmetry |
| `<J1> <J1>` | One C-APC controls by payment; second bundles |
| `G0378x8 99284` | 8011 fires → `PAID_UNPRICED`, basis `OPPS_COMPREHENSIVE`, flagged (§9.1) |
| `G0378x4 99284` | 8011 does **not** fire; visit pays own APC |
| `G0378x8 99284 59025` | 8011 blocked by T |
| `<T> <T> <T>` | 100% / 50% / 50%, ranked by payment |
| `0446T <T code>` | rated T line with **no weight** ranks correctly by payment (§3.5) |
| `<SI Y code>` alone | `ROUTED`, basis `ROUTED_DMEPOS`, in the §10.2 disclosure |
| `J1745` (SI K) | **priced** from Addendum B, basis `OPPS_DRUG_ASP` |
| `<SI P code>` alone | `PAID_UNPRICED`, basis `PHP_PER_DIEM`, disclosed |
| `<exempt SI code> <J1>` | exempt line pays inside a comprehensive claim |
| `<Q2 code> <S code>` | Q2 pays alongside S |
| `<Q2 code> <T code>` | Q2 bundles |
| `<Q3 code>` alone | pays own APC **plus** the composite-not-evaluated flag (§9.2) |
| `A4341` | trailing-`0xFF` code resolves after sanitization (§7.1) |
| `84112` + `84112QW` | modifier-keyed CLFS lookup returns distinct rates |
| any line with mod PN | 40% applied, chain visible in trace |
| any claim, 340B on | 0.9951 applied to payment **and** coinsurance |
| any claim | reserved NCCI/MUE appear `NOT_EVALUATED`; phase-1-rejected lines show `NOT_REACHED` |
| contract: percentOfMedicare | `contractMils` set, `medicareMils` unchanged |
| contract: caseRate | `Result.claimAmounts` set with explicit `attribution` |
| contract: lesserOf | named candidates compared, loser recorded |
| no matching contract | phase 4 no-op, flag present |
| `1001`, `123456789012`, `J44.0`, `abc` | Distinct malformed reasons |
| `99999` | `INVALID` |
| Empty input · all-malformed · 200+ codes | Clean guard, no exception |

### 15.2 Golden traces

Rev 5 committed the **full trace** per fixture. Measured against the §18.29 claim size that is 10.8 MiB minified and 22.2 MiB pretty — 881,004 lines — and under `expect(actual).toEqual(golden)`, the mechanism `837-claim-viewer/test/golden/render.test.ts` actually uses, a single one-field mismatch produced 34.2 MB and 881,036 lines of failure output in 9.0 s on that repo's installed vitest 2.1.9, with the differing line at output line 26,263. The precedent does not extend: the largest file in that repo's `test/golden/` is 19,316 B, and its own header states a golden test "is supposed to be boring to keep green."

Two further defects, independent of size. **"Structure not cents" is not implementable** when the committed artifact is the full trace, because the trace contains money (§4.3 retains `amountMils` per term, §10.1.2 records the factor chain) and because two named structural fields are *computed from* money — `bundledUnder` via `highestBy: "rateMils"`, and `examined.ordinal`. And because every trace enumerates every rule considered, **inserting one rule rewrites every golden file**, burying the one-rule change §6.3 exists to review.

**Three artifacts, because one file cannot serve all three jobs.** A golden file is a **projection** of the trace, not the trace. `tools/gen-goldens.mjs` emits, from one run per fixture at `traceLevel: standard`:

- **`/test/traces/<fixture>.structure.json`** — per determination: `lineId`, `resolvedSI`, `effectiveSI`, `status`, `disposition`, `basis`, `bundledUnder`, flag codes, and the ordered `[ruleId, ruleVersion, outcome, epoch]` tuples for rules reaching `FIRED`, `NOT_EVALUATED`, `NOT_REACHED`, `SKIPPED`, `ERRORED`, or `RETIRED`. No prose, no `predicate` echo, no counterfactuals, **no `NOT_FIRED` rows**. This is the reviewable diff, and adding an unrelated rule does not touch it.
- **`/test/rule-coverage.json`** — one corpus-wide rule × fixture × outcome matrix carrying the complete `NOT_FIRED` census and the `scopeExclusions` counts. This is the §15.4 gate artifact, and it is where that census belongs: §15.4 is its only consumer and is corpus-wide by nature. Adding a rule adds one row to one file.
- **`/test/traces/<fixture>.amounts.json`** — `effect.amountMils`, the §10.1.2 factor chain, the final rational, the rounding step, and coinsurance. Regenerated with each data refresh.

**The projection field list is declared once**, in `engine/trace.ts`, as `STRUCTURAL_FIELDS` and `MONETARY_FIELDS`; the canonical serializer asserts their union covers every key it emits, so a new trace field in neither list is a hard error and money can never leak into the structural golden by omission. `bundledUnder` and `examined.ordinal` are money-*derived* structure: they stay in `.structure.json`, and each rank-sensitive fixture additionally commits the ranked candidate list with the field values that produced the order — so a refresh that reorders two lines shows *why* in the diff. Any `.structure.json` change outside a rank-order line is a policy change and requires a registry version bump.

**Budget, asserted:** no committed file under `/test/` exceeds 2 MiB or 50,000 pretty-printed lines.

**The in-browser runner is deleted.** `run.html`, `tools/gen-test-bundle.mjs`, and `/test/traces.generated.js` go with it. It existed only to work around `file://` restrictions on reading the goldens, and it created a second copy of the same truth to do so. `vitest` in `/tools` is the sole authority, and §2.7's dual-entry-point golden run already covers the bundle staff actually execute.

### 15.3 Registry lint

`tools/lint-registry.mjs` fails the build on: duplicate rule `id`; duplicate `order` within a phase; missing `citation`; missing `scopeTarget`; any operator not in the §4.3 closed set; any operator lacking `describe()` or `argSpec` (§4.4); an `argSpec` whose `kind` or `dimension` is outside the §4.4 vocabulary; a rule reading an `epoch` at or after its own sub-band (§2.5); a rule unreachable by any fixture; `dataRequired` naming an unknown data set; a `feeSchedule` contract term naming a non-Tier-1 schedule (§11.3); a ranking selector whose `field` is outside the §4.3 vocabulary or that omits `fallbackField` where the field is nullable in the data; a **cross-band `setStatus`** write, or a second write of `bundleUnder` / `convertSI` / `route` / `setBasis` (§4.3); line-targeted effects in a claim-scoped rule, or claim-level amount effects in a line-scoped rule; and `unimplemented` on a rule without `dataRequired`.

Rules with an unloaded `dataRequired` are exempt from the reachability gate, and the exemption count is reported (§9.5).

### 15.4 Rule coverage

Every rule must be exercised by at least one fixture in **both** `FIRED` and `NOT_FIRED` states — the declarative analogue of branch coverage, and the check that catches a condition written backwards.

**Exempt from this gate:** rules with an unloaded `dataRequired` (§9.5), and any rule whose `NOT_FIRED` branch is unreachable against the loaded data. Each exemption is declared in the registry with a reason and counted in the lint report, so the exemption set cannot grow unnoticed.

### 15.5 Determinism

Adjudicate the same fixture twice in one process and across a reload; canonically serialized traces must be identical. The canonical serializer (§2.4) is what makes this assertable — "byte-identical" is meaningless without a defined serialization.

---

## 16. Explicit non-goals

- NCCI PTP and MUE **evaluation** — slots reserved and reported as unevaluated (§9.5).
- `DELETED` / code-termination checking — suspended, no source on disk (§8.1).
- Q3 composite APC evaluation — flagged, not modeled (§9.2).
- C-APC 8011 rate determination — flagged, not modeled (§9.1).
- Commercial-payer adjudication — §20 annotates divergence; it never adjudicates it.
- J1 complexity adjustment — flagged, not modeled; understates payment on multi-J1 claims (§9.1).
- MPPR same-operative-session scoping — the engine ranks claim-wide; see §19.20.
- Contract-driven re-bundling — architecturally excluded (§11.1).
- Wage-index / locality adjustment — national rates only. This constraint is what puts MPFS, DMEPOS, and AFS in Tier 2.
- Pricing for any Tier 2 or Tier 3 schedule.
- Modifier logic beyond 73/74/PN/PO detection.
- Professional (CMS-1500 / MPFS) adjudication.
- Claim submission, remittance posting, appeals workflow.
- No Surprises Act, Good Faith Estimates, or PPDR pathways — **out of scope by policy**. AB's disputes rest on common-law reasonable value plus FDCPA/FCRA grounds.
- Any network call, telemetry, or AI/API integration.

---

## 17. Known defects in v5 (do not port forward)

**Items 1–4 are inferred from the edit history, not confirmed against the file** — v5 is not present in this folder.

1. **Removed empty-claim guard.** The `if(!lines.length){...}` early return was deleted; `bannerFor`, `money(paidTotal)`, and `highestOf` can run against a line set where no entry has `cls` assigned.
2. **Orphaned `bad` array.** Still declared and referenced in the render template, no longer populated after the classifier rewrite.
3. **Suspected brace imbalance** in the `lines.forEach` `NOTOPPS` branch. If the artifact fails to load rather than failing on click, this is why.
4. **`pre:true` lines bypass the SI loop but are not excluded from every downstream aggregate.**
5. **Inline data blob of unverified provenance** — regenerate, do not port.

The deeper defect is structural: v5's rules were control flow, so nothing could report what it did. Rev 3 exists to fix that, not just the exceptions.

Treat v5 as a **UI and content reference only.**

---

## 18. Acceptance criteria

Each is stated as an assertion a test can pass or fail.

**Build and portability**

1. The shipped browser tool opens from `file://` with no server and no runtime build. `/tools` may require npm; `/dist` and `/web` must not.
2. `/engine` contains no reference to `document`, `window`, `fetch`, `require('fs')`, `Date.now`, `new Date()`, `Math.random`, or `Intl` — asserted by a source scan.
3. In `837-claim-viewer`, under the **unmodified** `tsconfig.json` — no `allowJs`, `checkJs`, `resolveJsonModule`, or `include` edit: (a) `npm run typecheck` exits 0 with a consumer-owned `.ts` module that imports the engine, calls `adjudicate`, and annotates a local with an engine type; (b) after `npm run build:app`, `dist/src/engine/index.js`, `dist/src/engine/data/opps.cy2026.js`, and `dist/src/engine/registry/opps.si.json` all exist and `import('./dist/src/engine/index.js')` resolves; (c) `electron dist/electron/main.js` adjudicates a fixture claim end to end.
4. The determination record is structured-clone-safe: `structuredClone(result)` succeeds and deep-equals the original.
4a. `dist/engine.bundle.js` loads from `file://` and assigns exactly one global, `OppsEngine`, asserted by enumerating `window` before and after.

**Determination correctness**

5. Every input line produces exactly one determination whose `status` is in the §5.1 vocabulary and whose `basis` is in the §10.3 vocabulary.
6. No determination with `disposition: "REJECTED"` has a non-null `amounts.medicareMils`. A bundled line's `0` is not a violation.
7. Attempting to write `amounts.medicareMils` on a determination handed to phase 4 throws. (Scoped to the 3→4 barrier — the one boundary crossed by third-party-authored contract data, and the one §11.1 depends on.)
8. `36415` alone yields `basis: "CLFS"`, a non-zero amount, `coinsuranceMils: 0`, and a trace containing `FIRED` on the Q4→A conversion rule in phase 2 and **no** phase-1 SI A routing rule.
9. `99205` yields `NOT_PAID_RECODE` and a recode instruction naming `G0463`.
10. `G0463` + a Q1 code yields the Q1 line `PAID`; `G0463` + `84112` yields the Q4 line `BUNDLED`. Both traces cite their rule `note`.
11. `0614U` yields a payable determination, not `INVALID` or `MALFORMED`.
12. All 526 SI K and all 41 SI R codes yield a non-null amount. All 85 codes with no Addendum B rate (`P` 4, `L` 48, `H` 19, `H1` 13, `F` 1) yield `PAID_UNPRICED` and appear in the §10.2 disclosure.
13. No amount is emitted for a CLFS row with `INDICATOR = L`, and all 24 unusable-rate Q4 codes yield `PAID_UNPRICED`.
13a. `71271` yields `coinsuranceMils: 0`; `J3391` yields coinsurance from `adjCopayMils`, not `minCopayMils`.
13b. A fired C-APC 8011 leaves no non-exempt line with its own APC amount.
13c. The §8.1 shape census reconciles: the six patterns partition all 18,986 codes after sanitization, with zero unmatched.
14. No determination carries a `basis` beginning `ROUTED_` together with a non-null amount.

**Explainability**

15. Every determination's trace contains at least one `NOT_FIRED` entry, and every `NOT_FIRED` entry **resolves** to a non-empty counterfactual — inline at `full`, or via `counterfactualRef` into `Result.counterfactuals` at `standard`. A `counterfactualRef` with no matching entry is a hard error; an empty-string counterfactual fails.
16. Every `Evaluation` carries a non-empty `citation` and an `epoch` present in §2.5.
17. Applicability mode returns a non-empty rule list for any code in the data set, with no claim argument supplied.
18. Reserved NCCI/MUE rules appear in every trace as `NOT_EVALUATED` or `NOT_REACHED`, and the disclosure list states PTP and MUE were not applied.
19. `tools/diff-registry.mjs` given two registry versions returns added/removed/changed rule ids and the fixture determinations that changed.
20. The §13.1 SI table, bundling grid, and routing table are built at runtime from registry `argSpec` output — asserted by mutating a rule in a test registry and observing the rendered table change.

**Contracts**

21. With no matching contract, every determination has `contractMils: null` and a flag naming the reason.
22. With exactly one matching contract, `medicareMils` is byte-identical to the same fixture run with phase 4 disabled.
23. With two matching contracts, the higher `precedence` applies and the trace records the loser and why.
24. A `caseRate` term populates `Result.claimAmounts` with a non-null `attribution` from the §11.4 vocabulary.
25. A `feeSchedule` term naming a Tier 2 or Tier 3 schedule fails registry lint.

**Quality gates**

26. `lint-registry.mjs` exits 0, and its report lists every coverage exemption with a reason.
27. Every non-exempt rule is exercised in both `FIRED` and `NOT_FIRED` by the fixture set.
28. Canonically serialized traces are identical across two runs in one process and across a reload.
29. Empty input, all-malformed input, and a 250-line claim each complete without an uncaught exception, and the 250-line claim's serialized `Result` at default `traceLevel` is **under 4 MiB**, with the measured size recorded in the build log.
29a. A forced operator fault on one line of a ten-line claim yields nine adjudicated determinations, one `ENGINE_ERROR` naming rule and operator, `engineStatus: "PARTIAL"`, the §10.2 disclosure row, and a claim total excluding the errored line.
29b. Malformed registry, missing data table, and contract-version mismatch each throw `EngineError` with the matching §12.7 code and produce zero determinations.
32. Every thrown error is an `EngineError` carrying a §12.7 code and a non-empty `path` — asserted by source scan for `throw` statements.
33. Every flag carries a manifest `code`, a closed `severity`, and a non-empty `message`; every §16 non-goal maps to exactly one flag code.
30. `DATA_VERSION` and `ENGINE_CONTRACT_VERSION` are present in the DOM, and `DATA_VERSION` names each source file's vintage separately where they differ.
31. Print stylesheet: `@media print` expands all cards and sets `display: none` on interactive controls — asserted by computed style, not by eye.

---

## 19. Open decisions

**Closed in rev 4:**

- ~~**#1 Quarter vintage.**~~ **Closed.** CLFS Q2V1 differs from Q1V1 by zero rate changes and 17 added codes (`0614U`–`0630U`, all `EFF_DATE 20260401`). Build OPPS from January and CLFS from Q2, carry `effFrom` per record (§7.2), and label both vintages separately in `DATA_VERSION` (§18.30). No rate risk.
- ~~**#8 Engine input shape.**~~ **Closed.** `837-claim-viewer/src/model/claim.ts`, interface `ServiceLine`. Four mismatches and one missing field are recorded in §5.1. The one sub-decision remaining is which line identity to use — array index or `chargeId` — noted as #14 below.
- ~~**#9 Contract bundling authority.**~~ **Closed.** Architecturally excluded (§11.1).
- ~~**#4 `termDate` source.**~~ **Closed — no source exists.** Verified against the HCPCS ANWEB file: HCPCS Level II only, covering 6,610 of 18,986 Addendum B codes, and zero of those carry a termination date. Also checked and empty: `ACTN_CD = D` (95 codes, none in Addendum B), the HCPCS Transaction Report (101 discontinued, none in Addendum B), the Corrections workbook (its one `Terminate` row is `S0189`, absent from Addendum B), Addendum B's pass-through expiration column (flags only, no dates), ASC Addendum DD1's `D5` indicator (zero codes), and CLFS Q1→Q2 (zero codes dropped). `DELETED` is suspended per §8.1. **Rev 9 addendum:** the same file is now loaded for the opposite purpose — a **historical validity index** (§7.5.1). It cannot say whether a current code has been deleted; it can say whether an absent code was alive on a given date of service, which is the question retrospective review actually asks.

**Still open:**

2. **Unit semantics.** `units` arrives as an unvalidated string. The institutional XML **does** carry the qualifier as `charge_record_type` — observed values `DA` (days) and `UN` (units), e.g. 6 `DA` of room & board against 746 `UN` of pharmacy — so units are not dimensionless and the adapter must preserve it. Define: is payment `rate × units`? Does MPPR discount per occurrence or per line? What does SI N with units do? And can the qualifier be recovered from the parser, or must the engine treat units as dimensionless?
3. **Multiplier order.** Fix the sequence for PN 40% × MPPR 50% × 340B 0.9951 × OQR 0.9805 and confirm a single rounding point at output (§10.1).
5. **OQR scope.** §10.1 now narrows 0.9805 to conversion-factor-derived lines, using weight-absence as the test (702 codes excluded). Confirm that narrowing against CMS-1834-FC, and confirm the same treatment for PN.
6. **SI G / U basis.** Both are exempt and both carry Addendum B rates. Confirm `OPPS_DRUG_ASP` for G (pass-through drug) and `OPPS_APC` for U (brachytherapy) are the right basis labels.
- ~~**#7 Duplicate identical codes.**~~ **Closed — never collapsed.** Two lines carrying the same code are two lines. Each gets its own `lineId` (§19.14), classifies independently, adjudicates independently, and may bundle independently — one can bundle while the other pays. For every ranking and ordinal (Q-group survivor, MPPR position, `isHighestBy`, `ordinalAtLeast`) each is a **separate occurrence** and is ranked separately; the `among` set counts lines, not distinct codes. Collapsing them would silently change both the packaging outcome and the ordinal positions. `claimContainsCode` tests presence, and `claimUnitsAtLeast` sums across all matching lines — so a code split across two lines with 4 units each satisfies a >=8 test, which is what makes the C-APC 8011 `G0378` count correct on real claims.
10. **Contract data source.** Are AB's contract terms available in any structured form, or is the registry hand-authored per agreement?
11. **File relocation.** OPPS Addendum B is filed under `data files in format/ASC - Ambulatory Surgical Center/`. Move it to `OPPS - Outpatient Prospective Payment/` before the generator hardcodes the path?
12. **C-APC 8011 rate source.** Not in Addendum B. Until identified, a fired 8011 is `PAID_UNPRICED` (§9.1). Is the rate in the OPPS Addendum A release, and is that file obtainable?
13. **Q3 composite combination table.** Not on disk. Until sourced, Q3 pays its own APC with a flag (§9.2).
25. **Bill-type conventions in this feed.** §8.0.2's routing table decodes the first two digits by the textbook reading. The rev-9 test claim carries `81A` alongside room & board and a CAH taxonomy, which do not sit together comfortably. Confirm what the feed actually puts in `type_of_bill` before §8.0.2 ships.
27. **A cross-line date operator for 8011's criterion 2a.** The condition is now sourced exactly (§9.1) and the data is present; the closed operator set simply cannot express "this line's date is within N days of that line's date". Add an operator — it must handle same-day-or-day-before for the visit codes and same-day-only for `G0379` — or declare the date relation an explicit non-goal. It is currently neither, which is the one state to avoid.
26. **Which MPFS total-RVU column defines membership?** `PPRRVU2026_Jan_nonQPP.csv` carries both a non-facility and a facility total. The U6 generator treats a code as MPFS-resident when **either** is non-zero, which is right for Tier 2 *membership* (§3.2 names the schedule and never prices it). If MPFS pricing ever enters scope, the **facility** column is the correct one for a facility claim, and this assumption must be revisited rather than inherited.
- ~~**#22 The JSON input path cannot carry a UB-04 claim.**~~ **Closed, and the premise was wrong.** Institutional claims arrive as **XML**; only CMS-1500s arrive as JSON, so `jsonClaimSource`'s `'1500'`-only mapping is correct for its input rather than incomplete. The viewer has no XML support whatsoever. Resolution: the engine defines its own `ClaimInput` and owns an **XML institutional adapter**, which does not exist anywhere yet and is the first thing milestone 1.1 builds (§2.1).
15. **CLFS `INDICATOR = L`.** 49 rows carry it with a $0.00 rate, 18 of them SI Q4 (§3.1.1). Confirm its meaning against `PUF CLFS CY2026 Q2V1.pdf` before deciding whether those codes are unpriced, contractor-priced, or non-covered.
16. **J1 complexity adjustment.** The combination table is not on disk. Is it in the OPPS Addendum J release, and is that obtainable? Until then multi-J1 claims understate payment (§9.1) — which matters because understating the Medicare benchmark weakens AB's position rather than strengthening it.
- ~~**#14 Line identity.**~~ **Closed.** `lineId = chargeId || 'idx:' + index`, validated for uniqueness at the adapter; a collision throws `LINE_ID_NOT_UNIQUE` (§12.7), which the error taxonomy already provides for. Verified: `chargeId` derives from `chgid` on the JSON path — populated and unique across all four fixtures (`L1`, `L2`, `LW1`…) — and from the X12 `LX` segment's first element on the 837 path, where it defaults to `''`. The empty-string default is the whole reason for the fallback: two lines both taking `''` would collide, and `bundledUnder: ''` names nothing. `Result.meta` records which scheme was used, because a positional id is not portable across a re-parse and a consumer needs to know it is holding one.
- ~~**#17 Bill type as an engine input.**~~ **Closed.** `Institutional.typeOfBill` (FL04) exists in `837-claim-viewer/src/model/claim.ts` and is part of the §2.1 input contract. C-APC 8011's 13X restriction is fully evaluable, as is its date relation via per-line `fromDate`. §9.1's "bill-type eligibility not verified" flag is removed.
18. **Are S1, H1, or K1 excluded from C-APC packaging?** **Provisionally yes** — all three are in the exempt set as of rev 10, flagged `UNVERIFIED_POLICY` (§9.6). 316 codes turn on it, and the error direction costs AB money rather than credibility. **To close it, obtain CY2026 OPPS Addendum D1** (the SI definitions table, not in this folder) or the C-APC exclusion discussion in CMS-1834-FC. Note that the local pricing index returns "Unknown status indicator" for S1 and H1, so it cannot settle this.
19. **Q4's two readings.** Ch. 4 §10.4 C.5 states the rule as an SI list and as "not billed with another separately payable service." They diverge when the only companion is SI `K`, `R`, `U`, or `S1` (§9.2). This spec follows the list; confirm IOCE does the same.
20. **MPPR operative-session scoping.** Ch. 4 §10.5 scopes MPPR to procedures in the same operative session, not to every SI T line on a claim. The engine has per-line `fromDate` but no session identifier. Rank claim-wide and disclose the approximation, or use same-date as a proxy?
- ~~**#23 How far back must the vintage archive go?**~~ **Closed — it does not.** §7.5 adjudicates every claim under current standards. Vintages archive prospectively from the next refresh forward; nothing is backfilled. The residual cost is §7.5.1's 685-code historical-validity problem, which the HCPCS termination file resolves.
- ~~**#24 Does the engine own non-OPPS triage?**~~ **Closed — yes, name it.** §8.0.2 reports a `likelySystem` with confidence and evidence. Advisory only, never an adjudication, and it reports conflicting signals rather than picking a winner.
21. **Contractor-priced lab codes.** Four of the six CLFS-absent Q4 codes are unlisted/NOS lab codes that Medicare pays by contractor pricing (§3.1.1). Should the engine label these `PAID_UNPRICED — contractor priced` distinctly from a genuine lookup miss?

---

## 20. Payer divergence layer

New in rev 7. Medicare's determination is the benchmark; AB's counterparty is usually a commercial payer whose bundling differs. This layer says where, and why.

### 20.1 It is commentary, and the output must never let it read as anything else

Divergence notes are **judgment about likely payer behavior**, not adjudication. §9 states what Medicare does, sourced to Ch. 4. This layer states what a payer may do, sourced to observation, plan language, or industry practice — a categorically weaker claim, and the output must carry that difference visibly.

Three hard rules:

1. **It never alters a determination.** Same immutability as §11.1: the layer receives the frozen Medicare result and emits annotations. `status`, `bundledUnder`, `disposition`, and `effectiveSI` are read-only to it.
2. **It is a separate record type**, not a `Flag`. Flags report gaps and assumptions in the *Medicare* answer; conflating the two would let advisory commentary inherit the authority of a cited rule.
3. **Every note names its confidence and its basis.** A note with neither is not shippable output.

### 20.2 Record shape

```ts
DivergenceNote {
  code: 'DIV.LAB.UNBUNDLED_BY_COMMERCIAL',
  lineIds: string[],
  medicareOutcome: 'BUNDLED',        // what §9 concluded, echoed for contrast
  likelyPayerOutcome: 'SEPARATE' | 'BUNDLED' | 'DENIED' | 'UNKNOWN',
  direction: 'FAVORS_PROVIDER' | 'FAVORS_PAYER' | 'NEUTRAL',
  confidence: 'observed' | 'typical' | 'speculative',
  basis: 'PLAN_LANGUAGE' | 'PAYER_POLICY' | 'INDUSTRY_PRACTICE' | 'AB_EXPERIENCE',
  payerScope: { id?: string[], name?: string[] } | null,   // null = all payers
  rationale: string,
  ruleId: string
}
```

`direction` is the field a bill processor actually acts on: it says whether the divergence, if real, moves the number toward AB or away from it.

### 20.3 Mechanism

A fifth phase, advisory and last:

```
[1] CLASSIFY -> [2] ADJUDICATE -> [3] BENCHMARK -> [4] CONTRACT -> [5] DIVERGENCE
```

Divergence rules are **registry rules like any other** — same shape (§4.2), same closed operator set (§4.3), same `Evaluation` trace, same lint. They live in `registry/divergence/*.json`, carry `scopeTarget` and a `payerScope`, and their only permitted effect is a new `divergenceNote` effect. Reusing the rule machinery is deliberate: the inspector's applicability mode (§6.2) then answers *"what would Medicare do with this code, and where might a payer differ"* from a single query — which is the question the tool exists to answer.

Payer selection follows §11.2's discipline: `payerScope` matched against `payer.id` then `payer.name`; unscoped rules apply to all payers; the trace records every rule considered.

### 20.4 Seed content

Milestone 1 ships a deliberately small set, because a thin well-sourced set is worth more than a broad speculative one:

- Q4 clinical-lab lines that Medicare packages but many commercial plans pay separately.
- SI N packaged services (2,076 codes) — the largest class where Medicare pays $0 and a commercial payer may not.
- J1 comprehensive packaging, which has no general commercial analogue.
- SI B professional-on-facility-claim lines, where a payer may deny rather than expect the `G0463` recode (§8.3).
- Off-campus PBD (`PN`/`PO`) reductions, which are Medicare-specific.

Every seed note is `confidence: 'typical'` or lower until AB's own remittance history substantiates it, at which point it becomes `'observed'` with `basis: 'AB_EXPERIENCE'`. **Nothing in this layer starts at `'observed'`.**

### 20.5 What it is not

Not a commercial-payer adjudication engine, and not a second bundling model. It never produces an alternative `status`, an alternative `bundledUnder`, or an alternative amount. It flags divergence for a human; it does not adjudicate it.

---

## 21. Delivery milestones

Sequenced per §1.2: bundling first, everything else after.

### 21.1 Milestone 1 — "How would Medicare bundle these codes, and why?"

**Definition of done.** Given a set of codes or a claim JSON, the tool states for every line whether it pays or bundles, which line it bundles under, and why — with every rule considered visible in the trace, every gap explicitly flagged, and divergence commentary attached. **No dollar amount appears anywhere in the output.** Rates are loaded and used only as ranking keys inside the engine.

| # | Sub-milestone | Notes |
|---|---|---|
| **1.1** | **Input adapter + line identity** | Claim JSON to engine input per §2.1. Decide §19.14 (`chargeId` vs array index) — this gates everything, since `bundledUnder` is meaningless without it. Reject non-`ub04` `formType`. Strip PHI at the boundary. |
| **1.2** | **Data generator, bundling subset** | §7 with the copay columns deferred: `code`, `si`, `apc`, `weight`, `rateMils`, CLFS membership and rate (needed for the Q4 to A conversion), derived `schedule`. All §7.1 tokenization and sanitization requirements apply **in full** — they are not deferrable, because a silently mis-parsed rate corrupts the ranking that decides bundling. Ships with the §8.1 census self-check. |
| **1.3** | **DSL, bundling subset** | Operators: scope selectors, `siIs`/`siIn`, `codeIn`, `hasModifier`, `unitsAtLeast`, `isExempt`, `always`, `claimContainsAny`/`None`/`Code`, `claimUnitsAtLeast`, `isHighestBy`/`isNotHighestBy`/`ordinalIs`/`ordinalAtLeast`, `optionIs`/`optionAtLeast`/`optionUnknown`, `dosOnOrAfter`/`dosBefore`, `allOf`/`anyOf`/`not`, `unimplemented`. Effects: `setStatus`, `bundleUnder`, `convertSI`, `route`, `setBasis` (routing only), `exempt`, `flag`, `stop`. **Not in milestone 1:** `setAmount`, `multiply`, `setCoinsurance`, `carveOut`, `exclusion`, `lesserOfCandidates`. Every shipped operator carries `describe()` and `argSpec()` from day one — retrofitting them is how counterfactuals drift out of sync with logic. |
| **1.4** | **Evaluator** | Two-pass with fact epochs E0 through E3b (E4 is phase-3 ordinal work, deferred). Band and sub-band ordering, per-effect conflict resolution, `supersededBy`, the append-only trace journal outside the frozen payload (§2.2), deep freeze of determinations and facts. |
| **1.5** | **Phase 1 — Classify** | Six shape patterns with census reconciliation, `INVALID` against every loaded data set, `DELETED` suspended via `dataRequired`, and the REJECTED/ROUTED split. |
| **1.6** | **Phase 2 — Adjudicate** | The milestone proper: exempt set {U, G, H, F, L}; J1 comprehensive control, payment-ranked; C-APC 8011 — now **fully evaluable**, since `typeOfBill` closes the 13X condition and per-line dates close the date relation; Q1/Q2/Q3/Q4 conditional packaging including the Q4 to A conversion and the Q1/Q4 asymmetry; standard dispositions; reserved NCCI/MUE slots reporting `NOT_EVALUATED`. Every bundled line names its controlling line. |
| **1.7** | **Trace + inspector** | Explain mode, applicability mode, registry diff. This is the deliverable, not a debug view — it is what makes the answer defensible rather than merely assertable. |
| **1.8** | **Divergence layer** | §20, with the §20.4 seed set. |
| **1.9** | **Test harness** | `.structure.json` projections and `rule-coverage.json`; registry lint; the both-states coverage gate; determinism. **No `.amounts.json` in milestone 1** — there are no amounts to assert. |
| **1.10** | **Browser front-end, minimal** | Paste codes or drop a claim JSON, get a bundling table, trace panel, and code inspector. Reference tables generated from the registry. **No amount column.** |

**Blocking decisions for milestone 1** — a smaller set than §19, because deferring pricing takes several off the critical path:

- **§19.14 line identity** — blocks 1.1, and therefore everything.
- **§19.7 duplicate identical codes** — blocks the 1.4 fact pass and the Q-group ordinals.
- **§19.2 unit semantics**, partially — milestone 1 needs only the `G0378` unit total for 8011, not the `rate x units` question, which is phase-3 work.
- **§19.18 whether S1/H1/K1 are C-APC-excluded** — 316 codes change bundling outcome on this.

Not blocking milestone 1: §19.3 (multiplier order), §19.5 (OQR scope), §19.6 (G/U basis), §19.10 (contract data), §19.20 (MPPR session scoping) — all phase 3 or later.

**Unverified policy carried into milestone 1.** Four §9 assertions rest on a single reviewer's reading of Ch. 4 and never received adversarial verification: MPPR's weight ranking under §10.5, the 8011 date relation, the Q4 dual reading (§19.19), and the S1/H1/K1 exclusion question. Rules implementing these ship with an `UNVERIFIED_POLICY` flag until a human confirms them against the manual. This matters more than usual here: if a rule is coded wrong and its fixture is written to match, both agree and the error is invisible.

### 21.2 Milestone 2 — Benchmark

§10 in full: percentage rules, the rational-arithmetic stacking chain, coinsurance from `adjCopayMils`, totals, and the disclosure buckets. Adds the deferred copay columns to §7.2, the `.amounts.json` goldens, and epoch E4.

### 21.3 Milestone 3 — Contracts

§11 in full, gated on §19.10 (whether AB's contract terms exist in structured form).

### 21.4 Milestone 4 — Viewer adjacency

The §12.1 vendoring seam, if still wanted. Per §2.1 the programs are coupled by the claim JSON contract rather than by shared source, so this is optional and last — its value is avoiding a second implementation inside the viewer, not making milestone 1 work.
