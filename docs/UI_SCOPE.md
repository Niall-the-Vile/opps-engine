# UI scope — OPPS Adjudicator

Scope for the **entire** browser interface, written as the input to a design-system pass.

**This supersedes `M25-browser-interface.md`.** M25 was written before the UI existed and its measured volumes are now stale (it reported 169 facts; the current engine returns 6). Every number in §4 below was measured against the shipped engine on the date of writing.

**This is not a design.** It states what exists, what the engine produces, which distinctions must survive contact with a visual system, and which problems are genuinely unsolved. Visual language — type, colour, spacing, motion — is the design system's to decide. Information architecture, states, and vocabulary fidelity are not: getting those wrong produces a screen that is beautiful and wrong.

Spec references (§n) are to `ref/opps-adjudicator-scope.md` rev 15. Decision references (Dn) are to `BUILD_LOG.md`.

---

## 1. Audience and job

Bill-processing staff at Anabaptist Brotherhood. Domain-fluent — they know what an APC and a status indicator are — and **not developers**. Operable by pasting codes or dropping a claim file and reading the result.

The job is **not** "show a claim." It is: *given these codes, how would Medicare OPPS bundle them, and why* — where **the "why" is the product**. Anyone can assert an outcome; the reason is what makes it defensible in a dispute.

**Output leaves the screen.** Determinations get printed, attached to disputes, and pasted into email. Anything that reads as an answer will be quoted back by a hospital's billing office. That constrains the design more than any aesthetic consideration.

---

## 2. Hard constraints — non-negotiable

| Constraint | Consequence |
|---|---|
| **Runs from `file://`** | No server, no `fetch`/XHR, no CDN, no framework, no build step for `web/`. One classic script (`dist/engine.bundle.js`, global `OppsEngine`) plus `app.js`. Module scripts are blocked over `file://` in Chromium. Everything ships in the file. |
| **Shipped as ONE self-contained HTML** | `tools/package-release.mjs` inlines the engine, CSS, and logo as a data URI, then asserts the produced file references **nothing external**. A webfont, an icon CDN, or an image URL fails the release build. Icons must be inline SVG or glyphs. |
| **No dollar amounts anywhere** | Milestone 1 is bundling only (§1.2). Rates exist inside the engine purely as ranking keys. **This removes the anchor most claim screens are built around** — there can be no money column, no total, no variance. |
| **No PHI** | Codes, revenue codes, dates, units, charges, modifiers, bill type, condition/occurrence/value codes, billing taxonomy, payer identity. No patient name, DOB, sex, address, member id, MRN. §14 also forbids persisting provider identifiers. |
| **Reference content is generated** | §13.1: the SI table and bundling grid are built at runtime from the registry via `argSpec()`. A hand-authored table that can disagree with the engine is worse than no table. Design them as *rendered data*. |
| **Nothing is editable** | The interface reads a determination. It never adjudicates, overrides, or lets a user "fix" a line. |
| **Print is a requirement** | Not a nicety. See §9. |

---

## 3. Surfaces

Five built, two stubbed. All reachable from a persistent sidebar.

### 3.1 Input (built)
Paste codes — `CODE[xUNITS][:MOD:MOD]`, space/comma/newline separated — or drop a claim file. Both institutional shapes parse: **JSON (`837I`, the primary path)** and XML (legacy). Options: date of service; later the §13.2 assertion toggles.

### 3.2 Result (built)
One row per input line, always. Columns today: index, code, **SI**, bundling relationship, status, basis, flags, expander. No amount column, ever.

### 3.3 Per-line explanation (built, expander)
Why this line got its status: which rules fired, which did not, and what would have changed each. This is the product.

### 3.4 Code inspector (built)
Applicability mode: given a **code alone, no claim**, every rule that can ever touch it, in three groups — `admitted`, `conditional` (depends on claim state, with the undecidable predicate named), `reserved` (no backing data). Plus the code's own facts.

Note: this surface returned identical output for every code until D78 fixed it. It now differentiates correctly, and the two Q4 codes matching each other is the signal that it is real.

### 3.5 Reference tables (built)
SI dispositions, generated from the registry, **grouped by SI** with that SI's rules underneath (D82). Includes an explicit **"Any SI"** group for the 6 rules that apply to every line — these were silently dropped from this view until D83.

### 3.6 Rules (stubbed — "Soon")
Browsing the registry: the declarative rules with citations that the interpreter runs. Read-only. Needs design.

