Read the spec in full (1,279 lines) and re-verified the consumer repo claims I rely on: `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `moduleResolution: "Bundler"`, `outDir: "dist"`, `rootDir: "."`, `include: ["src","test","scripts","electron"]`, no `allowJs`/`resolveJsonModule`); `build:app` = `tsc && build:preload && copy-fonts && write-build-info && vite build`; electron-builder `files` ships `dist/src/**/*` and excludes `!src/**/*`; `dist/src/` = `app data model render renderer sources`; `test/golden/` largest file 19,316 B; vitest 2.1.9; `test/fixtures/x12/837I-long-lines.dat` = 120 SV2 lines; `electron/main.ts` reads `dist/electron/build-info.json` with `fs` inside the asar; `scripts/copy-fonts.mjs`'s header documents the exact `tsc`-copies-nothing trap; `src/model/claim.ts` has `Facility.npi`, `Institutional.typeOfBill`, `ServiceLine.chargeId`, per-line `fromDate`/`thruDate`, and `ClaimWarning`; CI is a single-repo `actions/checkout@v4` → `npm run verify` on windows-latest.

---

# 1. Architecture edit plan, in dependency order

## TIER A — Four foundational edits. Everything below depends on these.

### A1. §2.7 Build story + §12.1 — author the engine in TypeScript, not JSDoc-annotated `.js`

**This is the highest-leverage edit in the plan: it dissolves four separately-reported blockers at once** (missing sibling declaration files, no packaging emit path, `/data` never vendored, JSDoc's lack of `!` under `noUncheckedIndexedAccess`).

Replace §2.7's first paragraph and its two bullets with:

> The engine is authored **once, as TypeScript**. `/tools/tsc` emits `dist/engine/**/*.js` + `.d.ts` for the ESM path; `tools/bundle.mjs` emits `dist/engine.bundle.js` for the `file://` browser tool.
>
> - **The browser tool** loads `dist/engine.bundle.js`, an IIFE build produced by `esbuild` (`--format=iife --global-name=OppsEngine --target=es2022`, no minification, `--loader:.json=json`). **Not a concatenation:** `import`/`export` are syntax errors in a classic script, and §4.3's `allOf`/`anyOf`/`not` composites make `dsl/operators` ↔ `dsl/evaluate` a genuine cycle that a flat concatenation resolves into a TDZ `ReferenceError` at load — the §17 item-3 failure mode this rewrite exists to eliminate. It assigns exactly one global: `window.OppsEngine = {adjudicate, inspect, describeBuild, ENGINE_CONTRACT_VERSION, REGISTRY_VERSION, DATA_VERSION}`. `esbuild` is a build-time-only devDependency in `/tools`, already the established choice in `837-claim-viewer` for its preload bundle.
> - **`837-claim-viewer`** receives the vendored **`.ts` sources** under its own `rootDir`. Its existing `include: ["src", …]` typechecks them under its existing `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` with **no config change**, and its existing bare `tsc` in `build:app` compiles them into `dist/src/engine/` — which `electron-builder`'s `files` allowlist (`dist/src/**/*`) already ships.
>
> All engine relative imports carry the `.js` extension (`import { evalNode } from './dsl/evaluate.js'`), which satisfies both the consumer's `moduleResolution: "Bundler"` and Node ESM at runtime, and matches the consumer's existing convention (`electron/main.ts` imports `'../src/app/claimService.js'`).

In §12.1: **delete** `tsconfig.engine.json`, the `allowJs`/`checkJs` exception, and step 3's JSDoc-satisfies-strict requirement. **Delete** `tools/emit-types.mjs` and `engine/types.d.ts` from §2.6. Replace §12.1's step list with:

> 1. `tools/sync-to-consumer.mjs` vendors `/engine`, `/registry`, and `/data` into `837-claim-viewer/src/engine/`, `src/engine/registry/`, and `src/engine/data/`.
> 2. No consumer tsconfig change, and none is permitted. The vendored `.ts` is typechecked by the consumer's existing first `typecheck` target and emitted by its existing `tsc` in `build:app`. Registry `.json` is the one non-`.ts` payload and needs a copy step: `sync-to-consumer.mjs` emits `scripts/copy-engine-registry.mjs`, added to `build:app` after `tsc`, exactly as `scripts/copy-fonts.mjs` already does for the DejaVu TTFs and for the reason its own header states — "`tsc` only emits .js from .ts — it never copies non-TypeScript assets."
> 3. `/data` is emitted by `gen-data.mjs` as `.ts`, not `.js`, so it travels the same path. The engine is a pure function of the data it is *handed*; the data must ship in the same artifact or the vendored copy has nothing to hand it.
> 4. Raw indexing into §7.3's array-of-arrays is confined to `/engine/data/index.ts`, which builds the code→record index at load and exposes `lookup(code): Record | null` and `lookupClfs(code, modifier): ClfsRecord | null`. No other engine module indexes a data row, and **no engine module uses a non-null assertion (`!`) on a data access** — a `!` there is the mechanism by which a bad row becomes a wrong benchmark silently.
> 5. The vendored copy is generated and never hand-edited. See §12.5.

**Replace §18.3** with:

> 3. In `837-claim-viewer`: (a) `npm run typecheck` exits 0 **with a consumer-owned `.ts` module that imports the engine, calls `adjudicate`, and annotates a local with an engine type**, under the unmodified `tsconfig.json` — no `allowJs`, `checkJs`, `resolveJsonModule`, or `include` edit; (b) after `npm run build:app`, `dist/src/engine/index.js`, `dist/src/engine/data/opps.cy2026.js`, and `dist/src/engine/registry/opps.si.json` all exist and `node -e "import('./dist/src/engine/index.js')"` resolves; (c) `electron dist/electron/main.js` adjudicates a fixture claim end to end.

**Fallback, if the authoring language is not negotiable.** If the spec keeps JSDoc `.js`, then three edits become mandatory and are not optional refinements: §2.6 emits `index.d.ts` / `inspect.d.ts` **beside each `.js` sibling** (an aggregate `types.d.ts` leaves the import typed `any`, which `strict: true` turns into a hard `TS7016`); §12.1 adds a `copy-engine.mjs` step covering `src/engine/**` `.js`/`.json`/data (bare `tsc` with `allowJs` off emits nothing for them, and `!src/**/*` keeps the source tree out of the asar); and engine types crossing into consumer `.ts` must be imported with `import type` because the consumer sets `verbatimModuleSyntax: true`. The TS path is preferred precisely because it removes all three.

### A2. §5.3a (new) + §5.2 + §2.5 — bound the trace

Insert §5.3a immediately after §5.3:

> ### 5.3a Trace levels, and the bound on what is recorded
>
> A scope exclusion is not a consideration. A rule whose `scope` excludes the line produces **no per-line `Evaluation`**; it is recorded once per claim in `Result.scopeExclusions` as `{ruleId, excludedLineIds[]}`. `NOT_APPLICABLE` is therefore removed from the §5.3 `Evaluation.outcome` vocabulary and becomes a property of that per-claim record. `FIRED`, `NOT_FIRED`, `NOT_EVALUATED`, `NOT_REACHED`, `SKIPPED`, `ERRORED`, and `RETIRED` stay per-line — which keeps §18.18's "`NOT_EVALUATED` or `NOT_REACHED`" and §9.5's "`NOT_REACHED` on lines rejected in phase 1" true as written.
>
> `options.traceLevel` is one of `fired` · `standard` (default) · `full`:
>
> - **`fired`** — `FIRED` entries only. What the trace panel renders before expansion (§6.1, §13.1 item 2), and what crosses IPC by default (§12.6). Never legal for a committed golden.
> - **`standard`** — the per-line outcomes above, with `counterfactual` replaced by `counterfactualRef`, an index into `Result.counterfactuals[ruleId]`. The counterfactual is a function of the rule's `when` clause and its operators' `describe()` output, not of the line — which is why §6.2 generates it from a code with no claim supplied — so emitting it once per line per rule is pure amplification: 117 of the §5.2 example's 490 minified bytes.
> - **`full`** — `standard` with counterfactuals inline and scope exclusions per line. Subject to the same budget as §15.2: legal only where the serialized result stays under 2 MiB and 50,000 pretty-printed lines.
>
> **The audit default does not move.** §5.3's requirement that non-firing rules be recorded is a product requirement, not a performance setting: the artifact AB disputes from must be the auditable one by default. What is cut is the amplification, not the record.
>
> **§18.15 restated:** every determination's trace contains at least one `NOT_FIRED` entry, and every `NOT_FIRED` entry resolves to a non-empty counterfactual — inline at `full`, or via `counterfactualRef` into `Result.counterfactuals` at `standard`. A `counterfactualRef` with no matching entry is a hard error, not an empty string. An empty-string `counterfactual` fails.

In §5.2, **replace** `examined: { si: "Q4", factsUsed: ["siCensus"], lineIds: ["2"] }` with:

