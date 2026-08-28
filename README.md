# OPPS Engine

Offline OPPS bundling and adjudication engine for Anabaptist Brotherhood, Plan ID 4350.

**Spec:** `docs/ref/opps-adjudicator-scope.md` (rev 12). That document is normative; this README only orients.
**Architecture edit plan:** `docs/ref/opps-architecture-edit-plan.md` — Tiers C/D still unapplied.

## What it answers

> Given this set of codes, how would Medicare OPPS bundle them, and why?

Per line: pays or bundles, which line it bundles under, and the full ordered list of rules considered — including the ones that did **not** fire, each with a counterfactual saying what would have made it fire. Plus advisory notes on where a commercial payer is likely to bundle differently (spec §20).

**Milestone 1 reports no dollar amounts.** Rates load as internal ranking keys only, because the controlling J1 and the surviving Q-group line are payment-ranked (Ch. 4 §10.4.1). Pricing is milestone 2 (spec §21.2).

## Relationship to `837-claim-viewer`

Separate program, adjacent. Coupled by the **claim JSON format**, not by shared source. The engine never parses X12 itself; an adapter feeds it.

⚠️ **Known input-path gap.** `jsonClaimSource.ts` cannot currently produce a UB-04 claim — `mapFormType` returns `'unsupported'` for anything but `'1500'`, and it builds no `institutional` block. Only the X12 837I path yields `formType: 'ub04'` with `typeOfBill`. See `docs/BUILD_PLAN.md` §1.1.

## Layout

```
src/
  dsl/         closed operator set, interpreter, validation, freeze
  phases/      classify · adjudicate · benchmark · contract · divergence
  registry/    declarative rules as JSON — the reviewable source of truth
  data/        generated CY2026 tables (do not hand-edit)
  routing.ts   shared fee-schedule resolver (leaf; imports data only)
  trace.ts     append-only journal + canonical serializer
  inspect.ts   explain · applicability · registry diff
  errors.ts    EngineError + flag manifest
  index.ts     public API + ENGINE_CONTRACT_VERSION
tools/         build-time only — never shipped
test/          fixtures + golden projections + rule-coverage matrix
web/           minimal browser front-end (file://, classic script)
```

## Running the interface

Two ways in, for two different people.

**Staff who just need to use it** open the single-file build attached to the
latest release on the repo's Releases page. One `.html` file, ~1.5 MB. Download
it, double-click it, done — no install, no extracting, no network. The build it
came from, the commit, and every schedule vintage it was built against are
printed in the sidebar and in a comment at the top of the file, so any
determination can be traced back to the build that produced it.

**Working on the engine** run it out of the tree. `dist/` is generated and not
committed, so build it once after cloning:

```
npm ci
npm run build:bundle
```

Then open `web/index.html` directly in a browser. No server, no network — the
engine, the CY2026 data and the registry are all inside the bundle.

## Cutting a release

Push a version tag. That is the whole procedure:

```
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` then runs the full `verify` gate against the
tagged commit, builds the bundle, packages the single file, and publishes it as
a GitHub release.

**The tag is the only place a version number is written down.** `package.json`'s
`version` field is deliberately not the source of truth — it would have to be
bumped in a commit *before* the tag, which is the step people forget, and the
artifact would then carry the previous release's number while claiming to be the
new one. A tag cannot disagree with itself.

To rehearse the whole path without publishing anything, run the workflow
manually from the Actions tab: it builds and uploads the artifact to the run
page and skips the release step.

To build one locally:

```
npm run build:bundle
npm run package:release
```

That writes `dist/opps-adjudicator-local.html`, stamped `local` and flagged
`+local-changes` if the working tree is dirty — a local build is never mistaken
for a released one.

## Commands

```bash
npm run verify
```

`typecheck` → `lint:registry` → `test`. The registry lint is a build gate, not a nicety: it is what keeps the counterfactuals honest.

## Rules of the codebase

1. **`src/` has zero DOM, network, filesystem, or clock access.** Dates are passed in. Asserted by source scan.
2. **Rules are data.** Logic lives in the interpreter; policy lives in `registry/*.json` with a citation. If you find yourself writing `if (si === 'Q4')` outside the interpreter, stop.
3. **Money is integer mils** (1/1000 dollar). 648 CY2026 rates carry three decimals; cents cannot hold them. No floats in predicates, ever.
4. **Every operator ships `describe()` and `argSpec()`.** Retrofitting them is how the generated tables and counterfactuals drift out of sync with the logic.
5. **Never a non-null assertion (`!`) on a data access.** That is precisely how a bad row becomes a wrong benchmark silently.
6. **The strict flags in `tsconfig.json` mirror `837-claim-viewer` exactly** so vendored code can never be rejected there later. Do not relax them.