### 3.7 Organizations (stubbed — "Soon")
Per-organization rule sets that diverge from Medicare. **Deferred by decision (D76)** pending source material, because a divergence advisory built from invention rather than observed payer behaviour would render next to real determinations and read as adjudicated. Leave room; do not design content for it yet.

### 3.8 Settings (built)
Sidebar entry with a **debugging mode** toggle, persisted in `localStorage`. Currently gates the scope-exclusions block. Anything added to the audit layer should default to hidden here.

---

## 4. What the engine produces — measured

Measured against the shipped bundle at `traceLevel: 'full'`, which is what the UI requests (D55).

| Lines | Trace rows | Per line | Facts | Counterfactuals | Scope exclusions | Flags |
|---|---|---|---|---|---|---|
| 6 | 43 | 6–9 | 6 | 9 | 29 | 2 |
| 10 | 64 | 0–9 | 6 | 9 | 29 | 3 |
| 60 | 431 | 6–9 | 6 | 9 | 29 | 19 |
| 250 | **1,792** | 6–9 | 6 | 9 | 29 | 83 |

**Read the scaling carefully — it is the central design fact, and it is not uniform:**

- **Trace rows scale linearly**, ~7.2 per line. 250 lines is the §18.29 ceiling the engine must survive; that is **1,792 rows**. "Show everything" stops working somewhere between 10 and 60.
- **Scope exclusions are CONSTANT at 29** regardless of claim size — they are claim-level, considered once. This is a *fixed* cost, not a scaling problem. Design accordingly: it is 29 rows whether the claim has 2 lines or 250.
- **Counterfactuals are constant at 9** — one per rule, never per line.
- **Facts are constant at 6.** Do not build a facts browser; there is almost nothing there.
- **Flags scale with lines** (2 → 83) and are the thing most likely to overwhelm a long claim.

### Per determination
`lineId` · `line{}` (echoed raw input) · `code` · `revCode` · `chargeMils` · `resolvedSI` · `effectiveSI` · `status` · `disposition` · `bundledUnder` · `basis` · `flags[]` · `trace[]`

### Per trace row
`ruleId` · `ruleVersion` · `phase` · `band` · `order` · `epoch` · `citation` · `scopeTarget` · `examined{}` · `predicate{}` · `outcome` · `effect` · `supersededBy` · `counterfactual` · `counterfactualRef`

### Claim level
`claimId` · `applicability{}` · `determinations[]` · `facts{}` · `disclosures[]` · `scopeExclusions[]` · `counterfactuals{}` · `errors[]` · `engineStatus` · `provenance{}` · `meta{}` · `trace[]` (claim-scoped rules only)

---

## 5. The vocabularies — and the distinctions that must not collapse

### 5.1 `status` — 15 values

`PAID` · `PAID_EXEMPT` · `PAID_UNPRICED` · `PACKAGED` · `BUNDLED` · `ROUTED` · `NOT_PAID_RECODE` · `NOT_PAID_INPT_ONLY` · `NOT_PAID` · `MALFORMED` · `INVALID` · `INVALID_HISTORICAL` · `NO_PROCEDURE_CODE` · `DELETED` · `NOT_ADJUDICATED`

Flattening these into "paid / not paid" destroys the answer. Three pairs matter most:

- **`PACKAGED` vs `BUNDLED`** — both pay nothing separately. `BUNDLED` names **a specific controlling line**; `PACKAGED` has **no line to name**. A designer will want to merge these. Do not.
- **`INVALID_HISTORICAL` is not an error** — the code was valid when billed and has since been retired (§7.5.1). It must read as *"fine, check the DOS-era file"*, not as a coding mistake.
- **`NOT_PAID_RECODE`** means an alternate facility code exists — that is dispute leverage, not a dead end. The first real claim run through this tool produced exactly this on a `99211` billed under a clinic revenue code, where OPPS wants `G0463`.

### 5.2 `basis` — 13 values
`OPPS_APC` · `OPPS_DRUG_ASP` · `OPPS_BLOOD` · `OPPS_COMPREHENSIVE` · `CLFS` · `COST` · `PHP_PER_DIEM` · `ROUTED_MPFS` · `ROUTED_DMEPOS` · `ROUTED_AFS` · `ROUTED_UNKNOWN` · `CONTRACT` · `NONE`

Where an amount ever appears (milestone 2) it is meaningless without the schedule that produced it. `ROUTED_UNKNOWN` means *no loaded schedule matched at all* — an honest gap, not a placeholder (D69).