> `examined: { si: "Q4", factRefs: ["E300:siCensus:J1J2STVQ1Q2Q3"], subjectLineId: "2", ordinal: null, subjectInAmong: true }`

Add to §2.5:

> **An `Evaluation` references a fact; it never copies one.** `examined.factRefs` holds `factId` strings resolving in `Result.facts[epoch]`, where each fact is stored once per epoch as `{factId, kind, dimension, values, lineIds[]}`. `examined.subjectLineId` is the line under evaluation; the contributing lines live in the fact record, named exactly once. Auditability is unchanged — the fact still names which line supplied it, and the `Evaluation` names the fact — but the trace becomes O(rules × lines) instead of O(rules × lines²). Measured: a 250-line claim whose relational `Evaluation`s inline their contributing sets is 42.2 MiB minified and 125.2 MiB pretty (6.79M lines), past GitHub's 100 MB per-file limit; the same content gzips to 1.42 MiB, which is the measure of how redundant the inlined form is.

**Arithmetic for the resulting bound**, to be stated in §18.29: ~25 rules whose scope admits a given line × 250 lines = 6,250 `Evaluation`s; at 373 B minified (490 B minus the 117 B counterfactual) that is ≈ 2.33 MiB. Ceiling asserted at **4 MiB** with the measured figure recorded in the build log.

### A3. §12.7 / §12.8 (new) + §5.1 — an error channel, and failure containment

The document uses "hard error" three times (§4.2, §11.2, §12.2) as a defined term and defines it nowhere; `Result` has no field an error can land in; `adjudicate`'s signature is never given. Insert:

> ### 12.7 Error taxonomy and error shape
>
> **Errors are data, on the same terms as determinations.** The engine throws exactly one class, `EngineError extends Error`, and only for faults that make the whole run meaningless:
>
> ```ts
> EngineError { name: 'EngineError', code: EngineErrorCode,
>               path: 'registry.rules[41].then[0].factor.den',
>               detail: 'denominator is 0', claimId: string | null }
> ```
>
> **`code`, closed — load-time, fail closed before any determination exists:** `CONTRACT_VERSION_MISMATCH` · `DATA_BUNDLE_INVALID` · `DATA_TABLE_MISSING` · `REGISTRY_SCHEMA_INVALID` · `REGISTRY_INVARIANT_VIOLATION` · `CLAIM_SCHEMA_INVALID` · `OPTIONS_SCHEMA_INVALID` · `PROVIDER_IDENTITY_INVALID` · `LINE_ID_NOT_UNIQUE` · `CONTRACT_SELECTION_TIE` · `DOS_OUT_OF_WINDOW_ALL_LINES`.
>
> **`Flag` record shape**, which every §10.4 disclosure and every gap flag in §8.1, §9.1, §9.2, §9.5, §11.2, §4.5 emits:
>
> ```ts
> Flag { code: 'OPPS.8011.RATE_UNAVAILABLE',
>        severity: 'info' | 'warning' | 'assumption' | 'gap',
>        message: string, ruleId: string | null,
>        citation: string | null, lineIds: string[] }
> ```
>
> `severity` and `code` are both closed; `code` is enumerated in a flag manifest so §18 criteria assert on a code rather than on prose and the front-ends group flags without parsing English. Every §16 non-goal has exactly one flag code. `lint-registry` fails if a rule emits a `code` not in the manifest.
>
> ### 12.8 Failure containment
>
> **Load-time faults are claim-fatal; evaluation faults are line-local.** The split is deliberate: a bill processor holding a 250-line UB-04 is better served by 249 adjudicated lines and one line that says exactly why it failed than by nothing.
>
> - **Claim-fatal** — every §12.7 code above. All are properties of the inputs, detectable before evaluation, and not improved by a partial answer.
> - **Line-local** — any operator, selector, or effect that fails on one line. That line emits `disposition: "ENGINE_ERROR"`, `status: "NOT_ADJUDICATED"`, `basis: "NONE"`, all amounts `null`, the trace accumulated to the fault, a terminal `Evaluation` with `outcome: "ERRORED"` naming the rule and operator, and a `Flag` with `severity: 'gap'`. Every other line completes. `Result.engineStatus` becomes `PARTIAL`; the fault repeats in `Result.errors`.
> - **A claim-scoped rule that faults** degrades to `ERRORED` on its single `Evaluation`, sets `PARTIAL`, and leaves `Result.claimAmounts` null with a flag. It does not abort per-line determinations already produced.
> - **Totals never absorb a failure.** §10.2's "sum only lines with a computed amount" already excludes an errored line; §10.2 gains a disclosure row `Engine error, line not adjudicated | per line`, so a partial result can never read as a complete one.

**One consolidated vocabulary edit**, so a reviewer sees the full closed sets in one place — amend §5.1 and §5.3:

- `status` += `NOT_ADJUDICATED` (engine-emitted, not rule-emitted).
- `disposition` += `ENGINE_ERROR`.
- `Evaluation.outcome`: **−** `NOT_APPLICABLE` (moved to `Result.scopeExclusions`, §5.3a), **+** `ERRORED` (§12.8), **+** `RETIRED` (§4.5, B5).
- `Result` += `errors: EngineError[]`, `engineStatus: 'OK' | 'PARTIAL'`, `scopeExclusions`, `counterfactuals`, `provenance` (B5), `meta.build` (D6).
- §12.4 gains the entry-point signature: `adjudicate({claim, options, registry, contracts, data}): Result`, throwing only `EngineError` and only with a load-time code.

New criteria: **29a.** a forced operator fault on one line of a ten-line claim yields nine adjudicated determinations, one `ENGINE_ERROR` naming rule and operator, `engineStatus: "PARTIAL"`, the disclosure row, and a claim total excluding the errored line. **29b.** malformed registry, missing data table, and contract-version mismatch each throw `EngineError` with the matching code and produce zero determinations. **32.** every thrown error is an `EngineError` with a §12.7 code and non-empty `path`, asserted by source scan. **33.** every flag has a manifest `code`, a closed `severity`, and a non-empty `message`.

### A4. §2.2 / §12.2 / §12.3 / §18.7 — the trace is not part of the phase payload

As written the spec is self-contradictory: §2.2 deep-freezes the prior phase's output, §5.1 nests `trace` inside `Determination`, and phases 2–4 all append `Evaluation`s to the same line. Either the freeze is real and appending is impossible, or the trace is exempt and §18.7 asserts less than it claims.

Amend §2.2:

> Each phase receives the previous phase's **determination and fact payload** deep-frozen (§12.3) and may not mutate it. **The trace is not part of that payload.** `trace.js` owns an append-only journal outside it, keyed by `lineId` and by claim for claim-scoped rules; phases may write it and may not read it. `Result.determinations[i].trace` and `Result.trace` are assembled from the journal once, at output, and frozen there together with the §2.4 canonical serialization step. §11.1's guarantee is unaffected: what phase 4 must not alter is phase 3's amounts, which stay inside the frozen payload.

Amend §12.2's opening:

> Two boundaries face input the engine did not produce: (a) claim, options, and provider identity; (b) registry, contracts, and data bundle at load. Both are validated **unconditionally**, in every mode, and a violation is claim-fatal per §12.7 — never a silent coercion. **Phase-output validation is an assertion, not a runtime boundary**: `options.validate ∈ 'inputs' | 'boundaries' | 'off'`, default `'boundaries'`, recorded in `Result.meta.validate` and in the trace header so a trace can never be read without knowing which gates ran. A determination produced under `'off'` is not a defensible artifact and neither front-end offers it. The validator is dependency-free **so the vendored subtree adds nothing to the consumer's `dependencies`** — not because of `file://`, which `bundle.mjs` already resolves by inlining.

Add to §12.3: "Freeze determinations, `claimAmounts`, and the epoch fact sets. Never freeze the trace journal." Rescope §18.7: "attempting to write `amounts.medicareMils` on a determination handed to phase 4 throws." Note in §12.6 that `structuredClone` of a frozen graph returns an **unfrozen** clone, so §12.3's guarantee is in-process and stops at the process boundary.

---

## TIER B — Module structure, coupling, and delivery

### B1. §2.6 — add the missing shared module and state the import layering

§2.3 declares the routing resolver "a shared resolver callable from both phases" and §2.6's `phases/` lists only the four phase files. As laid out, the resolver has to live inside one phase module and the other must import it — a phase↔phase cycle in the exact place the spec says the seam is clean.

Add above `phases/` in §2.6:

> ```
>   routing.ts   the §2.3 shared fee-schedule resolver. A leaf: imports
>                /engine/data only. Must not import phases/ or trace.ts.
> ```

Add to §2.6 after the tree:

> **Import direction is stated, not left to discipline:** `index → phases/ → dsl/evaluate → dsl/operators`, with `routing` a leaf under `data`, and `trace`/`inspect` importing `dsl/operators` only. `dsl/operators` has **zero** imports: composite operators (`allOf`/`anyOf`/`not`) receive an injected `evalNode` callback from the interpreter rather than importing it. Both `phases/classify` and `phases/adjudicate` import `routing`; neither imports the other.

New criterion **2a:** "The `/engine` import graph is acyclic and matches the declared layering, asserted by a source scan. `bundle.mjs` fails the build on any cycle."

### B2. §2.6 / §2.7 — the registry's load path, and one bundler

Do **not** introduce a `gen-registry.mjs` emitting `.js` twins of the rule JSON: a second generated source of truth for the reviewable artifact is a drift surface for a problem that exists only on the `file://` path. And do not assert `.json` is unreadable in the packaged app — `electron/main.ts` reads `dist/electron/build-info.json` with `fs` inside the asar today.

Amend §2.6's `bundle.mjs` line:

> `bundle.mjs`  `/engine` + `/registry/*.json` inlined via esbuild's JSON loader + `/data` → `dist/engine.bundle.js` (classic IIFE)

Add to §2.7:

> The registry ships **inside** `dist/engine.bundle.js` as frozen literals, for the same reason §15.2 gives for embedding anything: under `file://`, `fetch` and XHR of a `.json` sibling are blocked, and a classic script carries no `import` of any kind. The hand-authored JSON remains the reviewable source of truth and is what `verifyRegistry`, `lint-registry.mjs`, `diff-registry.mjs`, and vitest load directly under Node. §2.1's filesystem prohibition binds the engine, not its host: a thin host-side loader outside `/engine` reads the registry and passes it as the `registry` argument, and §18.2's source scan is scoped to `/engine`.
>
> **Both shipped artifacts are tested against the same goldens.** Two builds from one source is a divergence risk no care in `bundle.mjs` removes, and the bundle is the artifact staff actually run. The golden suite is parameterized over the entry point and runs twice: once importing the ESM build, once importing `dist/engine.bundle.js` through a thin shim reading the IIFE global. Byte-identical canonical traces from both, or the build fails.

Amend §18.28 to add "…**and between the ESM build and `dist/engine.bundle.js`** for every fixture." Add **1a:** "`dist/engine.bundle.js` opened from `file://` with `/engine`, `/registry`, and `/test` deleted still adjudicates every §15.1 fixture and answers an applicability query — proving the registry and data are embedded rather than fetched."

### B3. §2.6 / §11.2 — contracts are a side input, not registry content

Contract terms are the highest-churn, most confidential content in the system, and §2.6 places them inside the shipped engine registry. Consequence as written: onboarding one 12-term agreement requires ~24 fixture pairs and their goldens to clear §15.3's reachability gate and §15.4's both-states gate, a re-vendor, a browser-bundle rebuild, and — per §7.4 and that repo's own `test/no-updater.test.ts` — an Electron rebuild plus manual reinstall on every workstation. Negotiated rates also end up committed to a repo and shipped inside a signed installer.

Move `contracts/<id>.json` out of `/engine/registry/` to a top-level `/contracts/`, annotated "loaded at runtime by the front-end; not part of the vendored engine." Add to §11.2:

> Contracts are a **side input**: the caller passes `contracts` alongside `(claim, options, registry, data)`. The browser tool loads a set the user selects; the Electron consumer reads one from a user-chosen path. Onboarding or repricing a contract is therefore a data change under §7.4 — no engine release, no re-vendor, no reinstall.

Add to §15.3 and §15.4: "Contract terms are exempt from the reachability and both-states gates, on the same footing as unloaded `dataRequired` rules and for the same reason — they are not in the shipped registry. Each contract file declares its own `selfTest` block of fixture/expected pairs, run against that file when it loads; the exemption count is reported."

### B4. §11.2 / §9.1 / §19.17 — two consumer-model claims are wrong; both understate the input contract

Verified in `src/model/claim.ts`: `Facility { name, npi, address }` exists and `Claim.facility: Facility | null`; `Institutional { typeOfBill }` exists, commented "FL04 Type of Bill."

Replace §11.2's last line with: "`providerScope` may select on `tin`, `npi`, and `facilityNpi` — all three exist in the consumer's model (`billingProvider.taxId`, `billingProvider.npi`, `facility.npi`); `facility` is nullable, so a facility-scoped term must handle absence rather than assume it."

In §9.1 replace "**bill type is not an engine input at all**" with: "bill type *is* available — `claim.institutional.typeOfBill` (FL04) — and is added to the §5.1 claim-header input as `typeOfBill`, optional, with the 8011 rule flagging 'bill-type eligibility not verified' only when the field is absent, as it is for a manually entered browser-tool claim." Mark **§19.17 closed**; move §16's "8011 bill-type eligibility — not an available input" to a conditional non-goal.

### B5. §4.5 / §12.4 / §5.1 — three versions, rule lifecycle, and what "reproducible" means

Three problems in one place. (i) The registry has no version of its own, so a wording change to one rule bumps `ENGINE_CONTRACT_VERSION` and re-packs the consumer. (ii) Rule `id` is declared public API with no lifecycle: no deprecated/retired state, no removal policy, and no lint catching logic changed under an unchanged `version` — so "never reuse an id for different logic" is an instruction with no enforcement and no exit ramp, and a deleted id is indistinguishable from a scoped-out rule. (iii) §4.5's "historical determinations stay reproducible" has no subject: rule selection keys on DOS only (so `2026.1` and `2026.2` are both applicable and the loader cannot choose), `Result` records no registry or data version, only one data vintage ever ships, and §14 deliberately stores inputs rather than outputs.

Keep the registry directory where it is — the move is churn without benefit — and fix the versioning:

> **Three artifacts, three versions.** `ENGINE_CONTRACT_VERSION` bumps on an input/output shape change **or the removal of a public rule id**; `REGISTRY_VERSION` on any rule change; `DATA_VERSION` on a data regeneration, naming each source file's vintage separately. `registry.requiresEngine` declares a compatibility range asserted at load. A rule correction is a registry bump only: no engine bump, no re-pack, and the golden diff shows a registry version change rather than an engine one.
>
> **Lifecycle.** A rule carries `lifecycle ∈ active · deprecated · retired` and `supersededBy: [ruleId]`. **A rule id is never deleted**; a retired rule stays as a tombstone emitting an `Evaluation` with outcome `RETIRED` naming its successor, so a consumer looking up the id gets an answer instead of silence. `RETIRED` is exempt from §15.4 by construction and counted in the lint report. `lint-registry.mjs` recomputes a canonical hash of each rule's `scope`/`when`/`then`/`epoch` and fails if the hash changed while `version` did not — that is what enforces "never reuse an id." `diff-registry.mjs` classifies each change `added` · `version-bumped` · `deprecated` · `retired` · `REMOVED-WITHOUT-TOMBSTONE`; the last requires a major engine bump.
>
> **Reproducibility is re-derivation, not re-execution.** A determination is re-derivable from a named `(engineContractVersion, registryVersion, dataVersion)` triple by checking out the tag it names. A shipped build always answers with today's registry and today's data, by design: the loader keys on DOS alone, only the current vintage ships (§7.4), and §14 stores inputs. `Result.provenance` carries that triple, survives `structuredClone` across §12.6, and is printed on every §13.1 output — the printed determination is the archival record and must name what to check out.

Add to §16: "Re-execution of a prior quarter's determination inside a current build — retaining every vintage would add ~1.1 MB of emitted OPPS data per quarter to a classic-script bundle that must load from `file://`."

---

## TIER C — Ordering, scale, and the process boundary

### C1. §2.5 / §9.1 — number epochs with gaps, and move the reserved edit slots to band 1500

Two edits that must land together.

**The gap problem.** `epoch` is a literal string on every rule and every `Evaluation`; `Result.facts` is a fixed `{E0..E4}` field list; §15.3 lints ordering from it and §18.16 asserts membership in §2.5. Inserting a barrier renumbers everything downstream and rewrites every golden. Band 4000 already needed a mid-stream split once (E3a/E3b) in rev 5 — the need recurs. §4.2 gave `order` integer gaps for exactly this reason and epochs got no equivalent.

**The band problem is worse, and it falsifies a stated cost claim.** §9.5 promises "adding NCCI later is a data drop plus a `when` clause, not a re-architecture." At band 6000 it is neither. A PTP denial or MUE truncation must `setStatus` on a line band 5000 already statused — and §4.3 makes `setStatus` "last-writer-wins by `order`, **within a band only**" with "a cross-band overwrite is a lint error," which §15.3 fails the build on. So a filled band-6000 edit **cannot deny a line**. A denial also changes the live/paid set E3b and E4 already computed, and MUE truncation changes `unitCount`, read at E0 by `claimUnitsAtLeast` for 8011's ≥8-`G0378` leg — with no barrier after band 6000. IOCE runs edits before packaging; this registry runs them after everything.

