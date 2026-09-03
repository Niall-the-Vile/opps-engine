# NCCI integration — scope and data plan

How the NCCI program fits the milestones, what data is actually required, and how to store it so the engine can use it.

Page citations below are to `2026_ncci_medicare_policy_manual_all-chapters.pdf` (revision 1/1/2026, 287 pages) using its own internal page numbers (`I-14`, `I-28`, …), not PDF page numbers.

---

## 1. The correction this document exists to make

**The Policy Manual is prose, not data. It contains no edit pairs and no MUE values.**

It is 13 chapters explaining *why* edits exist and *how* they are adjudicated. The engine's two reserved slots — `NCCI.PTP.PAIR` and `MUE.LIMIT`, which currently report `NOT_EVALUATED` (U17, D40) — need **tables**, and those are separate quarterly downloads from the CMS NCCI pages.

Having the manual does not unlock NCCI in the engine. It does two other things, both valuable:

1. It supplies the **decision semantics** the rules must encode — what a modifier indicator means, what an MAI means, what a zero MUE means. Without these the tables are uninterpretable.
2. It supplies **dispute leverage** (§7), which for AB may be the higher-value half.

---

## 2. What the engine has today

`NCCI.PTP.PAIR` and `MUE.LIMIT` are declared reserved slots with `dataRequired`, so every determination already discloses that PTP and MUE were **not checked** rather than silently omitting them (D40, §9.5). That was deliberate: the answer must never look complete when a major edit class was never considered.

Both are SI-agnostic — they apply to every line regardless of status indicator (D82) — so they show in the "Any SI" reference group (D83).

**Nothing about the engine's structure needs to change to accept this data.** The slots exist and are wired.

---

## 3. The data files — now on disk, verified

Located under the repo's parent folder (not `zips/` — these are separate CMS downloads): `ccioph-v323r0-f1..f4.zip` (PTP, facility Outpatient Hospital — "oph" in the filename) and `facilityoutpatienthospitalservicesmuetable-effective-10-01-2026.zip` (MUE). The sibling `ccipra-*`/`practitionerservicesmuetable-*` files are the **Practitioner** variant and are not what AB needs; `dmesupplierservicesmuetable-*` is DME, also not this. Extracted to a scratch location outside the repo for inspection — nothing raw belongs in the repo, only generated, census-checked output does (same discipline as Addendum B).

**PTP — `ccioph-v323r0-f1..f4.txt`, version 32.3:**

| Column | Content |
|---|---|
| 1 | Column 1 (controlling) code |
| 2 | Column 2 (bundled) code |
| 3 | `*` = in existence prior to 1996 |
| 4 | Effective date |
| 5 | Deletion date, or `*` if still active |
| 6 | CCMI — confirmed exactly `{0, 1, 9}` in the real data, matching the manual |
| 7 | PTP edit rationale (free text) |

**Measured:** 4 files, **~1.87M edit rows total**, **12,668 distinct codes** touched (Column 1 ∪ Column 2). CCMI distribution: `1` (bypassable) 1,773,211 · `0` (not bypassable) 65,663 · `9` (tombstone) 30,000 — confirms the manual's claim that `9` is rare and reserved for same-day effective/deletion pairs, not a live third policy. Deletion dates run from `20161231` through active (`*`); **343,893 of the sampled rows are still active**, so this is very much a live table, not mostly historical.

**MUE — `MCR_MUE_OutpatientHospitalServices_Eff_10-01-2026.csv`:**

| Column | Content |
|---|---|
| 1 | HCPCS/CPT code |
| 2 | Outpatient Hospital Services MUE value |
| 3 | MAI, **with the label text embedded** — e.g. `"3 Date of Service Edit: Clinical"`, not a bare `3` |
| 4 | MUE rationale category (e.g. `Nature of Analyte`, `Code Descriptor / CPT Instruction`) |

**Measured:** 15,171 codes. MAI distribution: `3` (per-DOS, clinical, bypassable) 8,972 · `2` (per-DOS, absolute) 6,147 · `1` (per-line) 42. **1,392 codes carry MUE `0`** — confirms §4.4's "not payable," a real and sizeable category, not an edge case.

**Vintage note — this is NEWER than everything else loaded.** File name says "effective 10-01-2026" and PTP is versioned 32.3 with rows effective through `20261001`. Every other schedule currently loaded (`DATA_VERSION`) is **January 2026**: `opps-cy2026-jan-*`, `clfs-cy2026-q2v1`, `mpfs-cy2026-jan-*`, `dmepos-cy2026-jan`. So generating from these files puts NCCI a full quarter ahead of OPPS/CLFS/MPFS. Not a defect — CMS updates these on independent schedules — but it needs a flag on the generated `DATA_VERSION` entries so a reader isn't misled into assuming a single as-of date for the whole engine. **Recorded as D93.**