### 5.3 `disposition` — 4 values
`REJECTED` · `ROUTED` · `ADJUDICATED` · `ENGINE_ERROR`

`ENGINE_ERROR` is per-line and must not look like a claim-level failure: §12.8 guarantees every other line still completes, with `engineStatus: PARTIAL`.

### 5.4 `outcome` (trace rows) — 7 values
`FIRED` · `NOT_FIRED` · `NOT_EVALUATED` · `NOT_REACHED` · `SKIPPED` · `ERRORED` · `RETIRED`

`NOT_EVALUATED` means the rule exists but its data is not loaded — a **disclosed** gap, not a silent absence. `NOT_REACHED` is currently declared and never emitted (D71, open).

### 5.5 `flag.severity` — 4 values
- **`assumption`** — the engine assumed something and is telling you (synthesized claim; unverified MPPR ranking; a peeled modifier)
- **`info`** · **`warning`** — ordinary notices
- **`gap`** — the engine could **not** evaluate something (NCCI, MUE, 8011's date relation, condition codes absent from the feed)

A `gap` is not a failure and must not look like one. It must also not be dismissible into invisibility: it is the honest statement of what was not checked.

---

## 6. Status indicators — primary, but not a replacement

**SI is the vocabulary the reader reasons in**, and it must be primary throughout. It was absent from the UI entirely until D81.

**But SI cannot replace rule ids** (D82, measured):

- **13 SIs map to more than one rule.** `Q1` and `Q2` map to **four each** (`Qn.COMPANION`, `Q.SURVIVOR_TIEBREAK`, `DISP.Q1Q2.SURVIVOR`, `DISP.Q1Q2.COMPOSITE_FLAG`). `T` and `J2` map to two.
- **6 rules are SI-agnostic**, applying to every line regardless: `OPPS.PKG.J1.CONTROL`, `J1.COMPLEXITY_NOT_APPLIED`, `OPPS.CAPC8011.CONTROL`, `NCCI.PTP.PAIR`, `MUE.LIMIT`, `OPPS.CLASSIFY.DELETED`.

So an SI names a *set* of behaviours. Collapse to it and a Q1 line bundled by the survivor tiebreak becomes indistinguishable from one bundled as a companion — which is the answer. **SI primary, rule id as citation-sized provenance.** Never remove rule ids; they are how a determination is traced back.

**Two SIs per line.** `resolvedSI` (from Addendum B) and `effectiveSI` (post-conversion). They differ for Q4 lines that convert to A (§9.3), and that difference is **the moment the line left OPPS for another fee schedule** — currently shown as `Q4 → A`. Not cosmetic.

**SI is OPPS-only.** A routed line has no meaningful SI: CLFS carries its own `INDICATOR`, MPFS and DMEPOS their own. This is why `basis` is a separate column and cannot be folded into SI.

---

## 7. States every surface must handle

Not edge cases — all of these occur on real claims.

1. **Empty** — nothing entered yet.
2. **The assumption banner** — a pasted code list is not a claim. The engine synthesizes a 13X outpatient claim and a date of service, and **says so** (§10.4). If the real claim was inpatient the bundling answer would differ. It **cannot be a dismissible toast**, and it must not become banner blindness.
3. **`NOT_OPPS` with conflicting evidence** — the applicability gate returns `{inScope, gate, likelySystem, confidence, evidence[], detail}` and **deliberately reports every failing signal rather than picking a winner** (§8.0.2). The real fixture returns **3 evidence entries** naming three different payment systems (hospice bill type, inpatient room & board, CAH taxonomy) and **zero determinations**. Presenting "this isn't an OPPS claim, here are three conflicting indicators, it needs a human" as a *useful answer* rather than an error page is arguably the highest-value screen in the product, because it saves the most time.
4. **Partial** — `engineStatus: PARTIAL`, one line `ENGINE_ERROR`, every other line fine.
5. **Malformed / invalid lines** — mixed in with good ones, per §8.1.
6. **Feed-level disclosures** — e.g. condition codes absent from the payload (D85), which qualifies the §8.0 gate result itself. These are claim-level truths about *what could not be known*, distinct from per-line flags.
7. **Long claim** — 250 lines, 1,792 trace rows, 83 flags.

---

## 8. What real use taught

From the maintainer using it on live claims:

- **SI was missing entirely** and was the first thing asked for. Now present (D81).
- **Scope exclusions were a wall** — 29 rows of "rule X requires SI Y, not true here" in the main flow. Now behind debugging mode. The count still shows so their existence is not hidden, only their bulk.
- **Rule ids were the headline and SI was absent** — exactly inverted. Fixed (D82).
- **`bundled under line 6` makes you trace an id by eye.** Still open — see §9.
- **The reference tables silently omitted 6 rules**, including the two whose whole purpose is disclosing what was not checked (D83). Same class of bug as a lint gate that skipped what it could not decide (D80). **Watch for filters that discard what they cannot categorise.**

---

## 9. The genuinely open problems

These are the design questions. Everything above is material.

### 9.1 Bundling is a relationship, not a row attribute
`bundledUnder` points at another line. Today that renders as `bundled under line 6`, making the reader trace an id by eye. With 4 bundled lines pointing at 2 different controlling lines, a flat table stops communicating.

**Open:** how to show grouping — indentation, bracketing, a grouped layout — **without implying the claim was submitted that way.** The claim is flat; the bundling is the engine's finding.

### 9.2 The trace is the product and it is large
43 rows at 6 lines, 1,792 at 250. Every non-firing rule carries a counterfactual saying what would have made it fire — that is the §5.3 auditability requirement, not optional detail.

**Open:** what shows by default, what expands, and how a reader gets from "this line bundled" to "here is the rule and the evidence" without three clicks or a wall of text.

### 9.3 One long claim, one screen
At 250 lines the result table alone is a scrolling problem before any trace opens. Virtualisation is not available (no framework, no build step).

**Open:** does the design degrade by collapsing, paginating, grouping by status, or something else.

### 9.4 Two modes, one product
Claim adjudication (many codes → determinations) and code inspection (one code → every rule that can touch it) answer different questions and share vocabulary.

**Open:** mode switch, separate surfaces, or inspection reachable by clicking a code inside a result. Currently separate sidebar entries.

### 9.5 `lineId` is currently not safe to display
D86, **open**: `lineId` is the feed's `remote_chgid`, which in the live feed is `pcn + "-" + index` — and the PCN is PHI. It appears as the visible line identifier on every row today. Assume `lineId` becomes a positional `idx:N` and design the row identity around **the index and the code**, not a feed identifier.

---

## 10. Print

Output gets attached to disputes. A print stylesheet is a requirement.

- Expand every per-line explanation; hide all controls and navigation.
- **Respect the debugging-mode toggle** — nobody wants 29 not-applicable rules on a printed exhibit.
- The **build stamp** must appear: version, commit, date, engine version, and the OPPS data vintage. A determination that cannot be tied to the build that produced it is not defensible. It is currently in the sidebar and in a comment at the top of the raw file.
- Legible in black and white: **status must not be conveyed by colour alone.**

---

## 11. Theme, responsive, accessibility

- Light and dark both, respecting the viewer's preference.
- The status/severity palette must survive greyscale (print) and be distinguishable without colour — 15 statuses and 4 severities is more than colour alone can carry.
- Wide content (the result table, trace rows, reference tables) scrolls inside its own container; the page body must never scroll horizontally.
- Keyboard-operable: paste, adjudicate, expand, toggle settings.

---

## 12. Out of scope

No dollar amounts or totals (milestone 2). No contract terms (milestone 3). No NCCI/MUE results — those are reserved slots reporting "not checked". No editing, no submission, no appeal workflow. No login, no multi-user, no server, no telemetry, no AI integration.

---

## 13. What I need back

A design is enough — no code. Most useful, in order:

1. **The default view of a result** — how much trace shows before anyone expands anything, at 6 lines and at 60.
2. **How bundling relationships read** across 10+ lines with two controlling lines (§9.1).
3. **The `NOT_OPPS` screen** — three conflicting signals, zero determinations, as a useful answer (§7.3).
4. **How a `gap` flag looks** next to a normal result — present, not alarming, not ignorable.
5. **The status palette in greyscale**, since it has to print.

Then I build against it.

---

## 14. Real material to design against

Run these; design against actual output, not a mock.

```
node tools/adjudicate.mjs 36415 76815 J1756 G0463 59025 96374
node tools/adjudicate.mjs --why 59025 84112
node tools/adjudicate.mjs --json 59025 84112 81001 36415 G0463 99284 0106T 00100 J1745 99205
node tools/adjudicate.mjs --file test/fixtures/inst-xml-inpatient-cah-revonly.xml
```

The first is a real claim's code set. The third is the 10-line claim §4's volumes come from. The last is the `NOT_OPPS` case with three conflicting signals.

To see the current UI: `npm run build:bundle`, then open `web/index.html`.