Replace §2.5's table and §9.1's band table with:

| Band | Content | Epoch read |
|---|---|---|
| 1000 | Statutory exempt set (§9.6) | `E0` |
| **1500** | **Reserved edit slots (§9.5) — NCCI PTP, MUE.** `alwaysEvaluate` | `E100` |
| 2000 | J1 comprehensive control | `E150` |
| 3000 | C-APC 8011 | `E150` |
| 4000 | Conditional packaging, Q-group (sub-bands a, b) | `E200` / `E300` |
| 5000 | Standard disposition (§9.4) | `E350` |
| 6000 | Reporting-only disclosure slots. `alwaysEvaluate` | `E400` |

| Epoch | Recomputed after | Adds |
|---|---|---|
| `E0` | initial | SI census, code census, per-code unit totals, rank orderings, presence flags |
| `E100` | exempt determination (1000) | exempt line set |
| `E150` | **reserved edit slots (1500)** | **denied line set, post-truncation unit totals** |
| `E200` | J1 / 8011 control (2000–3000) | controlling line, bundled set |
| `E300` | companion packaging (4000a) | lines bundled by companion trigger |
| `E350` | Q-group survivor tiebreak (4000b) | surviving unpackaged set, effective SI after conversions |
| `E400` | standard disposition (5000) | final live/paid set |

> **Epochs are numbered with gaps, not named in sequence.** The lint compares epoch numbers arithmetically, so a new barrier is inserted at an unused number without touching any existing rule's `epoch` or any committed trace — the same reason §4.2 gives `order` gaps. `Result.facts` is a **map keyed by epoch id**, not a fixed field list, and §18.16 asserts the epoch is declared in the loaded registry's epoch table rather than matching a literal in this document.

In §9.5, replace "Adding NCCI later is a data drop plus a `when` clause, not a re-architecture" with:

> The slots sit at band 1500, before any packaging or disposition rule, because an edit that denies a line or truncates units invalidates every downstream fact and cannot legally overwrite a status written in a later band (§4.3). Filling them is a data drop plus a `when` clause **only because of that placement**; after disposition it would be a re-banding of the whole registry, a re-epoching of phases 2 and 3, and a regeneration of every golden. Band 1500 is declared `alwaysEvaluate` so a `stop` cannot skip it and §18.18 stays satisfiable.

### C2. §4.3 — memoize rankings; declare a line-count limit

`isHighestBy` / `isNotHighestBy` / `ordinalIs` / `ordinalAtLeast` take `{field, among, tiebreak, fallbackField?}` where `among` is an arbitrary selector object. The ranked set depends only on `(field, among, tiebreak, fallbackField, epoch)` — not on the subject line — but nothing says so, and §2.5's E0 "payment rank orderings" fact cannot cover it because `among` is known only from the registry. Measured with 8 relational rules: naive per-line 9.4 ms at 250 lines, 148 ms at 1,000, 2,535 ms at 4,000; memoized 0.22 / 0.92 / 1.97 ms. Immaterial at §18.29's 250 lines, which is exactly why it will not surface in testing.

Add after "Relational conditions":

> **A ranking is computed once per `(field, among, tiebreak, fallbackField, epoch)`, never once per subject line.** At load the evaluator collects the distinct `among` selectors appearing in relational conditions; at each epoch barrier it materializes one ordering per tuple plus a `lineId → ordinal` map. The four relational operators are then map lookups and `examined.ordinal` is read from the map. §2.5's E0 rank-orderings fact does not cover this on its own; the barrier materializes the registry-derived tuples and §5.4 emits them as facts like any other.
>
> **The engine declares a line-count limit.** `index` exports `MAX_CLAIM_LINES = 400`. A claim above it returns a single load-time `EngineError`, not a degraded adjudication. §18.29's 250-line case is a test input, not a stated bound, and trace volume (§5.3a), fact size (§2.5), and IPC payload (§12.6) are all superlinear in line count.

### C3. §12.6 — split the IPC channel; keep the engine in main

Measured V8 structured clone of a 250-line result at the trace volume §5.3 implies: 10.03 MiB wire, 25.7 ms serialize + 49.2 ms deserialize before any pipe transfer, ~24 MiB heap per resident copy — 48 MiB once the renderer holds one alongside main. The consumer's surface is request/response per claim (`ipcMain.handle('claim:getDetail', …)`), so it crosses on every detail open, not once per session.

Replace §12.6's closing sentence ("Budget this work; it is not a function call.") with:

> Size the DTO before writing it. The channel is split, and this is a design constraint rather than an optimization:
>
> - `claim:adjudicate` returns determinations at `traceLevel: "fired"` (§5.3a) — per-line status, disposition, effective SI, basis, amounts, flags, fired rule ids, and `provenance`. Under 200 KiB at 250 lines.
> - `claim:getTrace(sessionId, lineId, level)` returns one line's `Evaluation[]` on demand. The renderer never holds the whole trace.
>
> §18.4's `structuredClone` assertion applies to both payloads. Note that a structured clone of a deep-frozen graph is **not** frozen: §12.3's guarantee is in-process and stops at the boundary. The renderer treats its copy as read-only by convention and the preload exposes no mutating method.
>
> **The engine stays in the main process.** It is DOM-free and pure, so placement is a cost decision — but this app's product is rendering and exporting claim facsimiles, and PDF generation is main-side (`src/render`, node `fs` fonts via `copy-fonts.mjs`). A determination that ever prints must be main-side, or it crosses back.

---

## TIER D — Failure modes

### D1. §7.5 (new) — load-time table integrity

§7.1's guarantees are all generator-side; §12.2 lists "data bundle" among validated boundaries and names no invariant. §9.5's `dataRequired` suspension is a *rule*-level concept; no core table declares itself required. So "CLFS did not load" and "this code is not in CLFS" produce the same output — and §3.1.1 makes `PAID_UNPRICED` the *correct* answer for 24 real Q4 codes, so an empty CLFS table converts all 1,346 SI Q4 codes to a plausible `PAID_UNPRICED` and every criterion outside the dollar suite still passes. The browser tool makes this the likely failure rather than the exotic one: `/data` loads as classic `<script src>` under `file://`, where a missing or renamed file defines no global and raises nothing.

> ### 7.5 Load-time table integrity
>
> Every generated file emits a header alongside its rows:
>
> ```ts
> { table: 'clfs', vintage: 'CY2026 Q2V1', source: 'PUF_CLFS_CY2026_Q2V1.csv',
>   fields: [...], recordCount: 2179, distinctCodes: 2055, digest: '<sha256 of the row block>' }
> ```
>
> §12.2's data-bundle validation asserts, throwing `DATA_TABLE_MISSING` or `DATA_BUNDLE_INVALID`: every required table present; each row block's `digest` matches; `recordCount` equals the actual row count. **The load-time assertion is self-consistency, not a hardcoded census** — a literal count in a shipped assertion would red-line every quarterly refresh (§18 rewrite, E6). The census is a *reported* baseline diff, not a load-time gate. These headers are also the single origin of `DATA_VERSION`, which otherwise has none, and are what let it name each vintage separately as §19.1 requires.

New criterion **1b:** "Deleting or truncating any `/data` file makes the engine throw with `DATA_TABLE_MISSING` or `DATA_BUNDLE_INVALID` and produce zero determinations — asserted in both front-ends, including the `file://` classic-script path where a missing file is otherwise silent."

### D2. §12.2 / §15.3 — ship the registry verifier

Every invariant the evaluator's correctness depends on is checked by a tool §2.6 annotates "build-time only, never shipped," while §2.1 makes the registry a caller-supplied input and §12.2's own justification is that it is "JSON a human will hand-edit." A per-object schema validator cannot substitute: the §15.3 gate list is cross-rule. A duplicate `order` has **no runtime symptom at all** — it silently makes trace order depend on array order, voiding §2.4 and §18.28 with nothing looking wrong.

Add to §12.2:

> **Schema validation is not registry validation.** `dsl/verifyRegistry.ts` ships **inside** `/engine` and implements the *structural* subset of §15.3 — every gate that is a property of the registry alone, excluding the fixture-dependent gates, which stay in `/tools`. It runs once at registry load and throws `REGISTRY_INVARIANT_VIOLATION` naming the rule id and violated invariant. `lint-registry.mjs` calls the same module rather than reimplementing it, so build-time and runtime gates cannot drift. Cost is not a reason to skip it: the registry is on the order of a hundred rules and every gate is O(n) or O(n log n) over rules, once per load — orders of magnitude below per-claim evaluation.

New criterion **34:** "A registry with two rules sharing an `order` within a phase, and a registry with a rule reading a later epoch, are each rejected at load by the **shipped** engine with `REGISTRY_INVARIANT_VIOLATION` naming the rule id."

### D3. §4.4 — trace generation may never fail an adjudication