---

## 4. What the manual does give — the mechanizable semantics

These are the facts that make the tables interpretable. Sourced, quoted where exact.

### 4.1 CCMI — Correct Coding Modifier Indicator (I-14)

| CCMI | Meaning |
|---|---|
| `0` | NCCI PTP-associated modifiers **cannot** be used to bypass the edit |
| `1` | They **may** be used, under appropriate clinical circumstances |
| `9` | Use "is not specified" — assigned to pairs whose **deletion date equals the effective date**, purely to keep the field non-blank |

**`9` is not a third policy — it is a tombstone.** A rule treating it as "maybe" would be wrong.

### 4.2 The NCCI PTP-associated modifier set (I-14, exact)

- **Anatomic:** `E1`–`E4`, `FA`, `F1`–`F9`, `TA`, `T1`–`T9`, `LT`, `RT`, `LC`, `LD`, `RC`, `LM`, `RI`
- **Global surgery:** `24`, `25`, `57`, `58`, `78`, `79`
- **Other:** `27`, `59`, `91`, `XE`, `XS`, `XP`, `XU`

**Explicitly NOT PTP-associated: `22`, `76`, `77`.** Their presence does **not** bypass an edit (I-14). This is exactly the kind of near-miss a hand-written rule gets wrong.

Note the collision with **D68**: the current feed sends only `mod1`/`mod2`, and a line can legitimately carry several of these. A truncated modifier set will produce wrong PTP answers, not merely incomplete ones.

### 4.3 MAI — MUE Adjudication Indicator (I-28, I-29)

| MAI | Kind | Adjudication | Overridable? |
|---|---|---|---|
| `1` | **Claim line** edit | UOS on *each line* compared to the MUE value; excess denies **that line** | Same code may appear on separate lines using `59`/`XE`/`XP`/`XS`/`XU`/`76`/`77`/`91`/anatomic, each adjudicated separately |
| `2` | **Date-of-service**, absolute — "per day edits based on policy" | UOS **summed across all lines** for that code and DOS; excess denies **all UOS for that code that day** | **No** — override during processing, reopening or redetermination "would be contrary to CMS policy" |
| `3` | **Date-of-service**, "per day edits based on clinical benchmarks" | Same summing | **Yes** — contractor may bypass on medical-record evidence |

The MAI 1 / 2 / 3 split is the single most important thing in this manual for the engine, because it changes both the *computation* (per line vs summed per day) and the *dispute posture* (2 is effectively final; 3 is appealable on records).

### 4.4 An MUE of `0` does not mean "no limit" (I-31)

It means the code is invalid, not covered, bundled, not separately payable, or statutorily excluded — determined from the MPFS database, **OPPS Addendum B**, the Alpha-Numeric HCPCS file, the DMEPOS jurisdiction list, or the IOM. The engine already loads Addendum B, so a zero MUE is often corroborable against data on disk.

### 4.5 Some MUE values are confidential (I-34)

> "some MUE values are not published and are confidential."

**The MUE table is incomplete by design.** A missing code is not "no edit" — it may be an unpublished one. This must be disclosed as a `gap`, never treated as a pass. It is precisely the D40 failure shape.

### 4.6 Date spans divide units (I-34)

Where a claim line carries a date span with multiple UOS, contractors "divide the UOS reported on the claim line by the number of days in the date span and round to the nearest whole number," then compare to the MUE.

**This speaks directly to §19.2 (unit semantics), an open question currently blocking milestone 2.** It does not settle §19.2 — it is MUE-specific — but it is the first sourced statement the project has on how units and date spans interact.

### 4.7 Bilateral surgery indicator (I-30)

Some MUE values derive from the MPFSDB bilateral surgery indicator (`0`/`1`/`2`/`3`), which governs whether modifier `50`, or `RT`+`LT` on separate lines, is the correct reporting. The engine already loads MPFS data.

---

## 5. Milestone placement

**A PTP edit is a bundling determination.** Column 2 is bundled into Column 1 — that is the same question milestone 1 exists to answer, phrased differently. It belongs in milestone 1's remit, not deferred to pricing.

**An MUE is a units determination**, and units bear on payment. It sits between milestones, and §19.2 must be settled first.

| Unit | Scope | Depends on | Milestone |
|---|---|---|---|
| **U27** | PTP semantics into the registry: CCMI 0/1/9, the associated-modifier set, `9`-as-tombstone. Rules authored, `dataRequired` unsatisfied, still reporting `NOT_EVALUATED`. | — | 1 |
| **U28** | `gen-ncci-ptp.mjs` + generated table; `NCCI.PTP.PAIR` goes live | U27 + the facility PTP file | 1 |
| **U29** | MUE semantics: MAI 1/2/3, zero-MUE meaning, unpublished-value gap disclosure | §19.2 settled | 2 |
| **U30** | `gen-ncci-mue.mjs` + generated table; `MUE.LIMIT` goes live | U29 + the facility MUE file | 2 |
| **U31** | Add-on code edits — a new reserved slot, Type 1 / Type 2 | AOC file | 2 |

