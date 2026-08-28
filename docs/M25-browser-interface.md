# M25 — Browser interface scope

Scope for the browser front-end (unit **U25**). **This is not a design.** It states what the engine produces, what the interface must do with it, and which problems are genuinely hard — so the design work is against real material rather than a guessed-at claims screen.

Spec references (§n) are to `ref/opps-adjudicator-scope.md` rev 14.

---

## 1. Audience and job

Bill processing staff at AB. Domain-fluent — they know what an APC and an SI are — and **not** developers. The interface must be operable by pasting codes and reading the result.

The job is **not** "show a claim." It is: *given these codes, how would Medicare OPPS bundle them, and why* — where **the "why" is the product**, not a debug panel. Anyone can assert an outcome; the reason it happened is what makes it defensible in a dispute.

**Print matters.** Output gets attached to disputes and pasted into email. A print stylesheet is a requirement, not a nicety: expand everything, hide controls, keep it legible on paper.

---

## 2. Hard constraints, non-negotiable

| Constraint | Consequence for design |
|---|---|
| **Runs from `file://`** | No server, no `fetch`, no XHR, no CDN. One classic-script bundle (`dist/engine.bundle.js`, one global `OppsEngine`). Everything ships in the file. |
| **No dollar amounts anywhere** | Milestone 1 is bundling only (§1.2). Rates exist inside the engine purely as ranking keys. **This removes the anchor most claim screens are built around** — the design cannot lean on a money column. |
| **Reference tables are generated** | §13.1: the SI table, bundling grid, and routing table are built at runtime from the registry via `argSpec()`. A hand-authored table that can disagree with the engine is worse than no table. Design them as *rendered data*, not static content. |
| **No PHI** | Codes, dates, units, charges, flags. No patient name, DOB, member id, MRN. §14 also forbids persisting provider identifiers. |
| **Nothing is editable** | The interface reads a determination. It never adjudicates, overrides, or lets a user "fix" a line. |

---

## 3. What the engine actually gives you

Measured on a real 10-line claim (`59025 84112 81001 36415 G0463 99284 0106T 00100 J1745 99205`):

| Surface | Volume | Notes |
|---|---|---|
| Determinations | 10 | one per input line, always |
| Trace rows | **55 total, 0–7 per line** | ordered rules considered, incl. non-firing |
| Scope exclusions | **30**, claim-level | rules that never applied to any line — recorded once, not per line |
| Facts | 169 | evidence the rules read; referenced by trace rows |
| Counterfactuals | 5 | one per rule, not per line |
| Flags | 3 | severities `assumption`, `info`, `warning` (also `gap`) |

**Volume is the central design fact.** 55 trace rows for 10 lines is legible. §18.29 requires the engine to survive **250 lines**, which is ~1,400 rows. The design must degrade gracefully across two orders of magnitude, and "show everything" stops working somewhere in between.

### Per determination

`lineId` · `code` · `resolvedSI` · `effectiveSI` · `status` · `disposition` · `bundledUnder` · `basis` · `flags[]` · `line{}` (the echoed input: modifiers, units, dates, revenue code, charge) · `trace[]`

### Per trace row

`ruleId` · `outcome` · `citation` · `epoch` · `order` · generated **why** text · generated **effect** text · `counterfactualRef` · `factRefs[]`

### Claim level

`applicability{}` · `scopeExclusions[]` · `counterfactuals{}` · `facts{}` · `disclosures[]` · `provenance{}` · `meta{}`

### Standalone query (no claim)

Applicability mode: given a **code alone**, every rule that can ever touch it, in three groups — `admitted`, `conditional` (depends on claim state, with the undecidable predicate named), `reserved` (no backing data). Plus the code's own facts.

---

## 4. The vocabularies the design must distinguish

**`status` — 12 values, and they mean materially different things.** Flattening them into "paid / not paid" loses the answer.

| Value | Means |
|---|---|
| `PAID` | pays separately under OPPS |
| `PACKAGED` | pays nothing separately, packaged into the claim, **no controlling line to name** |
| `BUNDLED` | pays nothing separately, bundled into **a specific named line** |
| `PAID_UNPRICED` | payable, but no rate is available from any loaded source |
| `ROUTED` | payable under a different fee schedule entirely |
| `NOT_PAID_RECODE` | not OPPS-recognized; an alternate facility code exists |
| `NOT_PAID_INPT_ONLY` | inpatient-only on an outpatient claim — a structural red flag |
| `NOT_PAID` · `MALFORMED` · `INVALID` · `INVALID_HISTORICAL` · `NO_PROCEDURE_CODE` | see §5.1, §8.1 |

`PACKAGED` vs `BUNDLED` is the pair most likely to be collapsed by a designer and **must not be** — one names a controlling line, the other cannot.

