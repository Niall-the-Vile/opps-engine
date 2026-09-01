// web/js/app.js — U25. Vanilla DOM front-end for the OPPS Adjudicator,
// implementing docs/ref/M25-design-reference.dc.html against the real
// engine (window.OppsEngine, dist/engine.bundle.js — see index.html).
//
// No framework, no build step, no network. A classic script (not
// type="module": ES module loading over file:// is blocked by same-origin
// rules in Chromium-based browsers — see docs/M25-browser-interface.md §2).
//
// Every determination shown here comes from a real `OppsEngine.adjudicate()`
// call. Every "why" sentence comes from `OppsEngine.why` (tools/lib/why.mjs,
// bundled in) — the same generated-text logic `tools/adjudicate.mjs --why`
// uses, per spec decision D47 ("the reader-facing explanation is generated
// from each rule's condition and effects, not hand-written per code").
// Nothing in this file hand-authors a determination or a why-string.

(function () {
  'use strict';

  var Engine = window.OppsEngine;
  var viewEl = document.getElementById('view');

  if (!Engine || typeof Engine.adjudicate !== 'function') {
    viewEl.innerHTML =
      '<div class="prose-page"><h1>Engine did not load</h1>' +
      '<p><code>window.OppsEngine</code> is missing or incomplete. Build the browser bundle first: ' +
      '<code>npm run build:bundle</code> (produces <code>dist/engine.bundle.js</code>), then reopen this page.</p></div>';
    return;
  }

  // -------------------------------------------------------------------------
  // Palette-derived metadata. STATUS_META/OUTCOME_META/FLAG_META below are
  // authored against docs/ref/M25-design-reference.dc.html's own
  // STATUS_META/OUTCOME_META/FLAG_META block, colours taken verbatim where
  // the design already covered a value. Two closed unions the design left
  // incomplete are filled in here (build brief item 4 — Status; extended the
  // same way to Outcome, whose union the design also under-covered, so a
  // NOT_EVALUATED/ERRORED/RETIRED trace row never falls through to a raw,
  // unstyled identifier either):
  //
  //   Status  (15 values) — design covered 11; added MALFORMED, INVALID,
  //     DELETED, NOT_ADJUDICATED.
  //   Outcome (7 values)  — design covered 4 (FIRED, NOT_FIRED, NOT_REACHED,
  //     SKIPPED); added NOT_EVALUATED, ERRORED, RETIRED.
  //   FlagSeverity (4 values) — design already covered all 4
  //     (assumption/info/warning/gap) completely; nothing added.
  // -------------------------------------------------------------------------

  var STATUS_META = {
    PAID: { label: 'Paid', bg: 'var(--green-100)', fg: 'var(--green-800)' },
    PAID_EXEMPT: { label: 'Paid, exempt', bg: 'var(--green-100)', fg: 'var(--green-800)' },
    PAID_UNPRICED: { label: 'Paid, unpriced', bg: 'var(--gold-100)', fg: 'var(--gold)' },
    PACKAGED: { label: 'Packaged', bg: 'var(--paper-3)', fg: 'var(--ink-2)' },
    BUNDLED: { label: 'Bundled', bg: 'var(--paper-3)', fg: 'var(--ink-2)' },
    ROUTED: { label: 'Routed', bg: 'var(--green-50)', fg: 'var(--green-700)' },
    NOT_PAID_RECODE: { label: 'Not paid — recode', bg: 'var(--clay-100)', fg: 'var(--clay)' },
    NOT_PAID_INPT_ONLY: { label: 'Not paid — inpt only', bg: 'var(--clay-100)', fg: 'var(--clay-strong)' },
    NOT_PAID: { label: 'Not paid', bg: 'var(--clay-100)', fg: 'var(--clay)' },
    MALFORMED: { label: 'Malformed code', bg: 'var(--clay-100)', fg: 'var(--clay)' },
    INVALID: { label: 'Invalid code', bg: 'var(--clay-100)', fg: 'var(--clay)' },
    INVALID_HISTORICAL: { label: 'Invalid — historical', bg: 'var(--gold-100)', fg: 'var(--gold)' },
    NO_PROCEDURE_CODE: { label: 'No procedure code', bg: 'var(--paper-3)', fg: 'var(--ink-2)' },
    DELETED: { label: 'Deleted code', bg: 'var(--gold-100)', fg: 'var(--gold)' },
    NOT_ADJUDICATED: { label: 'Not adjudicated', bg: 'var(--clay-100)', fg: 'var(--clay-strong)' },
  };

  var OUTCOME_META = {
    FIRED: { bg: 'var(--green-100)', fg: 'var(--green-800)' },
    NOT_FIRED: { bg: 'var(--paper-3)', fg: 'var(--ink-3)' },
    NOT_REACHED: { bg: 'var(--paper-3)', fg: 'var(--ink-4)' },
    SKIPPED: { bg: 'var(--paper-3)', fg: 'var(--ink-4)' },
    NOT_EVALUATED: { bg: 'var(--paper-2)', fg: 'var(--ink-2)' },
    ERRORED: { bg: 'var(--clay-100)', fg: 'var(--clay)' },
    RETIRED: { bg: 'var(--paper-3)', fg: 'var(--ink-3)' },
  };

  var FLAG_META = {
    assumption: { bg: 'var(--gold-100)', fg: 'var(--gold)', border: 'var(--gold)' },
    info: { bg: 'var(--green-50)', fg: 'var(--green-700)', border: 'var(--green-200)' },
    warning: { bg: 'var(--gold-100)', fg: 'var(--gold)', border: 'var(--gold)' },
    gap: { bg: 'var(--paper-2)', fg: 'var(--ink-2)', border: 'var(--line-2)' },
  };

  var ACCENT = {
    PAID: 'var(--green-600)',
    PAID_EXEMPT: 'var(--green-600)',
    PAID_UNPRICED: 'var(--gold)',
    PACKAGED: 'var(--line-2)',
    BUNDLED: 'var(--line-2)',
    ROUTED: 'var(--green-500)',
    NOT_PAID_RECODE: 'var(--clay)',
    NOT_PAID_INPT_ONLY: 'var(--clay-strong)',
    NOT_PAID: 'var(--clay)',
    MALFORMED: 'var(--clay)',
    INVALID: 'var(--clay)',
    INVALID_HISTORICAL: 'var(--gold)',
    NO_PROCEDURE_CODE: 'var(--line-2)',
    DELETED: 'var(--gold)',
    NOT_ADJUDICATED: 'var(--clay-strong)',
    __default__: 'var(--line-2)',
  };

  function humanizeIdentifier(s) {
    return String(s)
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
  }

  /** Every Status must render (build brief item 4) — an unmapped value never falls through to a raw identifier; it gets a generated label and the neutral palette instead. */
  function statusMeta(status) {
    return STATUS_META[status] || { label: humanizeIdentifier(status), bg: 'var(--paper-3)', fg: 'var(--ink-2)' };
  }

  function outcomeMeta(outcome) {
    return OUTCOME_META[outcome] || { bg: 'var(--paper-3)', fg: 'var(--ink-2)' };
  }

  function flagMeta(severity) {
    return FLAG_META[severity] || FLAG_META.info;
  }

  function accentFor(status) {
    return ACCENT[status] || ACCENT.__default__;
  }

  // -------------------------------------------------------------------------
  // Sample material — embedded verbatim (see the file's own header comment
  // at each point below) rather than re-typed, so a sample can never quietly
  // drift from the real fixture it names.
  // -------------------------------------------------------------------------

  // The real 10-line claim measured in docs/M25-browser-interface.md §3.
  var SAMPLE_CODES_TEN_LINE = '59025 84112 81001 36415 G0463 99284 0106T 00100 J1745 99205';

  // test/fixtures/outpatient-13x-hcpcs.xml, verbatim.
  var SAMPLE_XML_4LINE_OUTPATIENT =
    '<!--\n' +
    '  Fixture: synthetic outpatient claim, bill type 13X, with real HCPCS codes\n' +
    '  on the lines. Invented for U2 test coverage only — no institutional feed\n' +
    '  producing an outpatient HCPCS claim was available in this folder (see\n' +
    '  docs/M1.1-input-contract.md, "Test expectations"). No patient data is\n' +
    '  invented: PHI fields (pat_*, ins_*, mrn, pcn, bill_npi, bill_taxid,\n' +
    '  prov_*, remote_fileid, remote_batchid) are omitted entirely rather than\n' +
    '  filled with fake values.\n' +
    '-->\n' +
    '<claims>\n' +
    '  <claim claim_form="ub92"\n' +
    '         payerid="61101" payer_name="HUMANA" payer_order="Primary"\n' +
    '         hosp_from_date="2026-03-10" hosp_thru_date="2026-03-10"\n' +
    '         accept_assign="Y" total_charge="612.40" balance_due="612.40"\n' +
    '         diag_1="Z0000"\n' +
    '         bill_taxonomy="282N00000X"\n' +
    '         type_of_bill="131" admit_type="3" admit_source="1"\n' +
    '         cond_code_1="M2">\n' +
    '    <charge remote_chgid="88001" charge="145.00" units="1" rev_code="0510" charge_record_type="UN" proc_code="G0463"/>\n' +
    '    <charge remote_chgid="88002" charge="22.40"  units="1" rev_code="0300" charge_record_type="UN" proc_code="36415"/>\n' +
    '    <charge remote_chgid="88003" charge="310.00" units="1" rev_code="0301" charge_record_type="UN" proc_code="84112"/>\n' +
    '    <charge remote_chgid="88004" charge="135.00" units="1" rev_code="0450" charge_record_type="UN" proc_code="59025"/>\n' +
    '  </claim>\n' +
    '</claims>\n';

  // test/fixtures/inst-xml-inpatient-cah-revonly.xml, verbatim.
  var SAMPLE_XML_CAH_INPATIENT =
    '<!--\n' +
    '  Fixture: real-shaped institutional XML from the clearinghouse feed.\n' +
    '  PHI removed at the adapter boundary per spec §2.1 — patient, insured, MRN,\n' +
    '  PCN, and provider identifiers are stripped or neutralized. Everything the\n' +
    '  §8.0 gate and §9 adjudication consume is preserved verbatim.\n' +
    '\n' +
    '  Expected outcome: NOT_OPPS. This fixture exists to prove the gate, and it\n' +
    '  trips four of its six conditions independently:\n' +
    '\n' +
    '    1. claim_form="ub92"        -> not a recognized outpatient form (§19.22)\n' +
    '    2. type_of_bill="81A"       -> facility type 8, not 13X (§8.0)\n' +
    '    3. rev_code with no proc_code on all 16 lines -> no HCPCS, no SI (§8.0.1)\n' +
    '    4. rev 0110 room & board + value_code 80 = 6 covered days -> inpatient\n' +
    '    5. bill_taxonomy 282NC0060X -> Critical Access Hospital, cost-based (§3.3)\n' +
    '    6. hosp_from_date 2020-08-25 vs CY2026 data -> vintage mismatch (§7.5)\n' +
    '\n' +
    '  Also exercises: line id comes from remote_chgid -- present and unique on all\n' +
    '  16 lines here, so lineIdScheme is \'feed\', NOT the idx: fallback. (An earlier\n' +
    '  version of this comment said otherwise; it was describing the viewer parser\'s\n' +
    '  bug of reading `chgid`, not this adapter\'s output. Fixed per D11.)\n' +
    '  charge_record_type carries the unit qualifier DA vs UN (§19.2); there are no\n' +
    '  per-line dates, so the claim-level date fallback applies.\n' +
    '\n' +
    '  total_charge reconciles exactly to the sum of the 16 charge lines (9202.07),\n' +
    '  which the adapter asserts as a cheap input check.\n' +
    '-->\n' +
    '<claims>\n' +
    '  <claim claim_form="ub92"\n' +
    '         payerid="61101" payer_name="HUMANA" payer_order="Primary"\n' +
    '         hosp_from_date="2020-08-25"\n' +
    '         accept_assign="Y" total_charge="9202.07" balance_due="9202.07"\n' +
    '         diag_1="I10" diag_2="F418" admit_diag="I10"\n' +
    '         bill_taxonomy="282NC0060X"\n' +
    '         type_of_bill="81A" admit_type="2" admit_source="1"\n' +
    '         disch_hour="15" disch_status="03"\n' +
    '         cond_code_1="38"\n' +
    '         occ_code_1="29" occ_date_1_date="2020-08-25"\n' +
    '         occ_code_2="35" occ_date_2_date="2020-08-25"\n' +
    '         value_code_1="80" value_amt_1="6.00">\n' +
    '    <charge remote_chgid="129543" charge="2700.00" units="6"   rev_code="0110" charge_record_type="DA"/>\n' +
    '    <charge remote_chgid="129536" charge="1273.58" units="746" rev_code="0250" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129539" charge="59.50"   units="7"   rev_code="0258" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129538" charge="63.14"   units="12"  rev_code="0270" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129540" charge="5.00"    units="1"   rev_code="0270" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129541" charge="5.00"    units="2"   rev_code="0270" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129537" charge="504.25"  units="11"  rev_code="0300" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129551" charge="645.00"  units="3"   rev_code="0301" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129550" charge="387.00"  units="3"   rev_code="0305" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129552" charge="60.00"   units="1"   rev_code="0309" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129545" charge="375.00"  units="2"   rev_code="0324" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129546" charge="1987.60" units="1"   rev_code="0350" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129547" charge="160.00"  units="2"   rev_code="0412" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129549" charge="567.00"  units="9"   rev_code="0420" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129548" charge="175.00"  units="1"   rev_code="0424" charge_record_type="UN"/>\n' +
    '    <charge remote_chgid="129544" charge="235.00"  units="1"   rev_code="0730" charge_record_type="UN"/>\n' +
    '  </claim>\n' +
    '</claims>\n';

  // -------------------------------------------------------------------------
  // Registry index, built once from the bundled registry (window.OppsEngine.
  // registry — see tools/bundleEntry.mjs). Mirrors tools/adjudicate.mjs's own
  // RULES_BY_ID exactly (same data, same construction).
  // -------------------------------------------------------------------------

  var RULES_BY_ID = new Map();
  Engine.registry.forEach(function (r) {
    RULES_BY_ID.set(r.id, r);
  });

  // -------------------------------------------------------------------------
  // State.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Debugging-mode preference. A UI toggle only — no PHI, no provider
  // identifier, no claim data (§14 forbids persisting those; a boolean
  // display preference is fine). Wrapped in try/catch throughout: localStorage
  // can throw under file:// in some browser/profile configurations, and the
  // UI must render correctly either way (falls back to "off").
  // -------------------------------------------------------------------------

  var DEBUG_MODE_KEY = 'oppsAdjudicator.debugMode';

  function loadDebugMode() {
    try {
      return window.localStorage.getItem(DEBUG_MODE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function saveDebugMode(on) {
    try {
      window.localStorage.setItem(DEBUG_MODE_KEY, on ? '1' : '0');
    } catch (e) {
      // Non-fatal — a UI preference not persisting is not worth surfacing.
    }
  }

  var state = {
    view: 'input', // input | result | not_opps | inspector | reference | rules | orgs
    inputMode: 'paste', // paste | upload
    codesText: '',
    dateOfService: '',
    fileName: null,
    result: null, // view-model built by buildResultViewModel()
    notOpps: null, // view-model built by buildNotOppsViewModel()
    expanded: {}, // lineId -> bool
    inspectorCode: '',
    inspectorResult: null, // view-model built by buildInspectorViewModel()
    debugMode: loadDebugMode(), // sidebar Settings toggle — gates scope exclusions
  };

  // -------------------------------------------------------------------------
  // Small utilities.
  // -------------------------------------------------------------------------

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(yyyymmdd) {
    if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || '';
    return yyyymmdd.slice(0, 4) + '-' + yyyymmdd.slice(4, 6) + '-' + yyyymmdd.slice(6, 8);
  }

  function isEngineError(e) {
    return e && typeof e === 'object' && e.name === 'EngineError';
  }

  function describeError(err) {
    if (isEngineError(err)) return '[' + err.code + '] ' + err.detail;
    return err && err.message ? err.message : String(err);
  }

  // -------------------------------------------------------------------------
  // WHY text for one line — built from window.OppsEngine.why (extracted from
  // tools/adjudicate.mjs, see tools/lib/why.mjs) plus RULES_BY_ID, exactly
  // the same generated-text pipeline the CLI's --why uses. `result` here is
  // always the real EngineResult (called with traceLevel: 'full' so every
  // AssembledEvaluation carries a directly-resolved `counterfactual`, not a
  // `counterfactualRef` needing a second lookup — see the final report for
  // why 'full' was chosen over the engine's own 'standard' default).
  // -------------------------------------------------------------------------

  function buildLineWhy(d, result, factsIndex, displayIndexByLineId) {
    if (d.trace.length === 0) {
      if (d.flags.length > 0) {
        return d.flags.map(function (f) {
          return f.message;
        });
      }
      return [
        'No rule trace or flag was recorded for this line — its status was decided before any registry rule ran (the section 8.0 gate or phase 1 classification).',
      ];
    }
    var fired = d.trace.filter(function (ev) {
      return ev.outcome === 'FIRED';
    });
    if (fired.length === 0) {
      return ['No rule in the trace fired for this line — it kept its default disposition (status: ' + d.status + ').'];
    }
    return fired.map(function (ev) {
      var rule = RULES_BY_ID.get(ev.ruleId);
      if (!rule) return '(no rule definition on record for ' + ev.ruleId + ' — registry gap)';
      var cond = Engine.why.describeFiredWhen(rule, ev, result, factsIndex, displayIndexByLineId);
      var eff = Engine.why.describeEffects(d, ev, result, displayIndexByLineId, false);
      return eff ? cond + ' ' + eff : cond;
    });
  }

  function buildTraceRowWhy(ev, result, factsIndex, displayIndexByLineId) {
    if (ev.outcome === 'FIRED') {
      var rule = RULES_BY_ID.get(ev.ruleId);
      return rule ? Engine.why.describeFiredWhen(rule, ev, result, factsIndex, displayIndexByLineId) : Engine.why.describeOp(ev.predicate);
    }
    if (ev.outcome === 'NOT_EVALUATED') {
      var reason = ev.examined && ev.examined.detail && typeof ev.examined.detail.reason === 'string' ? ev.examined.detail.reason : null;
      return reason || Engine.why.describeOp(ev.predicate);
    }
    if (ev.outcome === 'NOT_REACHED') {
      return ev.counterfactual || '(short-circuited before this rule ran in this phase)';
    }
    return Engine.why.shortReasonForEvaluation(ev);
  }

  // -------------------------------------------------------------------------
  // View-model builders. Each takes the engine's real output and produces
  // plain data the render*() functions below can stamp into HTML — no
  // hand-authored determination text anywhere in this file.
  // -------------------------------------------------------------------------

  function buildResultViewModel(result, sourceLabel, adapterFlags) {
    var displayIndexByLineId = new Map();
    result.determinations.forEach(function (d, i) {
      displayIndexByLineId.set(d.lineId, i + 1);
    });
    var factsIndex = Engine.why.buildFactsIndex(result.facts);

    var assumptionFlags = adapterFlags.filter(function (f) {
      return f.severity === 'assumption';
    });
    var showAssumptionBanner = assumptionFlags.length > 0;
    var assumptionMessage = assumptionFlags.map(function (f) { return f.message; }).join(' ');

    var lines = result.determinations.map(function (d, i) {
      var sm = statusMeta(d.status);
      var bundledUnderOrdinal = d.bundledUnder !== null ? displayIndexByLineId.get(d.bundledUnder) : undefined;

      // SI is the vocabulary the reader thinks in (M25 item 1) — shown on
      // every row, not just behind the expander. resolvedSI (Addendum B)
      // and effectiveSI (post-conversion, e.g. §9.3's Q4 -> A) can differ;
      // when they do, that difference IS the answer (the line left OPPS for
      // another fee schedule), so it is shown as a compact transition
      // rather than picking one value to display. Both fields are read
      // defensively — a determination is not guaranteed to carry either.
      var resolvedSI = d.resolvedSI !== null && d.resolvedSI !== undefined && d.resolvedSI !== '' ? String(d.resolvedSI) : null;
      var effectiveSIRaw = d.effectiveSI !== null && d.effectiveSI !== undefined && d.effectiveSI !== '' ? String(d.effectiveSI) : null;
      var siTransition = resolvedSI !== null && effectiveSIRaw !== null && effectiveSIRaw !== resolvedSI;

      var trace = d.trace.map(function (ev) {
        var why = buildTraceRowWhy(ev, result, factsIndex, displayIndexByLineId);
        // dsl/evaluate.ts's own counterfactual text already reads "would
        // fire if X" (a full sentence) — the design's row template adds its
        // own "Would fire if: " label in front of {{ row.counterfactual }},
        // which the design's mock data (a bare clause, no "would fire if"
        // prefix) was written to pair with. Against the real engine string
        // that would double up ("Would fire if: would fire if X"), so the
        // redundant leading clause is stripped here — a mechanical display
        // normalization, not a reworded counterfactual.
        var counterfactual = ev.outcome !== 'FIRED' && ev.counterfactual ? ev.counterfactual.replace(/^would fire if\s+/i, '') : null;
        var om = outcomeMeta(ev.outcome);
        return {
          ruleId: ev.ruleId,
          outcome: ev.outcome,
          citation: ev.citation,
          why: why,
          counterfactual: counterfactual,
          hasCounterfactual: !!counterfactual,
          outcomeBg: om.bg,
          outcomeFg: om.fg,
        };
      });

      return {
        lineId: d.lineId,
        ordinal: i + 1,
        code: d.code || '(no code)',
        status: d.status,
        statusLabel: sm.label,
        statusBg: sm.bg,
        statusFg: sm.fg,
        resolvedSI: resolvedSI,
        effectiveSI: siTransition ? effectiveSIRaw : null,
        siTransition: siTransition,
        basisLabel: d.basis === 'NONE' ? '—' : d.basis,
        bundledUnderOrdinal: bundledUnderOrdinal || null,
        bundledUnderNote: bundledUnderOrdinal ? 'bundled under line ' + bundledUnderOrdinal : '',
        indentPx: bundledUnderOrdinal ? 28 : 0,
        accentColor: accentFor(d.status),
        whyParagraphs: buildLineWhy(d, result, factsIndex, displayIndexByLineId),
        flags: d.flags.map(function (f) {
          var fm = flagMeta(f.severity);
          return { severity: f.severity, message: f.message, citation: f.citation, bg: fm.bg, fg: fm.fg, border: fm.border };
        }),
        trace: trace,
      };
    });

    var traceRows = result.determinations.reduce(function (s, d) {
      return s + d.trace.length;
    }, 0);
    var flagCount =
      adapterFlags.length +
      result.disclosures.length +
      result.determinations.reduce(function (s, d) {
        return s + d.flags.length;
      }, 0);

    var scopeExclusions = result.scopeExclusions.map(function (ex) {
      var rule = RULES_BY_ID.get(ex.ruleId);
      var note = rule
        ? 'requires ' + Engine.why.describeOp(rule.scope) + ' — not true for any of the ' + ex.excludedLineIds.length + ' line(s) checked'
        : ex.excludedLineIds.length + ' line(s) excluded';
      return { ruleId: ex.ruleId, note: note };
    });

    return {
      sourceLabel: sourceLabel,
      showAssumptionBanner: showAssumptionBanner,
      assumptionMessage: assumptionMessage,
      stats: {
        lines: result.determinations.length,
        traceRows: traceRows,
        counterfactuals: Object.keys(result.counterfactuals).length,
        flags: flagCount,
        scopeExclusions: scopeExclusions.length,
      },
      lines: lines,
      hasScopeExclusions: scopeExclusions.length > 0,
      scopeExclusions: scopeExclusions,
    };
  }

  function buildNotOppsViewModel(applicability, sourceLabel) {
    return {
      sourceLabel: sourceLabel,
      gate: applicability.gate,
      likelySystem: applicability.likelySystem,
      confidence: applicability.confidence,
      detail: applicability.detail,
      // The real Applicability.evidence is a flat array of engine-authored
      // strings (§8.0.2), not the design's hand-typed {title, detail,
      // citation} shape. Each evidence string becomes one signal card's
      // title, verbatim; §8.0.2 is the one section governing the whole
      // signal table, so it is cited uniformly rather than invented per row.
      signals: applicability.evidence.map(function (e) {
        return { title: e, citation: '§8.0.2' };
      }),
    };
  }

  function buildInspectorViewModel(code) {
    var facts = Engine.codeFacts(code);
    var app = Engine.applicability(code, Engine.registry);

    function mapRule(r, withUndecidable) {
      var out = {
        ruleId: r.ruleId,
        firesWhen: r.firesWhen,
        effects: r.effects.map(function (e) {
          return e.description;
        }),
        note: r.note,
        citation: r.citation,
      };
      if (withUndecidable) {
        out.undecidable = r.undecidable.map(function (u) {
          return u.description;
        });
      }
      return out;
    }

    return {
      code: code,
      facts: facts,
      groups: [
        { label: 'Admitted', sublabel: 'always considered for this code', color: 'var(--green-800)', rules: app.admitted.map(function (r) { return mapRule(r, false); }) },
        { label: 'Conditional', sublabel: 'depends on claim state', color: 'var(--gold)', rules: app.conditional.map(function (r) { return mapRule(r, true); }) },
        {
          label: 'Reserved',
          sublabel: 'no backing data loaded',
          color: 'var(--ink-3)',
          rules: app.reserved.map(function (r) {
            return { ruleId: r.ruleId, firesWhen: r.reason, effects: [], note: r.note, citation: r.citation };
          }),
        },
      ],
    };
  }

  /** §13.1: "generated from the registry and data at load via argSpec, not typed as static HTML." Walks every registry rule's `scope` argSpec for SI values, and every `then[]` effect's own describe() for the disposition text — never a hand-typed row. */
  function collectSiValues(argSpec, out) {
    if (!argSpec) return;
    if (argSpec.dimension === 'si' && !argSpec.negated && Array.isArray(argSpec.values)) {
      argSpec.values.forEach(function (v) {
        out.add(String(v));
      });
    }
    if (Array.isArray(argSpec.children)) {
      argSpec.children.forEach(function (c) {
        collectSiValues(c, out);
      });
    }
  }

  /**
   * SI-first reference data (M25 item 3): an SI does not name a single rule
   * — 13 SIs map to more than one (Q1/Q2 each map to four), and 6 rules are
   * SI-agnostic (no SI in their scope at all, e.g. NCCI.PTP.PAIR, MUE.LIMIT).
   * The old shape here was one row per rule with an SI list; that both
   * listed rules flat under a rule-id-first header (backwards from what the
   * reader reasons in) AND silently dropped every SI-agnostic rule from the
   * table entirely (`if (siSet.size === 0) return;`) — SI-agnostic rules are
   * real applicable rules, not table noise, and belong in an explicit "any
   * SI" group rather than disappearing. This version groups the other way:
   * by SI first, each with its rule(s) as the audit layer underneath, plus
   * one explicit group for the rules that apply regardless of SI. Still
   * §13.1-generated — every value here still comes from `argSpec()` /
   * `describe()` at runtime, nothing is hand-typed.
   */
  function buildReferenceGroups() {
    var bySi = new Map(); // SI value -> rule entries
    var agnostic = [];

    Engine.registry.forEach(function (rule) {
      var scopeOp = Engine.operators[rule.scope.op];
      if (!scopeOp) return;
      var argSpec;
      try {
        argSpec = scopeOp.argSpec(rule.scope.args);
      } catch (e) {
        return;
      }
      var siSet = new Set();
      collectSiValues(argSpec, siSet);

      var effects = rule.then.map(function (eff) {
        var eop = Engine.operators[eff.op];
        try {
          return eop ? eop.describe(eff.args) : eff.op;
        } catch (e) {
          return eff.op;
        }
      });

      var entry = {
        ruleId: rule.id,
        band: rule.band,
        order: rule.order,
        citation: rule.citation,
        disposition: effects.join('; '),
      };

      if (siSet.size === 0) {
        agnostic.push(entry);
        return;
      }
      siSet.forEach(function (si) {
        if (!bySi.has(si)) bySi.set(si, []);
        bySi.get(si).push(entry);
      });
    });

    function byBandOrder(list) {
      return list.slice().sort(function (a, b) {
        return a.band - b.band || a.order - b.order;
      });
    }

    var siGroups = Array.from(bySi.keys())
      .sort()
      .map(function (si) {
        return { si: si, rules: byBandOrder(bySi.get(si)) };
      });

    return { siGroups: siGroups, agnostic: byBandOrder(agnostic) };
  }

  // -------------------------------------------------------------------------
  // Rendering. Each render*() returns an HTML string; render() stamps it
  // into #view and syncs the sidebar's active nav state.
  // -------------------------------------------------------------------------

  function renderSidebarActive() {
    var claimsActive = state.view === 'input' || state.view === 'result' || state.view === 'not_opps';
    var map = { claims: claimsActive, inspector: state.view === 'inspector', reference: state.view === 'reference', rules: state.view === 'rules', orgs: state.view === 'orgs' };
    document.querySelectorAll('.nav-item[data-nav]').forEach(function (btn) {
      var key = btn.getAttribute('data-nav');
      btn.classList.toggle('active', !!map[key]);
    });
  }

  function renderInput() {
    var isPaste = state.inputMode === 'paste';
    var html = '';
    html += '<div class="page-head"><h1>New claim</h1>';
    html +=
      '<p>Given these codes, how would Medicare OPPS bundle them, and why. Paste codes or drop a claim file — nothing here is editable, and no dollar amounts are shown.</p></div>';

    html += '<div class="tabs">';
    html += '<div class="tab' + (isPaste ? ' active' : '') + '" data-tab="paste">Paste codes</div>';
    html += '<div class="tab' + (!isPaste ? ' active' : '') + '" data-tab="upload">Upload claim file</div>';
    html += '</div>';

    if (isPaste) {
      html += '<div class="card">';
      html += '<div class="field"><label>Codes</label>';
      html +=
        '<textarea id="codes-text" placeholder="59025 84112 81001 36415 G0463 99284 0106T 00100 J1745 99205" rows="4">' +
        esc(state.codesText) +
        '</textarea>';
      html += '<div class="field-hint">Space, comma, or newline separated. Units and modifiers: 36415x2, J1745:JW.</div></div>';
      html += '<div class="form-row">';
      html += '<div class="field"><label>Date of service (optional)</label>';
      html += '<input type="date" id="dos-input" value="' + esc(state.dateOfService) + '"></div>';
      html += '<button type="button" class="btn-primary" data-action="run-paste">Run adjudication</button>';
      html += '</div></div>';
    } else {
      html += '<div class="upload-card">';
      html += '<div class="upload-lead">Drop an institutional claim XML, or choose a file.</div>';
      html += '<label class="file-label">Choose file<input type="file" id="file-input" accept=".xml" style="display:none"></label>';
      if (state.fileName) html += '<div class="file-name">' + esc(state.fileName) + '</div>';
      html += '<div class="upload-note">Runs entirely in the browser. No file leaves this page — nothing is uploaded to a server.</div>';
      html += '</div>';
    }

    html += '<div class="sample-block"><div class="sample-heading">Sample material</div><div class="sample-row">';
    html += '<div class="sample-chip" data-action="sample-ten-line">10-line outpatient claim</div>';
    html += '<div class="sample-chip" data-action="sample-not-opps">Inpatient CAH claim (not OPPS)</div>';
    html += '<div class="sample-chip" data-action="sample-fixture">4-line outpatient fixture</div>';
    html += '</div></div>';

    return html;
  }

  function renderFlagBox(f) {
    return (
      '<div class="flag-box" style="background:' +
      f.bg +
      ';border-color:' +
      f.border +
      '"><span class="flag-box-severity" style="color:' +
      f.fg +
      '">' +
      esc(f.severity) +
      '</span><span class="flag-box-message">' +
      esc(f.message) +
      (f.citation ? ' <span style="color:var(--ink-4);font-family:var(--mono);font-size:11.5px;">' + esc(f.citation) + '</span>' : '') +
      '</span></div>'
    );
  }

  function renderTraceRow(row) {
    // SI-first, rule id secondary (M25 item 3): the rule id is provenance —
    // how the outcome traces back to the registry — not the headline. It
    // stays visible on every row (never removed), but small and muted,
    // folded into the citation line rather than leading the row.
    var html = '<div class="trace-row">';
    html += '<div><span class="outcome-badge" style="background:' + row.outcomeBg + ';color:' + row.outcomeFg + '">' + esc(row.outcome) + '</span></div>';
    html += '<div class="trace-why"><div>' + esc(row.why) + '</div>';
    if (row.hasCounterfactual) {
      html += '<div class="trace-counterfactual">Would fire if: ' + esc(row.counterfactual) + '</div>';
    }
    html += '<div class="trace-citation"><span class="trace-rule-id">' + esc(row.ruleId) + '</span> &middot; ' + esc(row.citation) + '</div></div>';
    html += '</div>';
    return html;
  }

  /** SI cell for a result row (M25 item 1) — resolvedSI alone, or the compact `Q4 → A` transition when effectiveSI diverges (§9.3). */
  function renderSiCell(line) {
    if (line.resolvedSI === null) {
      return '<span class="line-si line-si-none">&mdash;</span>';
    }
    if (!line.siTransition) {
      return '<span class="line-si">' + esc(line.resolvedSI) + '</span>';
    }
    var title = esc(line.resolvedSI) + ' resolved by Addendum B, converted to ' + esc(line.effectiveSI) + ' per §9.3 &mdash; this line left OPPS for another fee schedule.';
    return (
      '<span class="line-si line-si-transition" title="' + title + '">' +
      esc(line.resolvedSI) +
      '<span class="si-arrow"> &rarr; </span>' +
      '<span class="si-effective">' + esc(line.effectiveSI) + '</span>' +
      '</span>'
    );
  }

  function renderLine(line) {
    var expanded = !!state.expanded[line.lineId];
    var html =
      '<div class="line-card" style="border-left-color:' + line.accentColor + ';margin-left:' + line.indentPx + 'px;">';
    html += '<button type="button" class="line-row" data-toggle-line="' + esc(line.lineId) + '">';
    html += '<span class="line-ordinal">' + line.ordinal + '</span>';
    html += '<span class="line-code">' + esc(line.code) + '</span>';
    html += renderSiCell(line);
    html += '<span class="line-note">' + esc(line.bundledUnderNote) + '</span>';
    html += '<span><span class="status-badge" style="background:' + line.statusBg + ';color:' + line.statusFg + '">' + esc(line.statusLabel) + '</span></span>';
    html += '<span class="basis-label">' + esc(line.basisLabel) + '</span>';
    html += '<span class="line-tail">';
    line.flags.forEach(function (f) {
      html += '<span class="flag-pill" style="background:' + f.bg + ';color:' + f.fg + ';border-color:' + f.border + '">' + esc(f.severity) + '</span>';
    });
    html += '<span class="expand-glyph">' + (expanded ? '−' : '+') + '</span>';
    html += '</span>';
    html += '</button>';

    if (expanded) {
      html += '<div class="line-detail">';
      html += '<div class="why-block">';
      line.whyParagraphs.forEach(function (p) {
        html += '<p>' + esc(p) + '</p>';
      });
      html += '</div>';
      line.flags.forEach(function (f) {
        html += renderFlagBox(f);
      });
      html += '<div class="section-label">Rules considered, in order</div>';
      html += '<div class="trace-table">';
      if (line.trace.length === 0) {
        html += '<div class="inspector-empty">No rule trace was recorded for this line.</div>';
      } else {
        line.trace.forEach(function (row) {
          html += renderTraceRow(row);
        });
      }
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderResult() {
    var vm = state.result;
    var html = '';
    html += '<div class="page-head-row" data-noprint>';
    html += '<div><h1>Adjudication result</h1><div class="source-label">' + esc(vm.sourceLabel) + '</div></div>';
    html += '<div class="btn-row"><button type="button" class="btn" data-action="print-result">Print</button>';
    html += '<button type="button" class="btn-quiet" data-nav="claims">New claim</button></div>';
    html += '</div>';

    if (vm.showAssumptionBanner) {
      html += '<div class="assumption-banner"><div class="assumption-tag">Assumption</div>';
      html += '<div class="assumption-text">A code list is not a claim. ' + esc(vm.assumptionMessage) + ' If the real claim differs, the bundling answer below may differ.</div>';
      html += '</div>';
    }

    html += '<div class="stats-row">';
    html += '<div><span class="stat-label">Lines</span> ' + vm.stats.lines + '</div>';
    html += '<div><span class="stat-label">Trace rows</span> ' + vm.stats.traceRows + '</div>';
    html += '<div><span class="stat-label">Counterfactuals</span> ' + vm.stats.counterfactuals + '</div>';
    html += '<div><span class="stat-label">Flags</span> ' + vm.stats.flags + '</div>';
    html += '<div><span class="stat-label">Scope exclusions</span> ' + vm.stats.scopeExclusions;
    if (vm.stats.scopeExclusions > 0 && !state.debugMode) {
      html += ' <span class="stat-hint">(debugging mode)</span>';
    }
    html += '</div>';
    html += '</div>';

    html += '<div class="lines">';
    vm.lines.forEach(function (line) {
      html += renderLine(line);
    });
    html += '</div>';

    // Folded up by default (M25 item 2) — 20-30 rows of "rule X requires SI
    // Y, not true here" is audit detail, not the answer a bill processor
    // reads. Kept reachable (never deleted, §5.3's auditability requirement)
    // behind the sidebar's debugging-mode toggle, which also governs print —
    // this block simply is not in the HTML when the toggle is off, so a
    // printed exhibit inherits the same behavior for free.
    if (vm.hasScopeExclusions && state.debugMode) {
      html += '<div class="scope-exclusions"><div class="section-label">Scope exclusions — claim level, considered once</div>';
      vm.scopeExclusions.forEach(function (ex) {
        html += '<div class="scope-exclusion-row"><span class="rid">' + esc(ex.ruleId) + '</span> — ' + esc(ex.note) + '</div>';
      });
      html += '</div>';
    }

    return html;
  }

  function renderNotOpps() {
    var vm = state.notOpps;
    var html = '';
    html += '<div class="page-head-row" data-noprint><h1>Not an OPPS claim</h1>';
    html += '<button type="button" class="btn-quiet" data-nav="claims">New claim</button></div>';

    html += '<div class="not-opps-lead"><p>This claim carries ' + vm.signals.length + ' independent signal' + (vm.signals.length === 1 ? '' : 's') +
      ' that it is not an outpatient OPPS claim. The engine reports all of them rather than picking a winner — no single indicator is treated as decisive over the others. This most likely needs a human, not a bundling answer.</p></div>';

    html += '<div class="not-opps-meta">Gate: <strong>' + esc(vm.gate) + '</strong> &middot; Likely system: ' + esc(vm.likelySystem) + ' (' + esc(vm.confidence) + ') &middot; ' + esc(vm.detail) + '</div>';

    html += '<div class="signal-list" style="margin-top:16px;">';
    vm.signals.forEach(function (s) {
      html += '<div class="signal-card"><div class="signal-title">' + esc(s.title) + '</div>';
      html += '<div class="signal-citation">' + esc(s.citation) + '</div></div>';
    });
    html += '</div>';

    html += '<div class="not-opps-source">Source: ' + esc(vm.sourceLabel) + '</div>';
    return html;
  }

  function renderInspector() {
    var html = '';
    html += '<div class="page-head"><h1>Code inspector</h1>';
    html += '<p>Given a single code, no claim required: every rule that can touch it, grouped by whether it depends on claim context.</p></div>';

    html += '<div class="inspector-form">';
    html += '<input id="inspector-code-input" placeholder="e.g. 36415" value="' + esc(state.inspectorCode) + '">';
    html += '<button type="button" class="btn-primary" data-action="run-inspector">Inspect</button>';
    html += '</div>';

    var vm = state.inspectorResult;
    if (vm) {
      html += '<div class="code-facts">';
      html += '<div><span class="fact-label">Code</span> ' + esc(vm.code) + '</div>';
      html += '<div><span class="fact-label">SI</span> ' + esc(vm.facts.si === null ? '—' : vm.facts.si) + '</div>';
      html += '<div><span class="fact-label">APC</span> ' + esc(vm.facts.apc === null ? '—' : vm.facts.apc) + '</div>';
      html += '<div><span class="fact-label">Weight</span> ' + (vm.facts.weight === null ? '—' : esc(vm.facts.weight)) + '</div>';
      html += '<div><span class="fact-label">Has rate</span> ' + (vm.facts.hasRate ? 'yes' : 'no') + '</div>';
      html += '<div><span class="fact-label">CLFS present</span> ' + (vm.facts.clfsPresent ? 'yes' : 'no') + '</div>';
      html +=
        '<div><span class="fact-label">Historical term date</span> ' +
        (vm.facts.historicalTermDate === null ? '—' : esc(fmtDate(vm.facts.historicalTermDate))) +
        '</div>';
      html += '</div>';

      html += '<div class="inspector-groups">';
      vm.groups.forEach(function (grp) {
        html += '<div><div class="inspector-group-head">';
        html += '<div class="inspector-group-label" style="color:' + grp.color + '">' + esc(grp.label) + '</div>';
        html += '<div class="inspector-group-sublabel">' + esc(grp.sublabel) + '</div></div>';
        html += '<div class="inspector-rule-table">';
        if (grp.rules.length === 0) {
          html += '<div class="inspector-empty">No rules in this group for this code.</div>';
        } else {
          grp.rules.forEach(function (r) {
            html += '<div class="inspector-rule-row"><div class="inspector-rule-id">' + esc(r.ruleId) + '</div><div>';
            html += '<div class="inspector-rule-desc">' + esc(r.firesWhen) + '</div>';
            if (r.effects && r.effects.length > 0) {
              html += '<div class="inspector-rule-effects">Effects: ' + esc(r.effects.join('; ')) + '</div>';
            }
            if (r.undecidable && r.undecidable.length > 0) {
              html += '<div class="inspector-rule-undecidable">Depends on: ' + esc(r.undecidable.join('; ')) + '</div>';
            }
            if (r.note) {
              html += '<div class="inspector-rule-note">' + esc(r.note) + '</div>';
            }
            html += '<div class="inspector-rule-citation">' + esc(r.citation) + '</div>';
            html += '</div></div>';
          });
        }
        html += '</div></div>';
      });
      html += '</div>';
    }

    return html;
  }

  /** One rule under a reference-table SI group. Disposition leads (what happens); rule id + citation trail underneath, small and muted — the audit layer, not the headline (M25 item 3). */
  function renderReferenceRuleRow(r) {
    return (
      '<div class="ref-rule-row">' +
      '<div class="ref-rule-disposition">' + esc(r.disposition) + '</div>' +
      '<div class="ref-rule-meta"><span class="ref-rule-id">' + esc(r.ruleId) + '</span> &middot; ' + esc(r.citation) + '</div>' +
      '</div>'
    );
  }

  function renderReference() {
    var html = '';
    html += '<div class="page-head"><h1>Reference tables</h1>';
    html +=
      '<p>Generated from the registry at runtime via each rule’s and operator’s own <code>argSpec()</code>/<code>describe()</code> — not hand-authored. Grouped by status indicator, since that is the vocabulary a determination reads in; some SIs share several rules, some rules apply to every SI, and no rule id is left out.</p></div>';

    var groups = buildReferenceGroups();
    html += '<div class="inspector-groups">';
    groups.siGroups.forEach(function (g) {
      html += '<div><div class="inspector-group-head">';
      html += '<div class="inspector-group-label" style="color:var(--green-800)">SI ' + esc(g.si) + '</div>';
      html += '<div class="inspector-group-sublabel">' + g.rules.length + ' rule' + (g.rules.length === 1 ? '' : 's') + '</div></div>';
      html += '<div class="inspector-rule-table">';
      g.rules.forEach(function (r) {
        html += renderReferenceRuleRow(r);
      });
      html += '</div></div>';
    });

    if (groups.agnostic.length > 0) {
      html += '<div><div class="inspector-group-head">';
      html += '<div class="inspector-group-label" style="color:var(--ink-3)">Any SI</div>';
      html += '<div class="inspector-group-sublabel">applies to every line regardless of status indicator</div></div>';
      html += '<div class="inspector-rule-table">';
      groups.agnostic.forEach(function (r) {
        html += renderReferenceRuleRow(r);
      });
      html += '</div></div>';
    }
    html += '</div>';
    return html;
  }

  function renderRulesPage() {
    return (
      '<div class="prose-page"><h1>Rules</h1>' +
      '<p>Browsing and editing the registry — the declarative rules with citations that the interpreter runs — lands here. Not yet built.</p></div>'
    );
  }

  function renderOrgsPage() {
    return (
      '<div class="prose-page"><h1>Organizations</h1>' +
      '<p>Per-organization rule sets that diverge from Medicare — where a commercial payer bundles differently — land here. Advisory annotations only; they must never read as an adjudicated outcome.</p></div>'
    );
  }

  function render() {
    var html;
    switch (state.view) {
      case 'input':
        html = renderInput();
        break;
      case 'result':
        html = state.result ? renderResult() : renderInput();
        break;
      case 'not_opps':
        html = state.notOpps ? renderNotOpps() : renderInput();
        break;
      case 'inspector':
        html = renderInspector();
        break;
      case 'reference':
        html = renderReference();
        break;
      case 'rules':
        html = renderRulesPage();
        break;
      case 'orgs':
        html = renderOrgsPage();
        break;
      default:
        html = renderInput();
    }
    viewEl.innerHTML = html;
    renderSidebarActive();
  }

  // -------------------------------------------------------------------------
  // Actions.
  // -------------------------------------------------------------------------

  function goTo(view) {
    state.view = view;
    render();
  }

  /** Sidebar Settings toggle lives outside #view (it must survive every render() of the main content), so it is synced by id rather than rebuilt by render(). */
  function syncDebugToggleUI() {
    var btn = document.getElementById('debug-toggle');
    var pill = document.getElementById('debug-pill');
    if (!btn || !pill) return;
    btn.classList.toggle('active', state.debugMode);
    pill.textContent = state.debugMode ? 'On' : 'Off';
    pill.classList.toggle('debug-pill-on', state.debugMode);
  }

  function toggleDebugMode() {
    state.debugMode = !state.debugMode;
    saveDebugMode(state.debugMode);
    syncDebugToggleUI();
    render();
  }

  function runClaim(claim, sourceLabel, adapterFlags) {
    var result;
    try {
      result = Engine.adjudicate({ claim: claim, options: { traceLevel: 'full' } });
    } catch (err) {
      window.alert('Could not adjudicate this claim: ' + describeError(err));
      return;
    }
    if (result.applicability !== null) {
      state.notOpps = buildNotOppsViewModel(result.applicability, sourceLabel);
      state.view = 'not_opps';
    } else {
      state.result = buildResultViewModel(result, sourceLabel, adapterFlags || []);
      state.expanded = {};
      state.view = 'result';
    }
    render();
  }

  function runPaste() {
    var text = state.codesText || '';
    if (text.trim() === '') return;
    var options = state.dateOfService ? { dos: state.dateOfService.replace(/-/g, '') } : {};
    var parsed;
    try {
      parsed = Engine.parseCodeList(text, options);
    } catch (err) {
      window.alert('Could not parse the code list: ' + describeError(err));
      return;
    }
    var sourceLabel = 'Pasted codes' + (state.dateOfService ? ' — DOS ' + state.dateOfService : '');
    runClaim(parsed.claim, sourceLabel, parsed.flags);
  }

  function onFileChange(file) {
    state.fileName = file.name;
    render();
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      var parsedList;
      try {
        parsedList = Engine.parseInstitutionalXml(text);
      } catch (err) {
        window.alert('Could not parse this XML file: ' + describeError(err));
        return;
      }
      var first = parsedList[0];
      if (!first) {
        window.alert('No <claim> element found in this file.');
        return;
      }
      runClaim(first.claim, file.name, first.flags);
    };
    reader.onerror = function () {
      window.alert('Could not read this file.');
    };
    reader.readAsText(file);
  }

  function loadSampleTenLine() {
    state.codesText = SAMPLE_CODES_TEN_LINE;
    state.inputMode = 'paste';
    var parsed = Engine.parseCodeList(SAMPLE_CODES_TEN_LINE);
    runClaim(parsed.claim, '10-line sample claim', parsed.flags);
  }

  function loadSampleNotOpps() {
    var parsedList = Engine.parseInstitutionalXml(SAMPLE_XML_CAH_INPATIENT);
    var first = parsedList[0];
    runClaim(first.claim, 'test/fixtures/inst-xml-inpatient-cah-revonly.xml', first.flags);
  }

  function loadSampleFixture() {
    var parsedList = Engine.parseInstitutionalXml(SAMPLE_XML_4LINE_OUTPATIENT);
    var first = parsedList[0];
    runClaim(first.claim, 'test/fixtures/outpatient-13x-hcpcs.xml', first.flags);
  }

  function toggleLine(lineId) {
    state.expanded[lineId] = !state.expanded[lineId];
    render();
  }

  function runInspector() {
    var code = (state.inspectorCode || '').trim().toUpperCase();
    if (code === '') return;
    state.inspectorResult = buildInspectorViewModel(code);
    render();
  }

  function printResult() {
    if (state.view === 'result' && state.result) {
      state.result.lines.forEach(function (l) {
        state.expanded[l.lineId] = true;
      });
      render();
      window.setTimeout(function () {
        window.print();
      }, 50);
    } else {
      window.print();
    }
  }

  // -------------------------------------------------------------------------
  // Event delegation. Static sidebar (outside #view) is wired once; #view's
  // content is rebuilt on every render() so its listeners are delegated from
  // #view itself rather than re-attached per element.
  // -------------------------------------------------------------------------

  document.addEventListener('click', function (e) {
    var debugBtn = e.target.closest('[data-action="toggle-debug"]');
    if (debugBtn) {
      toggleDebugMode();
      return;
    }
    var navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      var target = navBtn.getAttribute('data-nav');
      goTo(target === 'claims' ? 'input' : target);
      return;
    }
  });

  viewEl.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab) {
      state.inputMode = tab.getAttribute('data-tab');
      render();
      return;
    }
    var toggle = e.target.closest('[data-toggle-line]');
    if (toggle) {
      toggleLine(toggle.getAttribute('data-toggle-line'));
      return;
    }
    var action = e.target.closest('[data-action]');
    if (action) {
      var name = action.getAttribute('data-action');
      if (name === 'run-paste') runPaste();
      else if (name === 'sample-ten-line') loadSampleTenLine();
      else if (name === 'sample-not-opps') loadSampleNotOpps();
      else if (name === 'sample-fixture') loadSampleFixture();
      else if (name === 'run-inspector') runInspector();
      else if (name === 'print-result') printResult();
      return;
    }
  });

  viewEl.addEventListener('input', function (e) {
    if (e.target.id === 'codes-text') {
      state.codesText = e.target.value;
    } else if (e.target.id === 'inspector-code-input') {
      state.inspectorCode = e.target.value;
    }
  });

  viewEl.addEventListener('change', function (e) {
    if (e.target.id === 'dos-input') {
      state.dateOfService = e.target.value;
    } else if (e.target.id === 'file-input') {
      var file = e.target.files && e.target.files[0];
      if (file) onFileChange(file);
    }
  });

  viewEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'inspector-code-input') {
      e.preventDefault();
      runInspector();
    }
  });

  // -------------------------------------------------------------------------
  // Init.
  // -------------------------------------------------------------------------

  syncDebugToggleUI();
  render();
})();
