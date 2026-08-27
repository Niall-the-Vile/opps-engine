import { describe, expect, it } from 'vitest';
import { deepFreeze, isDeepFrozen } from '../src/dsl/freeze.js';

describe('deepFreeze — nested objects and arrays', () => {
  it('freezes every level of a nested object/array graph', () => {
    const input = {
      a: 1,
      nested: { b: [1, 2, { c: 3 }] },
      list: [{ d: 4 }, { e: [5, 6] }],
    };
    const frozen = deepFreeze(input);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(Object.isFrozen(frozen.nested.b)).toBe(true);
    expect(Object.isFrozen(frozen.nested.b[2])).toBe(true);
    expect(Object.isFrozen(frozen.list)).toBe(true);
    expect(Object.isFrozen(frozen.list[0])).toBe(true);
    expect(Object.isFrozen(frozen.list[1])).toBe(true);
    expect(isDeepFrozen(frozen)).toBe(true);
  });

  it('a write attempt throws in strict mode (ESM modules are strict by default)', () => {
    const frozen = deepFreeze({ nested: { value: 1 } });
    expect(() => {
      // @ts-expect-error — intentionally violating readonly to prove the runtime guarantee, not just the type one
      frozen.nested.value = 2;
    }).toThrow(TypeError);
    expect(frozen.nested.value).toBe(1);
  });

  it('does not mutate values that are already primitives', () => {
    const frozen = deepFreeze({ a: 'x', b: 1, c: true, d: null });
    expect(frozen).toEqual({ a: 'x', b: 1, c: true, d: null });
  });
});

describe('deepFreeze — Set/Map conversion (§12.3: Object.freeze is a no-op on their contents)', () => {
  it('converts a Set into a frozen array, and the conversion is actually frozen (not just the wrapper)', () => {
    const input = { tags: new Set(['a', 'b', 'c']) };
    const frozen = deepFreeze(input);

    expect(Array.isArray(frozen.tags)).toBe(true);
    expect(frozen.tags).toEqual(['a', 'b', 'c']);
    expect(Object.isFrozen(frozen.tags)).toBe(true);
    // The original Set, if someone still held a reference, is untouched —
    // deepFreeze builds a replacement rather than mutating the Set (Sets
    // have no meaningful "frozen" state; Object.freeze on a Set doesn't
    // block .add()/.delete(), which is exactly the §12.3 defect).
    const originalSet = input.tags;
    originalSet.add('d');
    expect(frozen.tags).toEqual(['a', 'b', 'c']);
  });

  it('converts a Map into a frozen array of frozen [key, value] tuples', () => {
    const input = { facts: new Map<string, number>([['x', 1], ['y', 2]]) };
    const frozen = deepFreeze(input);

    expect(Array.isArray(frozen.facts)).toBe(true);
    expect(frozen.facts).toEqual([
      ['x', 1],
      ['y', 2],
    ]);
    expect(Object.isFrozen(frozen.facts)).toBe(true);
    for (const tuple of frozen.facts) {
      expect(Object.isFrozen(tuple)).toBe(true);
    }
  });

  it('recurses into Map values, freezing nested structures too', () => {
    const input = { facts: new Map<string, { lineIds: string[] }>([['epoch0', { lineIds: ['1', '2'] }]]) };
    const frozen = deepFreeze(input);
    const [, value] = frozen.facts[0] as readonly [string, { readonly lineIds: readonly string[] }];
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.lineIds)).toBe(true);
  });
});

describe('deepFreeze — cyclic graphs terminate', () => {
  it('freezes a self-referential object without infinite recursion', () => {
    interface Cyclic {
      name: string;
      self?: Cyclic;
    }
    const node: Cyclic = { name: 'root' };
    node.self = node;

    const frozen = deepFreeze(node);
    expect(frozen.name).toBe('root');
    expect(frozen.self).toBe(frozen); // the back-edge resolves to the same frozen object
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it('freezes a two-node cycle (A -> B -> A) without infinite recursion', () => {
    interface Node {
      id: string;
      next?: Node;
    }
    const a: Node = { id: 'a' };
    const b: Node = { id: 'b' };
    a.next = b;
    b.next = a;

    const frozen = deepFreeze(a);
    expect(frozen.id).toBe('a');
    expect(frozen.next?.id).toBe('b');
    expect(frozen.next?.next).toBe(frozen);
    expect(Object.isFrozen(frozen)).toBe(true);
    if (frozen.next !== undefined) expect(Object.isFrozen(frozen.next)).toBe(true);
  });

  it('freezes a cyclic graph reached through an array', () => {
    interface ListNode {
      value: number;
      children: ListNode[];
    }
    const root: ListNode = { value: 1, children: [] };
    root.children.push(root);

    const frozen = deepFreeze(root);
    expect(frozen.children[0]).toBe(frozen);
    expect(Object.isFrozen(frozen.children)).toBe(true);
  });
});
