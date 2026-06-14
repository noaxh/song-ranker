// elo-sim.mjs — standalone Elo simulation for Song Ranker parameter verification.
// No app imports. Run: node tests/elo-sim.mjs

// ─── Seeded PRNG (mulberry32) ───────────────────────────────────────────────
function makePRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── Math helpers ───────────────────────────────────────────────────────────
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Letter-floor function (from utils.js tierOf base-letter boundaries)
function letterFloor(r) {
  if (r >= 950) return 950;
  if (r >= 800) return 800;
  if (r >= 650) return 650;
  if (r >= 500) return 500;
  if (r >= 350) return 350;
  return 1;
}

// ─── Variant definitions ────────────────────────────────────────────────────
// Each variant: { name, kFor, heightDamp?, hysteresis? }

function makeVariant(name, kTiers, opts = {}) {
  const { heightDamp = false, hysteresis = null, divisor = 500 } = opts;

  function kFor(duels) {
    const n = duels || 0;
    if (n < 5)  return kTiers[0];
    if (n < 15) return kTiers[1];
    if (n < 30) return kTiers[2];
    return kTiers[3];
  }

  function dampFactor(r) {
    if (!heightDamp) return 1.0;
    if (r >= 950) return 0.5;
    if (r >= 800) return 0.7;
    if (r >= 650) return 0.9;
    return 1.0;
  }

  function applyHysteresis(newL, rl, { RESIST, HOLD }) {
    const floor = letterFloor(rl);
    if (newL < floor) {
      const overshoot  = floor - newL;
      const resisted   = overshoot * RESIST;
      newL = resisted <= HOLD ? floor : Math.round(floor - resisted);
    }
    return clamp(newL, 1, 1000);
  }

  function duel(winner, loser) {
    const rw = winner.rating ?? 500;
    const rl = loser.rating ?? 500;
    const Kw = kFor(winner.duels) * dampFactor(rw);
    const Kl = kFor(loser.duels)  * dampFactor(rl);
    const expected = 1 / (1 + Math.pow(10, (rl - rw) / divisor));
    const gain = 1 - expected;
    let newW = clamp(rw + Math.max(1, Math.round(Kw * gain)), 1, 1000);
    let newL = clamp(rl - Math.max(1, Math.round(Kl * gain)), 1, 1000);

    if (hysteresis) {
      newL = applyHysteresis(newL, rl, hysteresis);
    }

    winner.rating = newW;
    winner.duels  = (winner.duels || 0) + 1;
    loser.rating  = newL;
    loser.duels   = (loser.duels || 0) + 1;

    return { dW: newW - rw, dL: newL - rl };
  }

  return { name, kFor, duel };
}

// ─── Song pool factory ───────────────────────────────────────────────────────
function makeSongs(N) {
  // True strengths evenly spread [50, 1000]
  const step = (1000 - 50) / (N - 1);
  return Array.from({ length: N }, (_, i) => ({
    id: i,
    trueStrength: Math.round(50 + i * step),
    rating: null,
    duels: 0,
  }));
}

// ─── Pairing logic (mirrors app's pickPair) ──────────────────────────────────
function pickPair(songs, rng) {
  const N = songs.length;
  let aIdx;
  if (rng() < 0.65) {
    // Low-duel first: top 25% of sorted-by-duels
    const sorted = [...songs].sort((x, y) => x.duels - y.duels);
    const k = Math.max(1, Math.ceil(N * 0.25));
    const pick = sorted[Math.floor(rng() * k)];
    aIdx = pick.id;
  } else {
    aIdx = songs[Math.floor(rng() * N)].id;
  }
  const a = songs[aIdx];
  const ra = a.rating ?? 500;
  // 12 closest by current rating
  const candidates = songs
    .filter(s => s.id !== a.id)
    .sort((x, y) => Math.abs((x.rating ?? 500) - ra) - Math.abs((y.rating ?? 500) - ra))
    .slice(0, 12);
  const b = candidates[Math.floor(rng() * candidates.length)];
  return [a, b];
}

