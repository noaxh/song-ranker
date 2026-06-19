// Pure queue/order transforms for the player. No DOM, no state — unit-tested in
// tests/queue.test.mjs. INVARIANT: `order` is a permutation of distinct `queue`
// indices; both operations below preserve it.

// Remove the queue entry referenced by order-position `oi`. Drops it from BOTH
// arrays and renumbers every order index above the removed queue index — so a later
// buildOrder (which reseeds `order` from `queue.map((_,i)=>i)`) can never resurrect it.
export function removeFromQueue(queue, order, oi) {
  const qi = order[oi];
  return {
    qi,
    queue: queue.filter((_, i) => i !== qi),
    order: order.filter((_, i) => i !== oi).map(x => (x > qi ? x - 1 : x)),
  };
}

// Move the order entry at `fromOi` to land before `toOi` (drop-before semantics).
// Pure permutation of `order`. fromOi===toOi (or toOi===fromOi+1) resolve to no-ops.
export function reorderIndices(order, fromOi, toOi) {
  const moved = order[fromOi];
  const rest = order.filter((_, i) => i !== fromOi);
  let idx = toOi > fromOi ? toOi - 1 : toOi;   // removal shifts indices above fromOi down one
  idx = Math.max(0, Math.min(idx, rest.length));
  return [...rest.slice(0, idx), moved, ...rest.slice(idx)];
}