`INVALID_HISTORICAL` is not an error: the code was valid when billed and has since been retired (§7.5.1). It needs to read as *"fine, but check the DOS-era file"*, not as a coding mistake.

**`basis` — 12 values.** Where an amount ever appears (milestone 2), it is meaningless without the schedule that produced it: `OPPS_APC` and `CLFS` are different fee schedules.

**Flag severity — 4 values**, and the distinction carries weight:

- `assumption` — the engine assumed something and is telling you (e.g. the synthesized claim, MPPR ranking unverified)
- `info` · `warning` — ordinary notices
- `gap` — the engine could **not** evaluate something (NCCI, MUE, 8011's date relation)

A `gap` is not a failure and must not look like one. But it must not be dismissible into invisibility either — it is the honest statement of what was not checked.

---

## 5. The genuinely hard problems

These are the design questions. Everything above is material; this is the work.

### 5.1 The trace is the product, and it is large

55 rows at 10 lines, ~1,400 at 250. Every non-firing rule carries a counterfactual saying what would have made it fire — that is the auditability requirement (§5.3), not optional detail.

**Open:** what shows by default, what expands, and how a reader gets from "this line bundled" to "here is the rule and the evidence" without three clicks or a wall of text.

### 5.2 Bundling is a relationship, not a row attribute

`bundledUnder` points at another line. In the CLI this is `UNDER 1`, which makes the reader trace an id by eye. With 4 bundled lines pointing at 2 different controlling lines, a flat table stops communicating.

**Open:** how to show grouping — indentation, brackets, colour, a grouped layout — without implying the claim was submitted that way.

### 5.3 `NOT_OPPS` is a first-class answer with conflicting evidence

A claim can fail the applicability gate on several signals at once, and the engine deliberately **reports all of them rather than picking a winner** (§8.0.2). The real test fixture does exactly this: hospice-range bill type, inpatient room & board, CAH taxonomy — three signals, three different payment systems.

**Open:** how to present "this isn't an OPPS claim, here are three conflicting indicators, it probably needs a human" as a *useful answer* rather than an error page. It is arguably the most valuable single screen in the product, because it saves the most time.

### 5.4 The assumption banner

A pasted code list is not a claim. The engine synthesizes a 13X outpatient claim and a date of service, and **says so** (§10.4). If the user's real claim was inpatient, the bundling answer would differ.

**Open:** how to keep that visible without it becoming banner blindness. It cannot be a dismissible toast.

### 5.5 Two modes, one product

Claim adjudication (many codes → determinations) and code inspection (one code → every rule that can touch it) answer different questions and share vocabulary.

**Open:** one surface with a mode switch, two surfaces, or inspection reachable by clicking a code inside a result.

---

## 6. Surfaces required

1. **Input** — paste codes (`CODE[xUNITS][:MOD:MOD]`, space/comma/newline) or drop an XML claim. Options: date of service, and later the §13.2 assertion toggles.
2. **Result table** — one row per input line, always. No amount column.
3. **Per-line explanation** — why it got its status, what fired, what didn't and what would have changed it.
4. **Code inspector** — applicability mode, no claim required.
5. **Reference tables** — SI dispositions, bundling grid, cross-schedule routing. **Generated from the registry.**
6. **Print view** — expanded, controls hidden, legible on paper.
7. **Not-in-scope answer** — §5.3 above.

---

## 7. Out of scope for this design

No dollar amounts or totals (milestone 2). No contract terms (milestone 3). No NCCI/MUE results — those are reserved slots reporting "not checked". No editing, no submission, no appeal workflow. No login, no multi-user, no server.

The **divergence layer** (§20, "a commercial payer may bundle this differently") is milestone-1 scope but **not yet built**. Leave room for a per-line advisory annotation carrying a confidence and a direction — it must never look like an adjudicated outcome.

---

## 8. Real material to design against

Run these and design against the actual output, not a mock:

```
node tools/adjudicate.mjs 59025 84112 81001
node tools/adjudicate.mjs --why 59025 84112
node tools/adjudicate.mjs --json 59025 84112 81001 36415 G0463 99284 0106T 00100 J1745 99205
node tools/adjudicate.mjs --file test/fixtures/inst-xml-inpatient-cah-revonly.xml
```

The last one is the `NOT_OPPS` case with three conflicting signals. The third is the 10-line claim the volumes in §3 were measured from.

---

## 9. What I need back

A design is enough — no code. Most useful, in order:

1. **The default view of a result.** How much trace shows before anyone expands anything.
2. **How bundling relationships read** across 10+ lines with two controlling lines.
3. **The `NOT_OPPS` screen.**
4. **How a `gap` flag looks** next to a normal result — present, not alarming, not ignorable.

Then I build against it.
