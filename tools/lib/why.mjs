// tools/lib/why.mjs — U19d/U25 shared "why" text generation.
//
// Extracted from tools/adjudicate.mjs's --why implementation (U19c/U19d) so
// the browser front-end (web/js/app.js, via the bundled
// `window.OppsEngine.why`) can render the *identical, generated* reader
// explanation the CLI already prints, instead of re-deriving its own copy
// or — worse — shipping hand-authored prose (spec decision D47: the
// reader-facing explanation is generated from each rule's condition and
// effects, never hand-written per code).
//
// PURE MODULE. No imports, no console output, no CLI-specific formatting
// (word-wrap, column padding, truncation-for-terminal-width all stay in
// tools/adjudicate.mjs, which is presentation for an 80-column terminal —
// not something a browser page should inherit). `operators` — the one
// external dependency every function here needs for describe()/argSpec()
// fallbacks — is injected via `createWhyText(operators)` rather than
// imported directly, so this file has zero import-resolution assumptions
// about its caller's module system or bundler (mirrors dsl/operators.ts's
// own "declared locally, injected, not imported" discipline — see that
// file's header). tools/adjudicate.mjs calls `createWhyText(operators)`
// once, after its own dynamic `dsl/operators.ts` import resolves, exactly
// as it already loaded that module before this extraction; the esbuild
// browser bundle (tools/bundleEntry.mjs) does the same with the bundled
// `operators` module.
//
// Every function below is a straight, behavior-preserving move out of
// tools/adjudicate.mjs — see that file's own header comments (still there)
// for the design rationale of each. This file changes none of it.