// ─── Outcome model ───────────────────────────────────────────────────────────
const NOISE = 0.10;
function trueOutcome(a, b, rng) {
  const pA = 1 / (1 + Math.pow(10, (b.trueStrength - a.trueStrength) / 250));
  const trueWin = rng() < pA ? a : b;
  const trueLose = trueWin === a ? b : a;
  // 10% chance user error flip
  if (rng() < NOISE) return [trueLose, trueWin];
  return [trueWin, trueLose];
}

// ─── Spearman rank correlation ───────────────────────────────────────────────
function spearman(songs) {
  const n = songs.length;
  const byTrue   = [...songs].sort((a, b) => a.trueStrength - b.trueStrength);
  const byRating = [...songs].sort((a, b) => (a.rating ?? 500) - (b.rating ?? 500));
  const trueRank = {}, ratingRank = {};
  byTrue.forEach((s, i)   => trueRank[s.id]   = i);
  byRating.forEach((s, i) => ratingRank[s.id] = i);
  let dSq = 0;
  for (const s of songs) {
    const d = trueRank[s.id] - ratingRank[s.id];
    dSq += d * d;
  }
  return 1 - (6 * dSq) / (n * (n * n - 1));
}

// ─── Main simulation ─────────────────────────────────────────────────────────
const N = 40;
const M = 3000;
const SETTLE_FRAC = 0.30; // last 30% = settled window
const SETTLE_START = Math.floor(M * (1 - SETTLE_FRAC));

function runSimulation(variant, seed = 42) {
  const rng  = makePRNG(seed);
  const songs = makeSongs(N);

  // Tracking per-duel
  const ratingHistory = Array.from({ length: N }, () => []);  // [duelIdx] -> rating
  const settledDeltas = [];        // |Δrating| for loser each settled duel
  let   letterDropCount = 0;       // loser's base letter decreased
  let   settledDuelCount = 0;
  let   firstSpearman90 = null;

  // True top-5 ids (highest trueStrength)
  const trueTop5 = [...songs].sort((a, b) => b.trueStrength - a.trueStrength).slice(0, 5).map(s => s.id);
  const top5RatingsInSettled = {};
  trueTop5.forEach(id => top5RatingsInSettled[id] = []);

  for (let d = 0; d < M; d++) {
    const [winner, loser] = pickPair(songs, rng);
    const [w, l] = trueOutcome(winner, loser, rng);

    const rlBefore = l.rating ?? 500;
    const baseBefore = letterFloor(rlBefore);

    const { dL } = variant.duel(w, l);

    const rlAfter  = l.rating;
    const baseAfter = letterFloor(rlAfter);

    if (d >= SETTLE_START) {
      settledDeltas.push(Math.abs(dL));
      if (baseAfter < baseBefore) letterDropCount++;
      settledDuelCount++;
      trueTop5.forEach(id => {
        const s = songs.find(s => s.id === id);
        top5RatingsInSettled[id].push(s.rating ?? 500);
      });
    }

    // Record ratings for history
    songs.forEach(s => ratingHistory[s.id].push(s.rating ?? 500));

    // Convergence: first time Spearman >= 0.90
    if (firstSpearman90 === null && d > 100) {
      const sp = spearman(songs);
      if (sp >= 0.90) firstSpearman90 = d;
    }
  }

  const finalSpearman = spearman(songs);

  // Settled volatility: mean |Δrating per duel| on loser side
  const volatility = settledDeltas.reduce((a, b) => a + b, 0) / settledDeltas.length;

  // Letter-drop rate
  const letterDropRate = letterDropCount / settledDuelCount;

  // Top-5 stability: mean std-dev of settled ratings for true top 5
  let top5Instability = 0;
  trueTop5.forEach(id => {
    const vals = top5RatingsInSettled[id];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    top5Instability += Math.sqrt(variance);
  });
  top5Instability /= 5;

  // Convergence
  const convergence = firstSpearman90 ?? '>3000';

  return {
    name: variant.name,
    spearman: finalSpearman,
    volatility,
    letterDropRate,
    top5Instability,
    convergence,
    songs,
  };
}