§18.15 turns `describe()`'s output into a **runtime** invariant on every claim, and §4.4's only enforcement is a build-time check that the function exists. On a 250-line claim that is thousands of calls per adjudication over hand-editable argument shapes.

Add after "Registry lint fails the build if any operator in use lacks either function":

> The recorder isolates it. Each `describe()` call is guarded; on a throw or empty return, the `Evaluation` is emitted with `counterfactual: null`, `counterfactualError: {operator, detail}`, and the machine-readable `predicate`/`argSpec` tree it already carries — which is what §13.1's generated tables consume anyway, so the trace loses prose and nothing else. The claim gains one `Flag` with `severity: 'warning'`. Adjudication is unaffected, `engineStatus` stays `OK`, and no amount changes. The same isolation applies to `argSpec`, which §13.1's tables call at load: a failure degrades one table row to a named placeholder rather than failing the page.

Extend §18.15: "…asserted additionally against a test registry whose operator's `describe()` throws: the adjudication completes, amounts are byte-identical to the same fixture with a working `describe()`, and the flag is present."

### D4. §4.5 — a date of service outside the loaded window is a determination, not just a flag

Because the rule set is selected *by* DOS, an out-of-window date selects zero rules: nothing fires, nothing is scoped out, the trace is empty — failing §18.5 (no status, no basis) and §18.15 (no `NOT_FIRED` entry) with no error raised. `ServiceLine.fromDate` is an unvalidated string and nothing bounds what an 837 carries.

Replace §4.5's first bullet with:

> The engine checks each line's `fromDate` against the loaded registry's aggregate effective window **before** evaluation. A line outside it is emitted with `disposition: "REJECTED"`, `status: "NOT_ADJUDICATED"`, `basis: "NONE"`, amounts `null`, a `Flag` with code `ENGINE.DOS_OUT_OF_WINDOW` naming the date and the loaded window, and a single synthetic `Evaluation` recording the window check so the trace is non-empty and self-explaining. It reaches no phase. A `fromDate` absent or not `YYYYMMDD` after adapter normalization is `CLAIM_SCHEMA_INVALID`, not a silently defaulted date; §13.2's claim-level default applies only where a line supplies none and is recorded as an assumption when used. A claim on which *every* line is out of window is still a `Result`, not a throw: all lines rejected as above, `engineStatus: "PARTIAL"`, and a §10.2 disclosure row. The loaded window is reported in `Result.meta` regardless.

Add to §10.2: "| Date of service outside the loaded rule window (§4.5) | per line |". New criterion **11a**.

### D5. §12.2 / §5.1 — validate `lineId` uniqueness

§19.14 records that "`chargeId` uniqueness is unverified" and then leaves the failure mode unaddressed whichever candidate wins. A collision silently corrupts `bundledUnder` — §9.6's "the field staff actually use when disputing" — and every relational `among` resolution, with no symptom: the trace still names *a* line.

Add to §12.2's validated list, and to §5.1's mismatch table:

> Claim-input validation asserts every `lineId` is present, non-empty, and unique; a duplicate throws `LINE_ID_NOT_UNIQUE` naming the offending index. Required independent of §19.14: an index is unique by construction but unstable across re-parses, `chargeId` is stable but unverified. Whichever is chosen, the adapter must guarantee uniqueness and the engine must verify it. Input is the only point where it is detectable.

New criterion **5a**.

### D6. §12.9 (new) / §18.30 — build introspection

