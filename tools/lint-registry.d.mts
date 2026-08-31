// tools/lint-registry.d.mts — hand-written type declaration for
// tools/lint-registry.mjs's small exported surface, so test/lint-registry.
// test.ts (and any other .ts consumer) typechecks under this repo's strict
// tsconfig without turning the tool itself into TypeScript. `tools/` stays
// plain `.mjs` per this unit's constraints; this file is the standard
// TypeScript mechanism (a co-located `.d.mts`, resolved automatically for
// an `.mjs` specifier since TS 4.7) for describing a JS module's shape to
// callers, not a second implementation of it — every type here mirrors the
// real runtime shape and must be kept in sync by hand if the exports change.

export interface Violation {
  readonly gate: string;
  readonly section: string;
  readonly ruleId: string;
  readonly message: string;
}

export interface D45Offender {
  readonly ruleId: string;
  readonly ops: readonly string[];
}

export interface D45Result {
  readonly count: number;
  readonly baseline: number;
  readonly exceeded: boolean;
  readonly offenders: readonly D45Offender[];
}

export interface D66GuardReason {
  readonly ruleId: string;
  readonly message: string;
}

export interface D66GuardResult {
  readonly count: number;
  readonly baseline: number;
  readonly exceeded: boolean;
  readonly ruleIds: readonly string[];
  readonly reasons: readonly D66GuardReason[];
}

export interface LintResult {
  readonly violations: readonly Violation[];
  readonly info: readonly string[];
  readonly d45: D45Result;
  readonly d66Guard: D66GuardResult;
}

export interface RuleEntry {
  readonly rule: Record<string, unknown>;
  readonly sourceFile?: string;
}

/** `isNullableInData`: given a rank field and either a concrete SI list or `null` (domain not statically resolvable — check the whole dataset), returns whether the currently loaded data has at least one null row for that field/domain. §15.3: "nullable in the data," not in the type. */
export interface RankFieldNullability {
  readonly isNullableInData: (field: string, siValues: readonly string[] | null) => boolean;
}

export interface LintDeps {
  readonly operators: Record<string, unknown>;
  readonly isKnownFlagCode: (code: string) => boolean;
  readonly rankFieldNullability: RankFieldNullability;
  readonly d45Baseline?: number;
  readonly d66GuardBaseline?: number;
}

export declare function lintRules(ruleEntries: readonly RuleEntry[], deps: LintDeps): LintResult;

export declare const D45_BASELINE: number;
export declare const D66_GUARD_BASELINE: number;
export declare const RATCHET_GATES: ReadonlySet<string>;

/** Builds a `RankFieldNullability` from `src/data/opps.cy2026.ts`'s `OPPS_ROWS` shape (`[code, si, apc, weight, rateMils]`) — real data in the CLI, or a small synthetic row array in a test. */
export declare function buildRankFieldNullability(rows: readonly (readonly [string, string, string | null, number | null, number | null])[]): RankFieldNullability & {
  readonly totalRows: number;
  readonly nullCounts: { readonly rateMils: number; readonly weight: number };
  readonly nullSiByField: { readonly rateMils: ReadonlySet<string>; readonly weight: ReadonlySet<string> };
};

export interface PredicateNodeLike {
  readonly op: string;
  readonly args: unknown;
}

export declare function normalizeNode(node: unknown): PredicateNodeLike | null;
export declare function walkTree(node: unknown, visit: (opName: string, args: unknown, rawNode: unknown) => void): void;