// ─── Claim verification helpers ──────────────────────────────────────────────
function claimDivisorSpread(divisor, seed = 99) {
  const variant = makeVariant(`divisor-${divisor}`, [220, 120, 72, 40], { divisor });
  const { songs } = runSimulation(variant, seed);
  const settled = songs.filter(s => s.duels >= 5);
  const top1 = [...settled].sort((a, b) => b.trueStrength - a.trueStrength)[0];
  const ratings = settled.map(s => s.rating ?? 500).sort((a, b) => a - b);
  const median = ratings[Math.floor(ratings.length / 2)];
  return { divisor, top1Rating: top1.rating, median, spread: top1.rating - median };
}

function claimTopRatingSettled(seed = 42) {
  // Run current variant (A), look at settled window ratings of true #1 song
  const variant = makeVariant('claim-top', [220, 120, 72, 40]);
  const rng = makePRNG(seed);
  const songs = makeSongs(N);
  const trueTop = [...songs].sort((a, b) => b.trueStrength - a.trueStrength)[0];
  const topRatingsSettled = [];

  for (let d = 0; d < M; d++) {
    const [winner, loser] = pickPair(songs, rng);
    const [w, l] = trueOutcome(winner, loser, rng);
    variant.duel(w, l);
    if (d >= SETTLE_START) {
      topRatingsSettled.push(songs.find(s => s.id === trueTop.id).rating ?? 500);
    }
  }
  const sorted = [...topRatingsSettled].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { medianRatingTop1: median };
}

function claimVolatilityScalesWithK(seed = 77) {
  const results = [];
  for (const tailK of [20, 40, 80]) {
    const variant = makeVariant(`K-tail-${tailK}`, [220, 120, 72, tailK]);
    const { volatility } = runSimulation(variant, seed);
    results.push({ tailK, volatility });
  }
  return results;
}

// ─── Sweep for variant E ─────────────────────────────────────────────────────
function runSweep(baselineSpearman, seed = 42) {
  const RESISTS = [0.30, 0.45, 0.60];
  const HOLDS   = [0, 6, 12];
  const TAIL_KS = [16, 20, 24];

  let best = null;
  const rows = [];

  for (const RESIST of RESISTS) {
    for (const HOLD of HOLDS) {
      for (const tailK of TAIL_KS) {
        const variant = makeVariant(
          `E-R${RESIST}-H${HOLD}-K${tailK}`,
          [180, 90, 48, tailK],
          { heightDamp: true, hysteresis: { RESIST, HOLD } }
        );
        const result = runSimulation(variant, seed);
        const spearmanOk = result.spearman >= baselineSpearman * 0.97; // within 3%
        const score = result.letterDropRate + result.volatility / 50 + result.top5Instability / 50;
        rows.push({ RESIST, HOLD, tailK, ...result, spearmanOk, score });

        if (spearmanOk && (best === null || score < best.score)) {
          best = { RESIST, HOLD, tailK, ...result, score };
        }
      }
    }
  }
  return { best, rows };
}

// ─── Table renderer ──────────────────────────────────────────────────────────
function pad(str, n, right = false) {
  const s = String(str);
  return right ? s.padStart(n) : s.padEnd(n);
}

