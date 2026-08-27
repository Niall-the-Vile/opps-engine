/**
 * src/routing.ts — U7. The shared routing resolver (spec §2.3).
 *
 * Phase 1 (classify) routes SI `A` and `Y` lines away from APC pricing.
 * Phase 2 (adjudicate) also produces routing outcomes, because IOCE
 * converts an unpackaged Q4 line to SI `A` (§9.3), and that conversion
 * needs the same resolution logic. Rather than each phase re-implementing
 * (or re-entering) the other, both call this one function with a code and
 * an *effective* SI — original or post-conversion — and get back
 * `{schedule, rateMils, basis}`.
 *
 * This is a **leaf module**: it imports only `src/data/*` and
 * `src/types.js`. It does not import `phases/` or `trace.ts` — classify
 * and adjudicate both import *it*, never the other way around.
 */

import type { Basis } from './types.js';
import { lookupOpps, lookupClfs, isDmepos, isAfs, isMpfs } from './data/index.js';

/** The fee-schedule bucket a code routes to, per §3.4. `null` degrades honestly (§10.4). */
export type Schedule = 'OPPS' | 'CLFS' | 'DMEPOS' | 'AFS' | 'MPFS' | null;

export interface RouteResult {
  schedule: Schedule;
  rateMils: number | null;
  basis: Basis;
}

/**
 * SIs that pay their own APC directly under OPPS — every §3.5 SI except
 * the routed pair (`A`, `Y`) and the phase-1-rejected five (`B`, `C`,
 * `E1`, `E2`, `M`). 21 of the 28 SIs verified in §3.5.
 */
const ROUTED_OR_REJECTED_SIS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'E1', 'E2', 'M', 'Y']);

function paysOwnApc(si: string): boolean {
  return !ROUTED_OR_REJECTED_SIS.has(si);
}

/**
 * Resolve a code's fee schedule. Precedence, first match wins (spec §3.4):
 *
 * 1. Has an OPPS payment rate **and** `effectiveSI` pays its own APC ->
 *    `OPPS`. This is a standing guard, not merely a phase-1/A-or-Y
 *    special case: whatever `effectiveSI` a caller passes, a code that
 *    already pays its own APC under that SI is never rerouted to
 *    CLFS/DMEPOS/AFS/MPFS. Without this check first, 10 OPPS-rated SI Q1
 *    codes that also carry a CLFS record would mislabel `CLFS` (§3.4).
 * 2. In CLFS -> `CLFS` (bare, unmodified row — routing carries no
 *    modifier dimension; QW-specific pricing is a CLFS-lookup concern,
 *    not a routing one).
 * 3. In DMEPOS -> `DMEPOS`, never priced here (§3.2 Tier 2).
 * 4. In AFS -> `AFS`, never priced here. Always empty in milestone 1 —
 *    the Ambulance AFS source is an unsourced `.xlsx` (see
 *    `src/data/afs.cy2026.ts`).
 * 5. In MPFS with a non-zero total RVU -> `MPFS`, never priced here.
 * 6. No match -> `null` schedule, degrading per §10.4.
 */
export function resolve(code: string, effectiveSI: string): RouteResult {
  const oppsRecord = lookupOpps(code);
  if (oppsRecord !== undefined && oppsRecord.rateMils !== null && paysOwnApc(effectiveSI)) {
    return { schedule: 'OPPS', rateMils: oppsRecord.rateMils, basis: 'OPPS_APC' };
  }

  const clfsRecord = lookupClfs(code, '');
  if (clfsRecord !== undefined) {
    return { schedule: 'CLFS', rateMils: clfsRecord.rateMils, basis: 'CLFS' };
  }

  if (isDmepos(code)) {
    return { schedule: 'DMEPOS', rateMils: null, basis: 'ROUTED_DMEPOS' };
  }

  if (isAfs(code)) {
    return { schedule: 'AFS', rateMils: null, basis: 'ROUTED_AFS' };
  }

  if (isMpfs(code)) {
    return { schedule: 'MPFS', rateMils: null, basis: 'ROUTED_MPFS' };
  }

  return { schedule: null, rateMils: null, basis: 'ROUTED_UNKNOWN' };
}
