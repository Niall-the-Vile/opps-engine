/**
 * U11 — deep freeze, not `Object.freeze` (spec §12.3).
 *
 * `Object.freeze` is shallow and a no-op on `Set`/`Map` *contents* — freezing
 * a `Map` still lets you `.set()`/`.delete()` on it, because those are
 * methods on the object, not assignments to it, and `Object.freeze` only
 * blocks the latter. §12.3: "rev 3's mechanical guarantee did not exist."
 * `deepFreeze` recurses through the whole graph and, wherever it finds a
 * `Set` or `Map`, replaces it with a frozen plain structure (an array) that
 * has no mutator methods to bypass the freeze in the first place — the
 * "convert to frozen plain structures" language in §12.3 is doing real work,
 * not just "freeze it too."
 *
 * **Freeze determinations, `claimAmounts`, and the epoch fact sets. Never
 * freeze the trace journal** — it is append-only and lives outside the
 * frozen payload (§2.2). That is a caller discipline: this file only
 * provides the freezing primitive; it has no opinion on what a caller
 * passes it, since the trace journal type doesn't exist yet (`trace.ts`,
 * a later unit).
 *
 * `structuredClone` of a frozen graph returns an **unfrozen** clone — the
 * guarantee here is in-process only and stops at the process boundary
 * (§12.9). A value handed across that boundary (e.g. to a worker, or
 * serialized for IPC) must not be trusted as still-frozen on the other side.
 */

// ---------------------------------------------------------------------------
// The conditional mapped type describing what `deepFreeze<T>` returns.
// Map<K,V> becomes a frozen array of frozen [K,V] tuples (not a frozen
// plain object keyed by K) so it stays correct for any key type, not just
// strings — the fact collections this exists for are not guaranteed to be
// string-keyed.
// ---------------------------------------------------------------------------

export type DeepFrozen<T> = T extends ReadonlyMap<infer K, infer V>
  ? readonly (readonly [DeepFrozen<K>, DeepFrozen<V>])[]
  : T extends ReadonlySet<infer V>
    ? readonly DeepFrozen<V>[]
    : T extends readonly (infer E)[]
      ? readonly DeepFrozen<E>[]
      : // Functions pass through unrecursed and unfrozen (see deepFreezeInner).
        T extends (...args: never[]) => unknown
        ? T
        : T extends object
          ? { readonly [K in keyof T]: DeepFrozen<T[K]> }
          : T;

/**
 * Recurses through `value`, freezing every plain object and array in place
 * (structurally — a *new* frozen container, since `Map`/`Set` conversion
 * can't happen in place) and converting every `Map`/`Set` it finds into a
 * frozen array. `seen` maps an already-visited source object to the frozen
 * (or in-progress) replacement already built for it, which is what makes a
 * cyclic graph terminate: a back-edge finds its ancestor's placeholder
 * already in the map instead of recursing forever.
 */
function deepFreezeInner(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') {
    // Primitives (and functions, which are `typeof 'function'`, not
    // `'object'`) pass through unchanged — nothing to freeze or convert.
    return value;
  }

  const already = seen.get(value);
  if (already !== undefined) return already;

  if (value instanceof Map) {
    const target: (readonly [unknown, unknown])[] = [];
    seen.set(value, target);
    for (const [k, v] of value.entries()) {
      const tuple = Object.freeze([deepFreezeInner(k, seen), deepFreezeInner(v, seen)] as const);
      target.push(tuple);
    }
    return Object.freeze(target);
  }

  if (value instanceof Set) {
    const target: unknown[] = [];
    seen.set(value, target);
    for (const v of value.values()) {
      target.push(deepFreezeInner(v, seen));
    }
    return Object.freeze(target);
  }

  if (Array.isArray(value)) {
    const target: unknown[] = [];
    seen.set(value, target);
    for (const item of value) {
      target.push(deepFreezeInner(item, seen));
    }
    return Object.freeze(target);
  }

  // A plain object (or a class instance, treated structurally — the engine
  // only ever hands this data-shaped facts and determinations, never
  // behavior-bearing instances).
  const target: Record<string, unknown> = {};
  seen.set(value, target);
  for (const key of Object.keys(value)) {
    target[key] = deepFreezeInner(Reflect.get(value, key), seen);
  }
  return Object.freeze(target);
}

/**
 * Deep-freezes `value` and returns the (possibly restructured — see
 * `DeepFrozen`) result. The single type assertion below is the one place
 * this file steps outside what the checker can verify on its own: the
 * runtime logic above is what actually proves the shape, the assertion just
 * tells the checker what the recursive `unknown`-typed walk already
 * guarantees. No `any`, no `!`, no `@ts-ignore` — this is the narrowest
 * substitute available for a genuinely generic recursive transform.
 */
export function deepFreeze<T>(value: T): DeepFrozen<T> {
  const result = deepFreezeInner(value, new WeakMap<object, unknown>());
  return result as DeepFrozen<T>;
}

/**
 * Recursively checks that every object/array reachable from `value` is
 * frozen. Test/assertion helper — not used by `deepFreeze` itself. Also
 * terminates on cycles via `seen`.
 */
export function isDeepFrozen(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  if (Array.isArray(value)) {
    return value.every((item) => isDeepFrozen(item, seen));
  }
  return Object.keys(value).every((key) => isDeepFrozen(Reflect.get(value, key), seen));
}
