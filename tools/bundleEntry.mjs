// tools/bundleEntry.mjs — U24 synthetic entry point for the esbuild browser
// bundle (`dist/engine.bundle.js`, built by `tools/bundle.mjs`).
//
// Lives in `tools/`, not `src/` — the build brief for U24/U25 is explicit
// ("Do not modify `src/` or the registry"), and this file changes nothing
// about the engine itself; every export below is a read-only re-export of
// something `src/` already computes. `.mjs`, not `.ts`: this repo's
// `tsconfig.json` typechecks everything under `tools/`, and a `.ts` file
// here would need to statically import `./lib/why.mjs` (plain JS, no
// declarations) — which needs `allowJs`, a tsconfig change this build
// brief does not ask for and that would loosen typechecking repo-wide.
// Staying `.mjs` keeps this file (like the pre-existing `tools/*.mjs`
// build scripts) outside `tsc`'s `include` entirely; esbuild's own
// resolver does not care about the importer's extension, and bundles it
// exactly the same way it bundled the earlier `.ts` version.
//
// Union of what `window.OppsEngine` must expose (spec §2.7,
// docs/M25-browser-interface.md's U24 note: "at least adjudicate,
// inspect/applicability, codeFacts, ENGINE_CONTRACT_VERSION,
// DATA_VERSION") plus what the U25 browser front-end additionally needs to
// function at all, all under this one global (esbuild's `--global-name`
// assigns exactly one):
//
//   - `adjudicate`, `explain`, `applicability`, `codeFacts`,
//     `ENGINE_CONTRACT_VERSION` — src/index.ts's own public surface.
//     `explain`/`applicability` stand in for "inspect": src/inspect.ts has
//     no single `inspect()` function (see that file's header), so both
//     query modes ship under their own names rather than one invented.
//   - `DATA_VERSION` — lives on src/data/index.ts, not re-exported by
//     src/index.ts, so imported directly from there.
//   - `operators` (dsl/operators.ts) and `registry` (this package's own
//     bundled registry, loaded exactly as src/index.ts's private
//     `BUNDLED_REGISTRY` is — reconstructed here the same way
//     tools/adjudicate.mjs already does, since it is not exported) — the
//     browser needs both to call `applicability(code, rules)` at all (it
//     takes a caller-supplied rule array — spec §6.2), and to build the
//     §13.1 registry-generated reference tables via each operator's own
//     `argSpec()`.
//   - `why` — the same generated-explanation module tools/adjudicate.mjs
//     uses for `--why` (tools/lib/why.mjs, factored out precisely so the
//     browser's per-line explanation is the identical generated text, not
//     a second hand-authored copy — spec decision D47).
export { adjudicate, explain, applicability, codeFacts, ENGINE_CONTRACT_VERSION } from '../src/index.js';
export { DATA_VERSION } from '../src/data/index.js';
export { operators } from '../src/dsl/operators.js';
// The real adapters (spec §5.1/§10.4/§13.1) — U25 build brief item 5: "the
// upload path must use the real XML adapter, not the design's regex
// sniffing," and the paste path gets the same treatment for the same
// reason (claim synthesis + the §10.4 assumption flag belongs to the
// engine's own adapter, not a second, divergent copy in web/js/app.js).
export { parseCodeList, CODE_LIST_SYNTAX } from '../src/adapters/codeList.js';
export { parseInstitutionalXml } from '../src/adapters/instXml.js';
// U2b — the current institutional adapter (JSON has superseded XML on the
// live feed). Exposed the same way as its legacy XML sibling above, so the
// browser front-end can accept a dropped/pasted institutional JSON claim,
// not only an XML one.
export { parseInstitutionalJson } from '../src/adapters/instJson.js';

import { operators } from '../src/dsl/operators.js';
import { loadRegistry } from '../src/registry/loader.js';
import { EXEMPT_RULES, PACKAGING_RULES, DISPOSITION_RULES } from '../src/registry/index.js';
import { createWhyText } from './lib/why.mjs';

export const registry = loadRegistry([...EXEMPT_RULES, ...PACKAGING_RULES, ...DISPOSITION_RULES]);
export const why = createWhyText(operators);