The only build-introspection requirement in the document is a DOM assertion, which the Electron consumer cannot satisfy: no updater, no network, no telemetry (verified by that repo's `test/no-updater.test.ts`), quarterly refresh is a manual reinstall, and §1.1's users do not read JavaScript. When a determination looks wrong on a workstation there is no specified way to learn which engine, registry, and data produced it.

> ### 12.9 Build introspection
>
> `index` exports `describeBuild()`, returning a structured-clone-safe object and no prose: `{engineContractVersion, registryVersions[{file, version, effectiveFrom, effectiveTo}], registryDigest, ruleCount, suspendedRules[{ruleId, dataRequired}], dataTables[{table, vintage, source, recordCount, digest}], validateMode, coverageExemptions[{ruleId, reason}]}`. Every `Result` carries the same object at `meta.build`, so a printed determination is self-identifying and a golden trace pins the vintages that produced it.

Replace §18.30: "`describeBuild()` returns every §12.9 field with no null or empty value and names each source vintage separately where they differ. Both front-ends surface it without a console — the browser tool in the DOM (asserted there, **read from the loaded bundle, not the page**, so a stale bundle is visible on screen), the Electron consumer through the §12.6 channel on a Diagnostics panel (asserted by e2e). Every printed determination carries the engine contract version and the data vintages."

---

## TIER E — Testing and CI mechanics

### E1. §15.2 — three artifacts, one budget; delete the in-browser runner

The single largest testability defect. Measured on the §5.2 record (490 B minified, 693 B pretty) at the §18.29 claim size: ~95 line-scoped rules × 250 lines = 23,750 `Evaluation`s = 10.8 MiB minified, 22.2 MiB pretty, 881,004 lines. Under `expect(actual).toEqual(golden)` — the mechanism `test/golden/render.test.ts` actually uses — a single one-field mismatch produced 34.2 MB and 881,036 lines of failure output in 9.0 s on the consumer's installed vitest 2.1.9, with the differing line at output line 26,263. The precedent §15.2 cites does not extend: the largest file in `test/golden/` is 19,316 B against 9.7 MB for that repository's whole history, and its own header states a golden test "is supposed to be boring to keep green," which is why it is held to four cases. Even under the narrow reading, with scope exclusions dropped and only the ~25 admitting rules recorded, the same fixture is ~5.8 MiB over ~232,000 lines — still 300× the largest golden that repo has ever reviewed.

There is a second, independent defect: **"assertions are on structure … dollar assertions live in a separate suite" is not implementable**, because the artifact being committed is the full trace and the full trace contains money (§4.3 retains each term's `amountMils` in `Evaluation.effect`; §10.1.2 records the factor chain and the rounding step), and because two of the structural fields named as assertion targets are computed *from* money — `bundledUnder` via `bundleUnder: {highestBy: "rateMils"}` and the Q-survivor's "highest-paid" rank, and `examined.ordinal` is the raw rank. A rate change with zero SI change rewrites structural fields on exactly the three rank-sensitive fixtures (`<J1> <J1>`, `<T> <T> <T>`, `0446T <T code>`).

And a third: because every trace enumerates every rule considered, **inserting one rule rewrites every file** in `/test/traces/`, burying the one-rule change §6.3 exists to review.

Replace §15.2 entirely:

> ### 15.2 Golden traces
>
> **Three artifacts, because one file cannot serve all three jobs.** A golden trace file is a **projection** of the trace, not the trace. `tools/gen-goldens.mjs` emits, from one adjudication run per fixture at `traceLevel: standard`:
>
> - **`/test/traces/<fixture>.structure.json`** — per determination: `lineId`, `resolvedSI`, `effectiveSI`, `status`, `disposition`, `basis`, `bundledUnder`, flag codes, and the ordered `[ruleId, ruleVersion, outcome, epoch]` tuples for rules that reached `FIRED`, `NOT_EVALUATED`, `NOT_REACHED`, `SKIPPED`, `ERRORED`, or `RETIRED`. No prose, no `predicate` echo, no counterfactuals, **no `NOT_FIRED` rows**. This is the reviewable diff, and adding an unrelated rule does not touch it.
> - **`/test/rule-coverage.json`** — one corpus-wide rule × fixture × outcome matrix carrying the complete `NOT_FIRED` census and the `Result.scopeExclusions` counts. This is the §15.4 gate artifact, and it is where the NOT_FIRED census belongs: §15.4 is the only consumer of that census and it is corpus-wide by nature. Adding a rule adds one row to one file.
> - **`/test/traces/<fixture>.amounts.json`** — `effect.amountMils`, the §10.1.2 factor chain, the final rational, the rounding step, and coinsurance. Regenerated with each data refresh.
>
> **The projection field list is declared once**, in `engine/trace.ts`, as `STRUCTURAL_FIELDS` and `MONETARY_FIELDS`, and the canonical serializer asserts their union covers every key it emits — a new trace field in neither list is a hard error, so money can never leak into the structural golden by omission. `bundledUnder` and `examined.ordinal` are money-*derived* structure: they stay in `.structure.json`, and each rank-sensitive fixture additionally commits the ranked candidate list with the field values that produced the order, so a refresh that reorders two lines shows *why* in the diff. Any `.structure.json` change outside a rank-order line is a policy change and requires a registry version bump (B5).
>
> **Budget, asserted.** No committed file under `/test/` exceeds 2 MiB or 50,000 pretty-printed lines. A fixture that would exceed it commits a **digest** — per line `{status, disposition, effectiveSI, basis, bundledUnder}` plus a per-rule roll-up `{ruleId: {fired, notFired, notEvaluated, notReached, skipped}}` — and §15.1 marks it a digest fixture. The 200+-code guard fixture is a digest fixture: its stated expectation is "clean guard, no exception," and a digest plus stable per-rule counts asserts exactly that. Full traces are written to a gitignored directory for inspection and asserted by digest, which is what §15.5 and §18.28 actually need.
>
> **There is no in-browser test runner.** `tools/gen-test-bundle.mjs`, `/test/traces.generated.js`, and `/test/run.html` are deleted from §2.6. §15.2 itself concedes that vitest is the authority and `run.html` "a convenience for staff" — and §1.1's staff are bill processors who do not run test suites. What it cost was a committed second copy of the largest artifact in the repo with no staleness gate, and (at the sizes above) an 11–14 MB embedded classic script costing 206 ms to parse before `run.html` does any work. Staff who need to see a trace offline use the browser tool's own explain panel (§13.1 item 2), which runs against the live registry rather than a frozen copy of it. `file://`'s block on `fetch`/XHR therefore constrains only `dist/engine.bundle.js`, which `bundle.mjs` already resolves by inlining (B2).
>
> `/tools/package.json` carries `vitest`, `typescript`, and `esbuild` as devDependencies. Build-time only (§18.1).

### E2. §15.3 → §15.3 + §15.3.1 — split the lint from the coverage report

Two of §15.3's listed conditions ("a rule unreachable by any fixture," and the exemption reporting §9.5/§15.4 tie to the same pass) require adjudicating the whole fixture corpus. So `lint-registry.mjs` is not a static lint, cannot run until the data generator, evaluator, and all fixtures work, and makes a registry typo and a missing fixture indistinguishable failures. Every other condition in the list is pure static analysis.

§15.3 keeps only static checks and gains: "`lint-registry.mjs` imports `dsl/operators`, `dsl/verifyRegistry`, and the registry JSON and nothing else — no evaluator, no `/data`, no fixtures — so it is runnable on day one and a registry error never presents as a coverage failure. **The gate list is partitioned in the source:** `dsl/verifyRegistry` (shipped, registry-only invariants) and `lint-registry.mjs` (build-only, fixture-dependent gates plus the exemption report). A gate lives in exactly one of the two, and a test asserts the partition covers the printed list with no gate in neither."

Add §15.3.1: "`tools/coverage-report.mjs` adjudicates the full corpus and emits `/test/rule-coverage.json` plus the derived and declared exemption sets with reasons and the reachability verdict. It is the gate for §15.4 and §18.27 and runs after the generator and evaluator in the §15.6 stage order." Change §18.26 to assert both tools exit 0 and that the coverage report, not the lint, lists the exemptions.

### E3. §15.4 — derive exemptions; the pair changes because §5.3a removed `NOT_APPLICABLE`

§4.3 introduces `always` as an unconditional predicate precisely because §9.4's `N`/`S` dispositions and §9.2's Q3 flag require it. A rule whose `when` is `always` can never reach `NOT_FIRED` by construction — and §9.4 alone carries ~16 such dispositions, so as written the registry ships with ~20 hand-written exemptions for a structural fact, weakening exactly the check the gate provides. **Note this supersedes the alternative fix of making the required pair `FIRED` + `NOT_APPLICABLE`: §5.3a removes `NOT_APPLICABLE` from the per-line outcome vocabulary, so that pair no longer exists.**

Replace §15.4's first two paragraphs:

> Every rule is exercised in both of its reachable states. For a rule with a non-trivial `when`, those are `FIRED` and `NOT_FIRED`. For a rule whose `when` reduces to `always`, `NOT_FIRED` is unreachable by construction — scope admission decides everything — so the required pair is `FIRED` and **scope-excluded on at least one fixture line**, read from `Result.scopeExclusions` (§5.3a). That is the same check (a scope written backwards fails it) and needs no declared exemption.
>
> **Exemptions are derived, not declared.** `coverage-report.mjs` computes the unreachable set structurally: `when` reducing to `always` directly or through `allOf`/`anyOf`; unloaded `dataRequired`; `lifecycle: retired`; contract terms (B3). A *hand-declared* exemption is legal only for a non-tautological `when`, must name the fixture it is unreachable against, and is rejected on a rule the derivation already exempts. This inverts the default: the ~20 tautological dispositions cost no ceremony, and the rare hand-declared exemption is what a reviewer actually looks at — today's wording buries a condition accidentally written as `always` among twenty legitimate ones.
>
> **Coverage probes are generated.** `tools/gen-coverage-fixtures.mjs` emits one single-line fixture per disposition rule, choosing the lowest code in the data matching the rule's scope and writing the chosen code into the committed fixture so a data refresh cannot silently re-pick it. Probes assert `status`, `basis`, and the firing rule id only; they commit no trace and are excluded from the §15.2 corpus and budget.

### E4. §15.1 — the fixture table is sized by §15.4, and today it fails the gate on day one

§15.4 fails the build unless every non-exempt rule fires. §15.1 fixtures **two** of §10.1's seven percentage rules (mod PN, 340B) — nothing for mod 73, 74, PO, or OQR — and **three** of §11.3's eight term types (`percentOfMedicare`, `caseRate`, `lesserOf`); `feeSchedule`, `perDiem`, `stopLoss`, `carveOut`, `exclusion`, and §18.23's two-matching-contracts case have none. Neither §15.4 exemption applies: these are not `dataRequired`-suspended and their FIRED branch is plainly reachable (mod 73/74 need only a modifier; PO needs `G0463`; OQR needs a CF-derived line). §18.26 requires `lint-registry.mjs` to exit 0 and the consumer's CI gate is all-or-nothing, so this blocks green on day one.

Add these rows:

> `| any line with mod 73 | 50% applied, chain visible in trace |`
> `| any line with mod 74 | 100% applied — rule FIRED with no reduction, not NOT_FIRED |`
> `| G0463 + a non-drug-admin line, PBD excepted, mod PO | 40% on G0463 only; companion untouched |`
> `| CF-derived line + a K code, OQR failure on | 0.9805 on the CF-derived line only; the K line untouched (§10.1) |`
> `| contract: feeSchedule naming CLFS | Tier 1 rate becomes contractMils |`
> `| contract: perDiem, 3 covered days | Result.claimAmounts set, attribution explicit |`
> `| contract: stopLoss, threshold crossed / not crossed | FIRED and NOT_FIRED in one twinned pair |`
> `| contract: carveOut | matching line excluded from the enclosing claim-level term |`
> `| contract: exclusion | line contractMils 0, medicareMils unchanged |`
> `| two matching contracts | higher precedence applies; loser and reason in trace (§18.23) |`
> `| forced operator fault on one line of ten | nine adjudicated, one ENGINE_ERROR, engineStatus PARTIAL (§12.8) |`
> `| line dated 20251215 against a CY2026 registry | NOT_ADJUDICATED, non-empty trace, other lines normal (§4.5) |`

And after the table: "**The fixture set is sized by §15.4, not by illustration.** Any rule added to the registry adds a fixture pair — or a generated probe (E3) — here in the same change."

### E5. §15.5 → determinism *and exactness*; §15.6 (new) → regeneration and CI

§15.5 as written tests idempotence, which §18.2's source scan already largely guarantees, and leaves three real defects open.

Replace §15.5:

> **Determinism and exactness.** Four assertions.
> 1. *Idempotence* — the same fixture serializes identically twice in one process and across a reload.
> 2. *Line-permutation invariance* — adjudicate every multi-line fixture under a fixed set of input permutations; the canonically serialized result is identical modulo `lineId` remapping. This is the assertion that actually protects a two-pass epoch evaluator: §2.5's facts include set-valued members and §12.3 replaces `Set`/`Map` collections with frozen plain structures **without stating an order**, so their serialized order is line-arrival order and two logically identical claims diverge — which (1) can never see. To make it satisfiable, `dsl/freeze` emits every set-valued fact as an array sorted by a declared key (`lineId` ascending), and §12.3 says so.
> 3. *Serializer totality* — `serialize(parse(serialize(x)))` is byte-identical to `serialize(x)`, and a fixture carrying an explicit `undefined` property serializes identically to one omitting it. §2.4 requires "no undefined-vs-absent ambiguity" and nothing tested it.
> 4. *Accumulator exactness* — the §10.1.2 rational accumulator is **`bigint`**, not `number`, and after each GCD reduction the engine asserts the reduced pair is representable, throwing and naming the rule and factor chain if not. The reason is arithmetic, not caution: `J3391`'s rate is $4,505,000.00 = 4.505e9 mils, and 340B `{9951,10000}` × OQR `{9805,10000}` × MPPR `{1,2}` × PN `{2,5}` × a 150% contract term gives an unreduced numerator of ~1.3e19, about 1,460× `Number.MAX_SAFE_INTEGER`. GCD reduction rescues it to ~2.6e14 — 34× headroom — but only because that numerator happens to carry factors of ten; a contract factor coprime to it (`{7,9}`) removes the rescue, and the failure mode is a silently wrong benchmark, not an error. §18.28's byte-identical-across-reimplementation claim cannot rest on that coincidence, and `bigint` also removes the ambiguity from the TypeScript port.

Add §15.6:

> ### 15.6 Regeneration, stage order, and CI
>
> **The gate.** `/tools/package.json` defines `verify` as this repo's definition of done, in dependency order: `gen-data` → `lint-registry` (static, §15.3) → `vitest run` (goldens §15.2, determinism §15.5, executable counterfactuals §15.7) → `coverage-report` (§15.3.1, gating §15.4) → `bundle` → `sync-to-consumer --check`. A workflow runs it on every push and pull request, mirroring the consumer's own `npm run verify` gate. Every §18 criterion names the stage that asserts it, so a criterion with no owning stage is visible as unimplemented rather than assumed.
>
> **Regeneration is `UPDATE_TRACES=1 npx vitest run`**, matching the consumer's documented `UPDATE_GOLDENS` convention. A test asserts `UPDATE_TRACES` is unset whenever `CI` is set, so CI can never self-heal a failing golden.
>
> **Generated artifacts are fresh.** Re-running every generator in `/tools` leaves the working tree unchanged — asserted, because the repo commits generated artifacts (`/data`, `dist/engine.bundle.js`, `/test/rule-coverage.json`, the vendored consumer subtree) and a stale `dist/engine.bundle.js` means the only front-end built in this phase (§13.3) executes last quarter's rules while every golden passes green against source. Every committed generated file carries a header naming its generator and the source content hash it was built from.
>
> **The quarterly refresh runs in this order:** (1) `tools/diff-data.mjs` reports, for every code named in a §15.1 fixture, whether `si`, `apc`, `weight`, `rateMils`, or CLFS presence changed — that list is the set of goldens legitimately expected to move; (2) `diff-registry.mjs` reports rule and determination changes; (3) regenerate; (4) the commit carries the output of (1) and (2) in its message, and any `.structure.json` change not explained by them blocks the merge. Before shipping, record the measured January→April Addendum B SI-change count here, so the corpus's refresh stability is a measured property rather than an assumption — CLFS Q1→Q2 (§3.5: zero rate changes, 17 added codes) is the only churn figure measured anywhere in this document, and SI reassignment is the axis that rewrites structural goldens.

### E6. §15.7 (new) — executable counterfactuals

§18.15 asserts only that a counterfactual is non-empty — a string-length check on the most valuable thing the declarative design produces. §4.4 already requires every operator to ship `argSpec` returning a closed-vocabulary structure with composites exposing a `children` tree, which makes the counterfactual machine-actionable.

> ### 15.7 Executable counterfactuals
>
> For every `NOT_FIRED` `Evaluation` whose unsatisfied condition resolves, via `argSpec`, to a single satisfiable leaf — `claimPresence` over `si` or `code`, `claimQuantity` over `units` or `money`, or a `context` option — the harness constructs the minimal mutation the counterfactual names (append a line bearing the named SI or code, raise the named quantity to the threshold, set the named option), re-adjudicates, and asserts the rule reaches `FIRED`. Leaves it cannot construct (relational conditions, `unimplemented`, composites with more than one unsatisfied child) are reported as unverified with a count, so the verified fraction is visible and cannot quietly shrink. This is the strongest test the declarative architecture affords and it costs no new fixtures: it derives its inputs from the counterfactuals the existing corpus already produces, and it catches a condition written backwards — the same defect §15.4 targets — without authoring a fixture per rule.

Extend §18.15 with: "…and every counterfactual resolving to a single satisfiable `argSpec` leaf is verified by construction per §15.7, with the unverified remainder reported by count and reason."

### E7. §12.1 step 4 / §12.5 — the drift check cannot run where the spec puts it

Verified: the consumer has no `.gitmodules`, no git remote, no `engine` reference in `package.json` or any tsconfig, and its CI performs a single `actions/checkout@v4` of its own repo before `npm run verify`. `/engine` is a sibling directory on one workstation, absent on the runner. A check that "fails if it diverges from `/engine`" is unimplementable there; it can only detect hand-edits to the vendored tree, which is the opposite of §12.5's claim that it "makes an engine change visible in the consumer's suite."

Replace §12.1 step 4 (now step 5) and §12.5:

> 5. `sync-to-consumer.mjs` writes `src/engine/ENGINE_MANIFEST.json`: per-file SHA-256 over the vendored tree, plus `ENGINE_CONTRACT_VERSION`, `REGISTRY_VERSION`, `DATA_VERSION`, and the engine repo's git SHA, and marks every vendored file generated. It refuses to write unless the engine repo's §15.6 gate passed on the exact commit being vendored, and stamps that commit into the manifest.
>
> ### 12.5 Consumer-driven contract tests — who runs what
>
> **Consumer repo** (existing `verify` gate, windows-latest): (a) `test/engine-drift.test.ts` recomputes the manifest hashes over `src/engine/` and fails on mismatch — this catches a hand-edit or a partial sync, which is what step 5 exists to prevent, and it is the only check that CI can run, since that repo declares no dependency on the engine and checks out nothing else; it also asserts the manifest's contract version equals the constant its own adapter asserts on, so a stale vendored copy is a test failure rather than a runtime surprise. (b) `test/engine-contract.test.ts` asserts the §5.1 adapter maps `ServiceLine` (`procCode`, string `units`, `revenueCode`, float `charge`, per-line `fromDate`/`thruDate`, `typeOfBill`, and the §19.14 line identity) onto the engine input. (c) One Playwright case loading `test/fixtures/x12/837I-all-fields.dat` and asserting a determination reaches the renderer with `status`, `basis`, and `bundledUnder` intact — the §12.6 IPC/preload/serialization path, which §18.4's in-process `structuredClone` cannot cover. (d) The drift check also asserts `dist/src/engine/registry/*.json` is byte-identical to the vendored source, closing the copy step.
>
> **Engine repo**: owns the goldens, the lint, the coverage report, determinism, and freshness, and runs `sync-to-consumer.mjs --check` against a checkout of the consumer, failing if the sync produces a diff that has not landed downstream. Detecting "the engine moved ahead" is the engine's job because it is the only side that has both trees.

Amend §18.3's trailing clause: "…and its three existing `typecheck` targets (`tsconfig.json`, `tsconfig.renderer.json`, `tsconfig.e2e.json`) still exit 0 unchanged." New **3b:** "Re-running every generator in `/tools` leaves the working tree unchanged." **3c:** "The consumer's suite executes the vendored engine against its vendored structural goldens."

### E8. §18 / §10.1 / §10.2 / §3.5 — population counts out of assertions

§18 states "Each is stated as an assertion a test can pass or fail," and the assertions carry literals: §18.12's "All 526 SI K and all 41 SI R codes" and "All 85 codes with no Addendum B rate (`P` 4, `L` 48, `H` 19, `H1` 13, `F` 1)"; §18.13's "all 24 unusable-rate Q4 codes"; §18.13c's "partition all 18,986 codes." §10.2 hardcodes "**81 codes**," "4 codes," "**24 codes**"; §10.1 hardcodes "**702 of the 7,312**"; §3.5 prints a 28-value census. The numbers are right today. §7.4 states SIs are reassigned quarterly and CLFS republished quarterly, which changes essentially all of them — so scenario 1, a routine quarterly refresh, red-lines CI and forces a revision of this specification four times a year, forever.

Restate as invariants over loaded data:

> **18.12.** Every code whose SI is in {K, R} and which carries an Addendum B payment rate yields a non-null amount, with zero exceptions; every payable code carrying no Addendum B rate yields `PAID_UNPRICED` and appears in the §10.2 disclosure. Counts are reported, not asserted.
> **18.13c.** The six §8.1 patterns partition the loaded Addendum B with zero unmatched codes after sanitization.
> **18.32.** `gen-data.mjs` emits `/data/census.json` — SI histogram, rated/unrated counts, shape-pattern counts, unpriced populations, CF-derived count, and each source vintage. One test diffs it against a committed `census.baseline.json`. A quarterly refresh updates that one file and nothing else; the diff is the review artifact for the refresh.

Replace every hardcoded population in §10.1 and §10.2 with a reference to the generated census, and mark §3.5's counts "census as of the January 2026 / CLFS Q2V1 vintages; authoritative values live in `/data/census.json`."

### E9. §18.29 — a scale criterion that can fail

Replace: "**29.** Empty input and all-malformed input complete without an uncaught exception. A 250-code claim completes within a stated wall-clock budget on the reference machine at `validate: 'boundaries'`, its serialized `Result` at the default `traceLevel` is **under 4 MiB**, and `structuredClone` of it succeeds. The 4 MiB ceiling is derived, not invented: ~25 rules whose scope admits a given line × 250 lines = 6,250 `Evaluation`s at 373 B minified (the §5.2 record less its 117-byte counterfactual, per §5.3a) ≈ 2.33 MiB. Wall-clock, record count, and serialized size are recorded in the build log so a regression is visible rather than inferred."

### E10. §7.2 / §2.3 — provision the APC-keyed table now, empty

There is no APC-keyed rate table anywhere in the data layer, and three of the modelled gaps in §16 all need that same missing artifact: APC 8011's rate (§9.1 — "Addendum B carries 934 distinct APCs and **none** in the 8000-range"), Q3 composite APC rates (§9.2), and the J1 complexity-adjusted APC (§9.1). §19.12, §19.13, and §19.16 all ask the same question. Filling any one later means a new data artifact *and* a new resolver leg keyed on APC rather than code — changing §7.2 and the §2.3 signature, the one interface the spec declares cross-phase, after every phase-3 rule is written against it.

Add to §7.2: "**A second, APC-keyed table is provisioned now, empty.** `/data/apc.cy2026.ts` holds `{apc, rateMils, weight, apcType}` and ships with only the APCs derivable from Addendum B. It exists ahead of its data because three separate gaps are all APC-level lookups." Amend §2.3: "…taking a code, an *effective* SI, and an optional APC override, and returning `{schedule, rateMils, basis, rateSource: 'code' | 'apc'}`. When the override is supplied and `apc.cy2026` carries no rate, the resolver returns `rateMils: null` with the §9.1 flag — the same path a filled Addendum A will later satisfy, with no signature change."

---

# 2. Verdicts on the six contrarian challenges

| # | Challenge | Verdict |
|---|---|---|
| 1 | **Author in TypeScript, not JSDoc `.js`** | **CHANGE.** §18.1's no-build requirement is scoped to "the shipped browser artifact," and that artifact is already produced by a build step (`bundle.mjs`). `/tools` already carries `typescript`. The consumer already has `typescript ^5.7`, `esbuild`, `vite`, `vitest`, and an `include` covering `src`. Vendored `.ts` is typechecked by the consumer's existing first target and emitted by its existing `tsc` into `dist/src/engine/`, which the electron-builder allowlist already ships. That single change dissolves the sibling-`.d.ts` blocker (TS7016), the packaging-emit blocker, the `/data`-never-vendored blocker, and the JSDoc-has-no-`!` friction under `noUncheckedIndexedAccess`. Cost: `/engine` no longer runs unbuilt in a bare ESM host — which nothing in §13 or §15 requires, since vitest transpiles TS natively. |
| 2 | **Replace the ~40-operator DSL with typed predicate functions + declarative sidecar** | **STANDS.** The sidecar duplicates each predicate in two places — an executable function and a description of it — with nothing enforcing agreement. That is precisely the failure class §17 says this rewrite exists to eliminate ("v5's rules were control flow, so nothing could report what it did"), and it silently breaks §6.2 (applicability with *no claim*), §13.1 (tables generated from `argSpec`), §6.3 (structural diff), and §15.7. Under edit A1 the "JSON has no typechecking" objection largely evaporates: the rule shape is a generated TS type plus a shipped `verifyRegistry`. **Two refinements adopted from the challenge:** each band receives only its own epoch's frozen facts object, so the epoch-read discipline is enforced by construction (the §15.3 lint stays as a cheap belt); and the effect-conflict checks gain a runtime assertion in the effect applicator, not lint alone, since the registry is a caller-supplied input (D2). |
| 3 | **Replace vendoring with a committed npm tarball dependency** | **STANDS (vendoring), CHANGED (mechanism).** The tarball does solve packaging via `node_modules/**/*`, but it buys that with `skipLibCheck: true` hiding the engine's declarations from the consumer's strict typecheck, an install artifact in the release path, and no help at all for the `file://` browser path or `/data`. Under A1, vendored `.ts` gets packaging *and* real typechecking with zero new config, which is strictly better. Vendoring stands; §12.1's four steps are replaced (A1) and the drift check is relocated (E7). |
| 4 | **Make full-trace recording a mode with default `fired`** | **STANDS as a requirement, CHANGES in encoding.** §5.3's non-negotiable is a product decision, not a performance setting: §1 makes the auditable record the deliverable, and a default that omits `NOT_FIRED` means the artifact AB disputes from is by default not the auditable one. The measured problem is amplification, not the record — per-line counterfactual prose (117 of 490 B), per-line scope exclusions, and inlined fact `lineIds` (O(N²), 125 MiB pretty at 250 lines, past GitHub's per-file limit). §5.3a's `standard` default with `counterfactualRef` and `factRefs` brings a 250-line claim to ~2.33 MiB, and §12.6's split channel means the renderer never holds it. The challenge's real target — the *golden corpus* — is granted in full at E1. |
| 5 | **Make the 1→2 and 2→3 deep freezes conditional on an assert flag** | **STANDS as always-on, CHANGES in scope.** The challenge correctly identifies that the cost falls on the trace — but the right fix is A4, taking the trace out of the phase payload entirely, which is required for *correctness* anyway (as written, phases must append to a structure they are forbidden to mutate). Once the trace is out, deep-freezing determinations plus facts on a 250-line claim is small, and a dev/prod behavior difference in a determinism-critical engine is a worse trade than the cycles it saves. §18.7 is rescoped to the 3→4 barrier, which is the one boundary crossed by third-party-authored data and the one §11.1 depends on. |
| 6 | **Run the engine in the renderer, not the main process** | **STANDS.** The IPC cost is real and measured (10.03 MiB, 75 ms before pipe transfer, on every `claim:getDetail`), and the challenge is right that the engine's purity makes placement a free choice. But this app's product is rendering and exporting claim facsimiles, and PDF generation is main-side — `src/render` compiled to `dist/src/render` with node `fs` fonts placed there by `copy-fonts.mjs`. Any adjudicated figure that ever prints must be main-side, so moving the engine to the renderer buys one crossing and pays it back on the export path. §12.6 gets the split channel (C3) instead. |

Two further contrarian probes, resolved inside the plan rather than as separate verdicts: **phase-output validation** loses its always-on status and becomes an `assert`-mode gate with the "dependency-free" rationale corrected (A4) — its stated reason, `file://`, is false, since `bundle.mjs` inlines; and **the in-browser test runner** is deleted outright (E1), taking `gen-test-bundle.mjs`, `traces.generated.js`, and `run.html` with it.

---

# 3. Deliberately dropped, and why

- **`gen-registry.mjs` / `registry/*.js` twins** (three separate findings). Superseded by esbuild's JSON loader inlining the registry into `dist/engine.bundle.js` (B2). The premise that `.json` is unloadable in the packaged app is also false: `electron/main.ts` reads `dist/electron/build-info.json` with `fs` inside the asar today. A committed generated twin of the reviewable source of truth is a drift surface bought for a problem the bundler already owns.
- **Hoisting `registry/` to a top-level `/registry/` sibling.** Kept the substance (three artifacts, three versions, compatibility range, provenance — B5) and dropped the directory move: it adds a third vendoring target and buys nothing the version split does not already buy.
- **A committed npm tarball dependency.** Superseded by A1 (see verdict 3).
- **Storing `counterfactualSpec` and rendering prose on demand.** Superseded by `counterfactualRef` into `Result.counterfactuals` (A2), which removes the same amplification while keeping §18.15 checkable in-band. `Evaluation.predicate` already carries the machine-readable form for consumers that want it.
- **The `FIRED` + `NOT_APPLICABLE` coverage pair.** Structurally impossible after A2 removes `NOT_APPLICABLE` from the per-line vocabulary. Replaced with `FIRED` + scope-excluded-in-`Result.scopeExclusions` (E3), which is the same test.
- **`options.traceMode` with default `fired`.** Rejected — see verdict 4.
- **Conditional 1→2 / 2→3 freezes.** Rejected — see verdict 5.
- **`/test/traces.generated.js` gitignored with a corpus-hash header.** Moot: the artifact is deleted (E1), which is a strictly better answer to the same staleness problem.
- **Every finding about Medicare policy, data-file facts and counts, internal cross-reference numbering, DSL expressive sufficiency, and contract-term semantics.** Out of scope for this pass per the brief — including whether the operator set can express the required rules, which I did not re-litigate even where the DSL verdict touches it.
- **Two specific numbers I declined to invent.** The wall-clock budget in §18.29 and §15.6's Addendum B January→April SI-churn count are both specified as *measured before shipping and recorded*, not as figures I supplied. Every other number in this plan is either measured (trace sizes, vitest failure output, golden file sizes, structured-clone timings, ranking benchmarks) or arithmetic from the spec's own counts (the 4 MiB ceiling, the 1.3e19 unreduced numerator).