**U27 is buildable today with no new data**, and is worth doing first: it turns the manual's semantics into declarative rules with citations, so that when the table arrives the work is a data drop rather than a design exercise. It is the same shape as D40's principle — declare the rule, disclose the gap.

---

## 6. Format — how to store it for use

Two different kinds of content, two different homes. **Do not attempt to parse 287 pages of prose.**

### 6.1 The tables → generated modules

Same pattern as the CY2026 OPPS data: `tools/gen-ncci-ptp.mjs` reads the CMS file and emits `src/data/ncciPtp.<vintage>.ts`, committed, with a census self-check that refuses to write on unexpected drift, and a `DATA_VERSION` entry naming the quarter. PTP pairs are large; store as a sorted flat array with a keyed lookup built at load, not a nested object literal.

### 6.2 The semantics → one small hand-authored file

`src/data/ncciPolicy.ts` (or JSON in `src/registry/`), hand-authored, **page-cited**, containing only the decision-bearing facts of §4 above: the CCMI vocabulary, the associated-modifier set, the MAI vocabulary, the zero-MUE meaning. This is on the order of 60 lines, not 287 pages.

Every rule that consumes it carries a `citation` naming the manual and section — which the U18 lint already requires, and which is what makes a determination defensible when a hospital's billing office pushes back.

### 6.3 The manual itself → a citation target, not an input

Keep the PDF outside the repo, referenced by revision date. It is the authority a citation points at, not a file the build reads.

---

## 7. The dispute leverage — possibly the highest-value part

For an organization doing reference-based-pricing advocacy, one passage matters more than the whole edit apparatus (I-32):

> "denials resulting from MUEs are not based on any of the statutory provisions that give liability protection to beneficiaries under section 1879 of the Act. Thus, ABN issuance based on an MUE is NOT appropriate. A provider/supplier may not issue an ABN in connection with services denied due to an MUE **and cannot bill the beneficiary for UOS denied based on an MUE**."

**A provider cannot balance-bill a member for units denied under an MUE, and cannot use an ABN to shift that liability.** That is a direct, citable answer to a category of balance bill.

Related, same page: an MAI `3` denial *is* reviewable on medical records; an MAI `2` denial is not. So the MAI value tells you whether a dispute is worth pursuing on records or should be argued on coding.

This is milestone-3 / advocacy material rather than engine logic, but it should be captured now while the source is open — and it argues for surfacing MAI on any future MUE result rather than just a pass/fail.

---

## 8. Copyright caution

The manual states (Intro-1) that CPT codes, descriptions and other data are **© 2025 American Medical Association**, with FARS/DFARS restrictions.

Policy semantics, edit indicators, and citations are fine to encode. **Bulk-extracting CPT descriptors into the repo is a licensing question, not a technical one.** The engine currently stores codes and status indicators, not descriptors, which keeps it clear of this — worth keeping that way deliberately rather than by accident.

---

## 9. Open questions

1. **Which PTP and MUE file variants can you obtain?** The facility ones are what AB needs; the Practitioner files are the ones most easily found and would be wrong here.
2. **§19.2 unit semantics** — still open, and now with a sourced MUE-specific data point (§4.6) that may help settle it.
3. **The `mod1`/`mod2` ceiling (D68).** PTP bypass depends on the full modifier set. If the feed truly caps at two, PTP answers will be wrong for lines carrying more, and that needs disclosing as a systematic limitation rather than discovered per claim.
4. **Do add-on code edits belong in milestone 1?** An AOC billed without its primary is arguably a bundling question too.

---

## 10. What was actually read

**~20 of 287 pages:** the complete table of contents (pp. 1–7), Intro-1, Chapter I §E "Modifiers and Modifier Indicators" (I-14 – I-17), and Chapter I §V "Medically Unlikely Edits" plus §W "Add-on Code Edits" (I-28 – I-35).

**Not yet read:** Chapters II–XIII, which are body-system-specific policy (each has its own MUE section and General Policy Statements). Those matter for *interpreting individual edits* and for dispute narrative, and are worth mining per-dispute rather than wholesale. Chapter XII (HCPCS Level II) and Chapter XIII (Category III) are the most likely to matter for OPPS facility claims.

Everything in §4 is quoted or closely paraphrased from pages actually read. Nothing here is recalled from memory.