function fmtN(n, dec = 3) {
  return (typeof n === 'number') ? n.toFixed(dec) : String(n);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
console.log('\n=== Song Ranker Elo Simulation ===\n');
console.log(`N=${N} songs, M=${M} duels, NOISE=${NOISE}, SETTLE last ${SETTLE_FRAC*100}% of duels\n`);

// Build variants
const SEED = 42;

const variantA = makeVariant('A-current',   [220, 120, 72, 40]);
const variantC = makeVariant('C-low-K',     [180,  90, 48, 20]);
const variantD = makeVariant('D-C+damp',    [180,  90, 48, 20], { heightDamp: true });
const variantE = makeVariant('E-D+hyster',  [180,  90, 48, 20], {
  heightDamp: true,
  hysteresis: { RESIST: 0.45, HOLD: 6 }
});

const variants = [variantA, variantC, variantD, variantE];
const results  = variants.map(v => runSimulation(v, SEED));

// ─── Variants table ──────────────────────────────────────────────────────────
console.log('─'.repeat(90));
console.log(
  pad('Variant', 14),
  pad('Spearman', 10, true),
  pad('Volatility', 12, true),
  pad('LtrDrop%', 10, true),
  pad('Top5Instab', 12, true),
  pad('Conv(<0.90)', 12, true)
);
console.log('─'.repeat(90));

for (const r of results) {
  console.log(
    pad(r.name, 14),
    pad(fmtN(r.spearman, 4), 10, true),
    pad(fmtN(r.volatility, 2), 12, true),
    pad(fmtN(r.letterDropRate * 100, 1) + '%', 10, true),
    pad(fmtN(r.top5Instability, 2), 12, true),
    pad(r.convergence, 12, true)
  );
}
console.log('─'.repeat(90));

// Compare variants against A
const baseSpearman = results[0].spearman;
console.log('\nSpearman vs A-current (>-3% is acceptable):');
for (const r of results.slice(1)) {
  const delta = ((r.spearman - baseSpearman) / Math.abs(baseSpearman) * 100).toFixed(1);
  const ok = r.spearman >= baseSpearman * 0.97;
  console.log(`  ${pad(r.name, 14)} delta=${delta}% ${ok ? 'OK' : 'HURT >3% - REJECT'}`);
}

// ─── Sweep ───────────────────────────────────────────────────────────────────
console.log('\n─'.repeat(90) + '\n=== SWEEP: Variant E (RESIST × HOLD × tailK) ===\n');
const { best, rows } = runSweep(baseSpearman, SEED);

// Print a condensed sweep table
console.log(
  pad('RESIST', 8), pad('HOLD', 6), pad('tailK', 7),
  pad('Spearman', 10, true), pad('Volatil', 9, true), pad('LtrDrop%', 10, true),
  pad('Top5Ins', 9, true), pad('Score', 8, true), pad('SprOK', 6)
);
console.log('─'.repeat(80));

// Sort by score to surface best combos
rows.sort((a, b) => a.score - b.score);
for (const r of rows) {
  console.log(
    pad(r.RESIST, 8), pad(r.HOLD, 6), pad(r.tailK, 7),
    pad(fmtN(r.spearman, 4), 10, true), pad(fmtN(r.volatility, 2), 9, true),
    pad(fmtN(r.letterDropRate * 100, 1) + '%', 10, true),
    pad(fmtN(r.top5Instability, 2), 9, true),
    pad(fmtN(r.score, 4), 8, true),
    pad(r.spearmanOk ? 'YES' : 'NO', 6)
  );
}

console.log('\n--- SWEEP WINNER ---');
if (best) {
  console.log(`  Variant E best combo: RESIST=${best.RESIST}, HOLD=${best.HOLD}, tailK=${best.tailK}`);
  console.log(`  Spearman=${fmtN(best.spearman, 4)}, Volatility=${fmtN(best.volatility, 2)}, LtrDrop=${fmtN(best.letterDropRate*100,1)}%, Top5Instab=${fmtN(best.top5Instability,2)}`);
  console.log(`  Composite score (lower=better): ${fmtN(best.score, 4)}`);
  const vsDeltaSpearman = ((best.spearman - baseSpearman) / Math.abs(baseSpearman) * 100).toFixed(1);
  const vsDropBase = results[0].letterDropRate;
  const dropChange = (best.letterDropRate - vsDropBase) * 100;
  console.log(`  Spearman delta vs A: ${vsDeltaSpearman}%`);
  console.log(`  Letter-drop rate delta vs A: ${dropChange.toFixed(1)} pp (${dropChange < -2 ? 'meaningful reduction' : 'minimal — consider lower RESIST'})`);
} else {
  console.log('  No sweep combo preserved Spearman within 3% of A. All E combos hurt accuracy.');
}

// ─── Claim verification ───────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(90));
console.log('=== CLAIM VERIFICATION ===\n');

// Claim (i): divisor 500 yields wider equilibrium spread than 400
const s500 = claimDivisorSpread(500);
const s400 = claimDivisorSpread(400);
const claimI = s500.spread > s400.spread;
console.log(`(i) Divisor 500 spread wider than 400:`);
console.log(`    Divisor 500 => top1=${s500.top1Rating}, median=${s500.median}, spread=${s500.spread}`);
console.log(`    Divisor 400 => top1=${s400.top1Rating}, median=${s400.median}, spread=${s400.spread}`);
console.log(`    ${claimI ? 'PASS' : 'FAIL'} — 500 spread ${claimI ? '>' : '<='} 400 spread (${s500.spread} vs ${s400.spread})`);

// Claim (ii): top true-strength song settles with median rating >= 950
const { medianRatingTop1 } = claimTopRatingSettled();
const claimII = medianRatingTop1 >= 950;
console.log(`\n(ii) True #1 song settles at median rating >= 950 (S tier, not dragged down):`);
console.log(`     Median rating of true #1 in settled window: ${medianRatingTop1}`);
console.log(`     ${claimII ? 'PASS' : 'FAIL'} — median=${medianRatingTop1} (need >=950)`);

// Claim (iii): volatility scales with K
const kVol = claimVolatilityScalesWithK();
const claimIII = kVol[0].volatility < kVol[1].volatility && kVol[1].volatility < kVol[2].volatility;
console.log(`\n(iii) Settled volatility rises with tail K:`);
for (const { tailK, volatility } of kVol) {
  console.log(`      tailK=${tailK} => settled volatility=${fmtN(volatility, 2)}`);
}
console.log(`      ${claimIII ? 'PASS' : 'FAIL'} — volatility ${claimIII ? 'monotonically rises' : 'does NOT monotonically rise'} with K`);

// ─── Recommendation summary ───────────────────────────────────────────────────
console.log('\n' + '─'.repeat(90));
console.log('=== RECOMMENDATION ===\n');

const recVariant = best ? best : results[results.length - 1];
const eVsA_spearman = ((results[3].spearman - results[0].spearman) / Math.abs(results[0].spearman) * 100).toFixed(1);
const eVsA_drop = (results[3].letterDropRate - results[0].letterDropRate) * 100;

console.log('Variant A (current):');
console.log(`  kFor: <5=>220, <15=>120, <30=>72, else=>40`);
console.log(`  Spearman=${fmtN(results[0].spearman,4)}, Volatility=${fmtN(results[0].volatility,2)}, LtrDrop=${fmtN(results[0].letterDropRate*100,1)}%`);

console.log('\nVariant C (lower K):');
console.log(`  kFor: <5=>180, <15=>90, <30=>48, else=>20`);
console.log(`  Spearman delta vs A: ${((results[1].spearman - results[0].spearman) / Math.abs(results[0].spearman)*100).toFixed(1)}%`);

console.log('\nVariant D (C + height damp):');
console.log(`  Same kFor as C + multiply K by: r>=950=>0.5, r>=800=>0.7, r>=650=>0.9, else=>1.0`);
console.log(`  Spearman delta vs A: ${((results[2].spearman - results[0].spearman) / Math.abs(results[0].spearman)*100).toFixed(1)}%`);

console.log('\nVariant E (D + loser-only hysteresis):');
console.log(`  kFor: <5=>180, <15=>90, <30=>48, else=>20`);
console.log(`  Height damp: r>=950=>0.5, r>=800=>0.7, r>=650=>0.9, else=>1.0`);
console.log(`  Hysteresis (loser only, wins unresisted): RESIST=0.45, HOLD=6`);
console.log(`  Spearman delta vs A: ${eVsA_spearman}%`);
console.log(`  Letter-drop delta vs A: ${eVsA_drop.toFixed(1)} pp`);

if (best) {
  const sweepDelta = ((best.spearman - results[0].spearman) / Math.abs(results[0].spearman)*100).toFixed(1);
  const sweepDropDelta = (best.letterDropRate - results[0].letterDropRate)*100;
  console.log(`\nSweep winner for E: RESIST=${best.RESIST}, HOLD=${best.HOLD}, tailK=${best.tailK}`);
  console.log(`  Spearman delta vs A: ${sweepDelta}%`);
  console.log(`  Letter-drop delta vs A: ${sweepDropDelta.toFixed(1)} pp`);
  if (Math.abs(sweepDropDelta) < 2) {
    console.log(`  WARNING: hysteresis provides <2pp letter-drop reduction — marginal benefit`);
    console.log(`  Recommendation: consider RESIST=0.30 (lighter-touch) or skip hysteresis entirely`);
  }
}

console.log('\nDone.\n');