export function createWhyText(operators) {
  function joinOr(items) {
    if (items.length === 0) return '(nothing)';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} or ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
  }

  function joinAnd(items) {
    if (items.length === 0) return '(nothing)';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  }

  /** describe() straight from the operator that owns `node.op` — never hand-written prose (§4.4), so a fallback string here is always grounded in the registry's own condition, not invented. */
  function describeOp(node) {
    const op = operators[node.op];
    if (op === undefined) return `(unknown operator "${node.op}")`;
    try {
      return op.describe(node.args);
    } catch (err) {
      return `(could not describe "${node.op}": ${err instanceof Error ? err.message : String(err)})`;
    }
  }

  /**
   * An `isHighestBy`/`ordinalAtLeast`-family "among" predicate almost always
   * wraps a plain SI/code selector together with a `not(statusIn(BUNDLED))`
   * guard that exists purely so an already-bundled line can't rank as its own
   * bundling target (§4.3) — implementation mechanics, not a reason a reader
   * needs. Strips exactly that guard pattern and nothing else; anything not
   * recognized is left as `describeOp` would render it, in full, rather than
   * silently dropped.
   */
  function isBundledGuard(node) {
    return (
      node.op === 'not' &&
      node.args !== null &&
      typeof node.args === 'object' &&
      node.args.child !== undefined &&
      node.args.child.op === 'statusIn' &&
      Array.isArray(node.args.child.args?.status) &&
      node.args.child.args.status.includes('BUNDLED')
    );
  }

  function rankGroupPhrase(among) {
    if (among.op === 'allOf' && Array.isArray(among.args?.children)) {
      const kept = among.args.children.filter((c) => !isBundledGuard(c));
      if (kept.length === 0) return 'this claim';
      return kept.map((c) => (c.op === 'siIn' ? joinOr(c.args.si) : describeOp(c))).join(' and ');
    }
    return among.op === 'siIn' ? joinOr(among.args.si) : describeOp(among);
  }

  /**
   * The short, reader-facing version of one leaf condition that evaluated
   * false — every phrase here is a direct restatement of that leaf's own
   * `op`/`args` (the same data `describe()` reads), just without the
   * templated "the claim also contains a line with..." scaffolding §4.4's
   * generated prose carries. An operator this table does not special-case
   * falls back to `describeOp` verbatim — still true, just not shortened.
   */
  function shortLeaf(node) {
    const a = node.args ?? {};
    switch (node.op) {
      case 'claimContainsAny':
        return a.si !== undefined ? `no ${joinOr(a.si)} line on this claim` : a.code !== undefined ? `no ${joinOr(a.code)} on this claim` : describeOp(node);
      case 'claimContainsNone':
        return a.si !== undefined
          ? `this claim already has a ${joinOr(a.si)} line`
          : a.code !== undefined
            ? `this claim already has a ${joinOr(a.code)} line`
            : describeOp(node);
      case 'claimContainsCode':
        return `no ${a.code} on this claim`;
      case 'claimUnitsAtLeast':
        return `${a.code !== undefined ? a.code : joinOr(a.si ?? [])} units under ${a.units}`;
      case 'claimLineCountAtLeast':
        return `fewer than ${a.count} ${a.code !== undefined ? `lines coded ${a.code}` : a.si !== undefined ? `${joinOr(a.si)} lines` : 'lines'} on this claim`;
      case 'siIn':
        return `status indicator isn't ${joinOr(a.si)}`;
      case 'siIs':
        return `status indicator isn't ${a.si}`;
      case 'codeIn':
        return `code isn't ${joinOr(a.code)}`;
      case 'codePattern':
        return `code doesn't match "${a.pattern}"`;
      case 'apcIn':
        return `APC isn't ${joinOr(a.apc)}`;
      case 'inSchedule':
        return `not on the ${joinOr(a.schedule)} fee schedule`;
      case 'statusIn':
        return `line status isn't ${joinOr(a.status)}`;
      case 'isExempt':
        return `line isn't on the exempt set`;
      case 'hasModifier':
        return `missing modifier ${a.modifier}`;
      case 'unitsAtLeast':
        return `line has fewer than ${a.units} units`;
      case 'hasRate':
        return `line carries no rate`;
      case 'hasWeight':
        return `line carries no weight`;
      case 'optionIs':
        return `option "${a.option}" isn't ${JSON.stringify(a.equals)}`;
      case 'optionAtLeast':
        return `option "${a.option}" is under ${a.atLeast}`;
      case 'optionUnknown':
        return `option "${a.option}" was supplied`;
      case 'dosOnOrAfter':
        return `date of service is before ${a.date}`;
      case 'dosBefore':
        return `date of service is on or after ${a.date}`;
      case 'isHighestBy':
        return `not the top-ranked line by ${a.field} among ${rankGroupPhrase(a.among)}`;
      case 'isNotHighestBy':
        return `is the top-ranked line by ${a.field} among ${rankGroupPhrase(a.among)}`;
      case 'ordinalIs':
        return `rank by ${a.field} among ${rankGroupPhrase(a.among)} isn't ${a.equals}`;
      case 'ordinalAtLeast':
        return `rank by ${a.field} among ${rankGroupPhrase(a.among)} is under ${a.atLeast}`;
      case 'not': {
        // A `not(inner)` requirement evaluating false means `inner` is true —
        // the blocking fact is `inner` itself, stated plainly (no double
        // negative), still sourced from that inner node's own describe().
        const inner = a.child;
        if (inner === undefined) return describeOp(node);
        if (inner.op === 'statusIn') return `line status is already ${joinOr(inner.args.status)}`;
        if (inner.op === 'isExempt') return `line is on the exempt set`;
        return describeOp(inner);
      }
      default:
        return describeOp(node);
    }
  }

  /**
   * The short reason a NOT_FIRED rule's `when` did not hold. For a top-level
   * `allOf`/`anyOf`, uses `examined.detail.childResults` — the same
   * per-child true/false array `dsl/operators.ts`'s own `allOf`/`anyOf`
   * `evaluate()` already records — to name only the conjuncts that actually
   * failed, rather than restating every condition the rule checks regardless
   * of which one blocked it. No re-evaluation against the claim happens
   * here; this reads data the engine already produced.
   */
  function shortReason(predicate, detail) {
    if ((predicate.op === 'allOf' || predicate.op === 'anyOf') && Array.isArray(detail?.childResults) && Array.isArray(predicate.args?.children)) {
      const children = predicate.args.children;
      const blocking = detail.childResults.map((fired, i) => (fired === false ? children[i] : null)).filter((c) => c !== null && c !== undefined);
      if (blocking.length > 0) return blocking.map(shortLeaf).join('; ');
    }
    return shortLeaf(predicate);
  }

  function shortReasonForEvaluation(ev) {
    if (ev.outcome === 'NOT_FIRED') return shortReason(ev.predicate, ev.examined.detail);
    if (ev.outcome === 'SKIPPED') return ev.counterfactual ?? '(skipped)';
    if (ev.outcome === 'ERRORED') return '(this rule faulted during evaluation -- see FLAGS above)';
    return '(no reason on record)';
  }

  function underLinePhrase(d, result, displayIndexByLineId) {
    if (d.bundledUnder === null) return '';
    return ` under ${lineRefText(d.bundledUnder, result, displayIndexByLineId)}`;
  }

  /** `line N (CODE)` for a lineId — the one concrete-line naming format used throughout WHY output (line headers, bundle targets, fired-condition clauses). `?` only when the lineId names no determination on record (should not happen; defensive, not invented). */
  function lineRefText(lineId, result, displayIndexByLineId) {
    const idx = displayIndexByLineId.get(lineId) ?? lineId;
    const det = result.determinations.find((x) => x.lineId === lineId);
    const code = det !== undefined ? det.code || '(no code)' : '?';
    return `line ${idx} (${code})`;
  }

  /** `{epoch -> {factId -> Fact}}`, built once per call — the same resolution `src/inspect.ts#explain()` does for its `factsRead`, reimplemented locally. */
  function buildFactsIndex(facts) {
    const out = new Map();
    for (const epoch of Object.keys(facts ?? {})) {
      out.set(epoch, new Map((facts[epoch] ?? []).map((f) => [f.factId, f])));
    }
    return out;
  }

  /**
   * `ev.examined.factRefs` resolved to the actual `Fact` objects, silently
   * dropping any ref with no matching entry rather than throwing (unlike
   * `inspect.ts#explain()`'s hard-error policy for the same lookup): a rank
   * operator's (`ordinalAtLeast`/`isHighestBy`/`isNotHighestBy`/`ordinalIs`)
   * factRefs were found, during U19c's work, to name a fact
   * (`<epoch>:rank:<field>#<n>`) that `Result.facts` never actually carries —
   * an engine/trace gap out of this presentation-only module's scope.
   * Concretizing those operators instead reads `examined.ordinal`, which IS
   * populated correctly, so this function's empty-array result for them is
   * expected, not a symptom to chase.
   */
  function resolveFactsRead(ev, factsIndex) {
    const byId = factsIndex.get(ev.epoch);
    if (byId === undefined) return [];
    const out = [];
    for (const ref of ev.examined?.factRefs ?? []) {
      const f = byId.get(ref);
      if (f !== undefined) out.push(f);
    }
    return out;
  }

  /** Registry field names as a reader would say them, not as the DSL spells them — a mechanical vocabulary substitution (never a new fact). */
  function humanizeField(field) {
    switch (field) {
      case 'rateMils':
        return 'payment rate';
      case 'weight':
        return 'relative weight';
      case 'chargeMils':
        return 'charge amount';
      case 'unitCount':
        return 'unit count';
      default:
        return field;
    }
  }

  function ordinalSuffix(n) {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return 'th';
    switch (n % 10) {
      case 1:
        return 'st';
      case 2:
        return 'nd';
      case 3:
        return 'rd';
      default:
        return 'th';
    }
  }

  /** A rank-family leaf (`ordinalAtLeast`/`isHighestBy`/`isNotHighestBy`/`ordinalIs`) FIRED: `examined.ordinal` names the subject's actual rank (not available via `factRefs`), `argSpec`'s own `field`/`among` name what it was ranked by and against. */
  function firedRank(node) {
    return (ev) => {
      const a = node.args ?? {};
      const ordinal = ev.examined?.ordinal;
      if (typeof ordinal !== 'number') return describeOp(node);
      const field = typeof a.field === 'string' ? a.field : undefined;
      const humanField = field !== undefined ? humanizeField(field) : '(unnamed field)';
      const groupPhrase = a.among !== undefined ? rankGroupPhrase(a.among) : '(unnamed group)';
      const rankPhrase = `this line ranks ${ordinal}${ordinalSuffix(ordinal)} by ${humanField} among ${groupPhrase} lines`;
      if (node.op === 'isNotHighestBy') return `${rankPhrase}, not the top by ${humanField}`;
      if (node.op === 'isHighestBy') return `${rankPhrase}, the top by ${humanField}`;
      return rankPhrase;
    };
  }

  /** `claimContainsAny`/`claimContainsCode` FIRED: names which of the leaf's own si/code values were actually found, and every concrete line a matching census fact names, via `Fact.lineIds`. */
  function firedClaimPresence(node, factsRead, result, displayIndexByLineId) {
    const a = node.args ?? {};
    const dim = a.si !== undefined ? 'si' : a.code !== undefined ? 'code' : null;
    const candidates = dim === 'si' ? a.si : dim === 'code' ? (Array.isArray(a.code) ? a.code : [a.code]) : [];
    if (dim === null) return describeOp(node);
    const matchingFacts = factsRead.filter(
      (f) => f.dimension === dim && (f.kind === 'siCensus' || f.kind === 'codeCensus') && f.values.some((v) => candidates.includes(v)),
    );
    if (matchingFacts.length === 0) return describeOp(node);
    const matchedValues = [...new Set(matchingFacts.flatMap((f) => f.values.filter((v) => candidates.includes(v))))];
    const lineIds = [...new Set(matchingFacts.flatMap((f) => f.lineIds))];
    const lineRefs = lineIds.map((id) => lineRefText(id, result, displayIndexByLineId));
    const noun = dim === 'si' ? 'status indicator' : 'code';
    return `the claim contains a line with ${noun} ${joinOr(matchedValues)} -- ${joinAnd(lineRefs)}`;
  }

  /** `claimUnitsAtLeast` FIRED: the actual summed unit count on record, not just the threshold the rule checks. */
  function firedUnitsAtLeast(node, factsRead) {
    const a = node.args ?? {};
    const fact = factsRead.find((f) => f.kind === 'unitTotal');
    const label = a.code !== undefined ? a.code : joinOr(a.si ?? []);
    if (fact !== undefined && typeof fact.values[0] === 'number') {
      return `${label} totals ${fact.values[0]} units on this claim (at least ${a.units} required)`;
    }
    return describeOp(node);
  }

  /** One leaf of a FIRED `when` tree, in the positive ("this held") register — the mirror image of `shortLeaf`'s NOT_FIRED register, sourced the same way. An operator this table does not special-case falls back to `describeOp` verbatim, exactly like `shortLeaf`. */
  function firedLeaf(node, ev, factsRead, result, displayIndexByLineId) {
    switch (node.op) {
      case 'claimContainsAny':
      case 'claimContainsCode':
        return firedClaimPresence(node, factsRead, result, displayIndexByLineId);
      case 'claimContainsNone': {
        const a = node.args ?? {};
        const candidates = a.si ?? a.code ?? [];
        return `no ${joinOr(candidates)} line on this claim`;
      }
      case 'claimUnitsAtLeast':
        return firedUnitsAtLeast(node, factsRead);
      case 'ordinalAtLeast':
      case 'isHighestBy':
      case 'isNotHighestBy':
      case 'ordinalIs':
        return firedRank(node)(ev);
      default:
        return describeOp(node);
    }
  }

  /** Walks a FIRED `when` tree: `allOf` names every conjunct (all were true), `anyOf` names only the disjunct(s) `examined.detail.childResults` records as true — never restates a child that did not actually contribute. */
  function firedNode(node, ev, factsRead, result, displayIndexByLineId) {
    if (node.op === 'allOf' && Array.isArray(node.args?.children)) {
      const parts = node.args.children.map((c) => firedNode(c, ev, factsRead, result, displayIndexByLineId));
      return joinAnd(parts);
    }
    if (node.op === 'anyOf' && Array.isArray(node.args?.children)) {
      const children = node.args.children;
      const detail = ev.examined?.detail;
      const trueIdx = Array.isArray(detail?.childResults) ? detail.childResults.map((f, i) => (f === true ? i : null)).filter((i) => i !== null) : null;
      const chosen = trueIdx !== null && trueIdx.length > 0 ? trueIdx.map((i) => children[i]) : children;
      const parts = chosen.map((c) => firedNode(c, ev, factsRead, result, displayIndexByLineId));
      return joinOr(parts);
    }
    return firedLeaf(node, ev, factsRead, result, displayIndexByLineId);
  }

  /** Strips exactly the same "not already BUNDLED" scope guard `rankGroupPhrase` already strips — implementation mechanics, not something a reader needs told back to them as "and the line is not already bundled." */
  function stripBundledGuard(scope) {
    if (scope.op === 'allOf' && Array.isArray(scope.args?.children)) {
      const kept = scope.args.children.filter((c) => !isBundledGuard(c));
      if (kept.length === 0) return { op: 'always', args: {} };
      if (kept.length === 1) return kept[0];
      return { op: 'allOf', args: { children: kept } };
    }
    return scope;
  }

  /** A rule with an empty `when` fires on `scope` alone — there is no condition to attribute the firing to, only a population it applies to (never "Fired because ." with a dangling clause). */
  function describeApplyScope(scope) {
    const stripped = stripBundledGuard(scope);
    if (stripped.op === 'siIn') return `every SI ${joinOr(stripped.args.si)} line`;
    if (stripped.op === 'always') return 'every line in scope';
    return `every line where ${describeOp(stripped)}`;
  }

  /** Appends a full stop, unless the text already ends in terminal punctuation — never a double ".." */
  function terminate(text) {
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }

  /** The WHY condition sentence for one FIRED rule: "Fired because ..." from `when` (concretized via `firedNode`), or "Applies to ..." from `scope` when the rule has no `when` at all. `rule` is the registry rule (needs `.when`/`.scope`); `ev` is the (already-resolved) evaluation for this rule on this line. */
  function describeFiredWhen(rule, ev, result, factsIndex, displayIndexByLineId) {
    if (rule.when === undefined) {
      return terminate(`Applies to ${describeApplyScope(rule.scope)}`);
    }
    const factsRead = resolveFactsRead(ev, factsIndex);
    return terminate(`Fired because ${firedNode(rule.when, ev, factsRead, result, displayIndexByLineId)}`);
  }

  /** One `then[]` effect actually applied (from the trace's own recorded `effect`, not the static rule definition — "what happened", not "what the rule says"), described via that effect operator's own semantics, with `bundleUnder` concretized to the line `d.bundledUnder` actually names and `setStatus`/`setBasis`/`convertSI` read directly off their own args. */
  function describeEffectApp(eff, d, result, displayIndexByLineId, verbose) {
    const a = eff.args !== null && typeof eff.args === 'object' && !Array.isArray(eff.args) ? eff.args : {};
    switch (eff.op) {
      case 'setStatus':
        return `status set to ${a.status}`;
      case 'setBasis':
        return `basis set to ${a.value}`;
      case 'convertSI':
        return `status indicator converted to ${a.to}`;
      case 'route':
        return 'routed to the fee schedule resolved by the routing step';
      case 'exempt':
        return 'marked exempt from packaging';
      case 'stop':
        return 'halts further rule evaluation for this line';
      case 'flag': {
        // Not `operators['flag'].describe()` verbatim: that function's own
        // "raises a ${severity} flag" is grammatically wrong for a vowel-led
        // severity ("a assumption flag"). `a.severity`/`a.code`/`a.message`
        // are the same effect args describe() itself reads; only the
        // article is fixed up.
        const article = /^[aeiou]/i.test(String(a.severity)) ? 'an' : 'a';
        const head = `raises ${article} ${a.severity} flag (${a.code})`;
        return verbose ? `${head}: ${a.message}` : head;
      }
      case 'bundleUnder': {
        const humanField = typeof a.highestBy === 'string' ? humanizeField(a.highestBy) : '(unnamed field)';
        const groupPhrase = a.among !== undefined ? rankGroupPhrase(a.among) : '(unnamed group)';
        const base = `bundled under the line with the highest ${humanField} among ${groupPhrase}`;
        return d.bundledUnder !== null ? `${base} -- ${lineRefText(d.bundledUnder, result, displayIndexByLineId)}` : base;
      }
      default: {
        const op = operators[eff.op];
        return op !== undefined ? op.describe(a) : `(unknown effect "${eff.op}")`;
      }
    }
  }

  /** The WHY effect sentence: every effect the trace recorded as actually applied, joined into one line. `null` when a FIRED evaluation somehow recorded no effect (defensive, not printed as an empty "Effect:"). */
  function describeEffects(d, ev, result, displayIndexByLineId, verbose) {
    const effects = ev.effect ?? [];
    if (effects.length === 0) return null;
    return `Effect: ${terminate(effects.map((eff) => describeEffectApp(eff, d, result, displayIndexByLineId, verbose)).join('; '))}`;
  }

  return {
    joinOr,
    joinAnd,
    describeOp,
    rankGroupPhrase,
    shortLeaf,
    shortReason,
    shortReasonForEvaluation,
    underLinePhrase,
    lineRefText,
    buildFactsIndex,
    resolveFactsRead,
    humanizeField,
    describeApplyScope,
    describeFiredWhen,
    describeEffectApp,
    describeEffects,
    terminate,
  };
}
