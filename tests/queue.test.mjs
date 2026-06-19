// queue.test.mjs — unit tests for the pure player queue transforms.
// Run: node tests/queue.test.mjs
import { removeFromQueue, reorderIndices } from '../js/queue-order.js';

let passed = 0, failed = 0;
const ok = (c, m) => c ? passed++ : (failed++, console.error('  ✗ ' + m));
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// order must stay a permutation of distinct, in-range queue indices.
function invariant(queue, order, msg) {
  ok(new Set(order).size === order.length, msg + ': order has no dup indices');
  ok(order.every(x => x >= 0 && x < queue.length), msg + ': all indices in range');
}

const Q = () => [{ u: 'a' }, { u: 'b' }, { u: 'c' }, { u: 'd' }];

// ── removeFromQueue ──────────────────────────────────────────────
{
  const { queue, order } = removeFromQueue(Q(), [0, 1, 2, 3], 1);   // remove 'b' from natural order
  eq(queue.map(x => x.u), ['a', 'c', 'd'], 'remove mid: queue drops b');
  eq(order, [0, 1, 2], 'remove mid: order renumbered');
  invariant(queue, order, 'remove mid');
}
{
  // shuffled play order [2,0,3,1]; remove oi=1 → qi=0 → track 'a'
  const { queue, order } = removeFromQueue(Q(), [2, 0, 3, 1], 1);
  eq(queue.map(x => x.u), ['b', 'c', 'd'], 'remove shuffled: queue drops a');
  eq(order, [1, 2, 0], 'remove shuffled: order renumbered');
  eq(order.map(i => queue[i].u), ['c', 'd', 'b'], 'remove shuffled: play order preserved');
  invariant(queue, order, 'remove shuffled');
}
{
  // RESURRECTION GUARD: after a remove, buildOrder reseeding from queue must not bring it back.
  const { queue } = removeFromQueue(Q(), [0, 1, 2, 3], 2);          // remove 'c'
  const rebuilt = queue.map((_, i) => i);                          // buildOrder's seed
  eq(rebuilt.map(i => queue[i].u), ['a', 'b', 'd'], 'resurrection guard: c gone after rebuild');
}

// ── reorderIndices (drop-before) ─────────────────────────────────
eq(reorderIndices([0, 1, 2, 3], 0, 2), [1, 0, 2, 3], 'move a before c');
eq(reorderIndices([0, 1, 2, 3], 3, 1), [0, 3, 1, 2], 'move d before b');
eq(reorderIndices([0, 1, 2, 3], 0, 4), [1, 2, 3, 0], 'move a to end');
eq(reorderIndices([0, 1, 2, 3], 1, 1), [0, 1, 2, 3], 'drop before self: no-op');
eq(reorderIndices([0, 1, 2, 3], 1, 2), [0, 1, 2, 3], 'drop just after self: no-op');

{
  // orderPos tracked by identity survives a reorder.
  const queue = Q();
  let order = [0, 1, 2, 3];
  const curItem = queue[order[2]];                 // current = 'c'
  order = reorderIndices(order, 0, 3);             // move 'a' before 'd'
  const orderPos = order.findIndex(i => queue[i] === curItem);
  eq(order, [1, 2, 0, 3], 'reorder shape');
  ok(queue[order[orderPos]] === curItem, 'reorder: orderPos still on c');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
