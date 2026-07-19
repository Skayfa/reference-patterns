// Build-time layout for the hero constellation. Pure and dependency-free so
// it can be exercised with synthetic corpora (see the scale notes below) —
// every visual constant derives from n, so growth never overflows the box.

export interface ConstellationInput {
  tags: string[];
}

export interface ConstellationNode {
  x: number;
  y: number;
  r: number;
  haloR: number;
  hitR: number;
  degree: number;
  flip: boolean;
  depth: number;
  wiredTags: string[];
}

export interface ConstellationEdge {
  a: number;
  b: number;
  shared: string[];
  d: string;
  width: number;
}

export interface ConstellationLayout {
  size: number;
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
  dust: { x: number; y: number; r: number; o: number }[];
  /** Per-frame drift/parallax is only worth its cost on a sparse sky. */
  animate: boolean;
  /** Per-edge gradients double the defs; past this density a single hue reads better anyway. */
  gradients: boolean;
}

export const SIZE = 360;
const PAD = 34;
const GOLDEN_ANGLE = 2.39996;

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function layoutConstellation(patterns: ConstellationInput[]): ConstellationLayout {
  const rand = mulberry32(2026);
  const n = patterns.length;
  const center = SIZE / 2;
  // Characteristic spacing at this population — the root every size derives from.
  const spacing = (SIZE - PAD * 2) / Math.max(Math.sqrt(n), 1);

  // Candidate edges: every shared-tag pair. Common tags form cliques, so each
  // node only KEEPS its strongest few — the cap tightens as the sky fills
  // (generous enough at small n to keep every edge).
  type Cand = { a: number; b: number; shared: string[]; weight: number };
  const candidates: Cand[] = [];
  const tagSets = patterns.map((p) => new Set(p.tags));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const shared = patterns[a].tags.filter((t) => tagSets[b].has(t));
      if (shared.length) candidates.push({ a, b, shared, weight: 1 + 0.5 * (shared.length - 1) });
    }
  }
  const KEEP = Math.max(2, Math.min(8, Math.round(160 / Math.max(Math.sqrt(n), 1))));
  const ranked = new Map<number, Cand[]>();
  for (const c of candidates) {
    (ranked.get(c.a) ?? ranked.set(c.a, []).get(c.a)!).push(c);
    (ranked.get(c.b) ?? ranked.set(c.b, []).get(c.b)!).push(c);
  }
  const kept = new Set<Cand>();
  for (const list of ranked.values()) {
    list.sort((x, y) => y.weight - x.weight || x.a - y.a || x.b - y.b);
    for (const c of list.slice(0, KEEP)) kept.add(c);
  }
  type Edge = { a: number; b: number; shared: string[]; weight: number };
  const edges: Edge[] = [...kept].sort((x, y) => x.a - y.a || x.b - y.b);

  const hasShared = new Array(n).fill(false);
  for (const e of edges) {
    hasShared[e.a] = true;
    hasShared[e.b] = true;
  }
  for (let a = 1; a < n; a++) {
    if (!hasShared[a]) edges.push({ a: a - 1, b: a, shared: [], weight: 0.3 });
  }

  const degree = new Array(n).fill(0);
  for (const e of edges) {
    if (e.shared.length) {
      degree[e.a]++;
      degree[e.b]++;
    }
  }

  // Fruchterman–Reingold from a seeded golden-angle start. Iterations taper
  // with n² so a big corpus doesn't stall the build (quality matters less
  // once the sky is dense).
  const pos = patterns.map((_, i) => {
    const r = 26 * Math.sqrt(i + 0.5);
    return {
      x: center + r * Math.cos(i * GOLDEN_ANGLE) + (rand() - 0.5) * 8,
      y: center + r * Math.sin(i * GOLDEN_ANGLE) + (rand() - 0.5) * 8,
    };
  });
  const k = Math.sqrt((SIZE * SIZE) / Math.max(n, 1)) * 0.95;
  const ITER = Math.max(60, Math.min(300, Math.round(1.2e6 / Math.max(n * n, 1))));
  for (let it = 0; it < ITER; it++) {
    const temp = 0.1 * SIZE * (1 - it / ITER) + 0.5;
    const disp = pos.map(() => ({ x: 0, y: 0 }));

    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        let dx = pos[a].x - pos[b].x;
        let dy = pos[a].y - pos[b].y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = rand() - 0.5;
          dy = rand() - 0.5;
          d = Math.hypot(dx, dy);
        }
        const f = (k * k) / d;
        disp[a].x += (dx / d) * f;
        disp[a].y += (dy / d) * f;
        disp[b].x -= (dx / d) * f;
        disp[b].y -= (dy / d) * f;
      }
    }

    for (const e of edges) {
      const dx = pos[e.a].x - pos[e.b].x;
      const dy = pos[e.a].y - pos[e.b].y;
      const d = Math.max(Math.hypot(dx, dy), 0.01);
      const f = ((d * d) / k) * e.weight;
      disp[e.a].x -= (dx / d) * f;
      disp[e.a].y -= (dy / d) * f;
      disp[e.b].x += (dx / d) * f;
      disp[e.b].y += (dy / d) * f;
    }

    for (let i = 0; i < n; i++) {
      disp[i].x -= (pos[i].x - center) * 0.03;
      disp[i].y -= (pos[i].y - center) * 0.03;
      const d = Math.max(Math.hypot(disp[i].x, disp[i].y), 0.01);
      pos[i].x += (disp[i].x / d) * Math.min(d, temp);
      pos[i].y += (disp[i].y / d) * Math.min(d, temp);
    }
  }

  // De-overlap at the density's own scale, then fit into the padded box —
  // fit runs LAST, so the layout can never escape the viewBox.
  const minGap = Math.min(30, spacing * 0.9);
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const dx = pos[b].x - pos[a].x;
        const dy = pos[b].y - pos[a].y;
        const d = Math.max(Math.hypot(dx, dy), 0.01);
        if (d < minGap) {
          const push = (minGap - d) / 2;
          pos[a].x -= (dx / d) * push;
          pos[a].y -= (dy / d) * push;
          pos[b].x += (dx / d) * push;
          pos[b].y += (dy / d) * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(
    (SIZE - PAD * 2) / Math.max(maxX - minX, 1),
    (SIZE - PAD * 2) / Math.max(maxY - minY, 1),
    // never scale UP a small cluster into a sprawl
    1.5
  );
  for (const p of pos) {
    p.x = PAD + (p.x - minX) * scale + (SIZE - PAD * 2 - (maxX - minX) * scale) / 2;
    p.y = PAD + (p.y - minY) * scale + (SIZE - PAD * 2 - (maxY - minY) * scale) / 2;
  }

  // Node geometry shrinks with density; a 13-node sky keeps today's sizes.
  const rBase = Math.min(4.5, Math.max(1.4, spacing / 6));
  const rScale = rBase / 4.5;
  const wiredTagsOf = (i: number) => [
    ...new Set(edges.filter((e) => (e.a === i || e.b === i) && e.shared.length).flatMap((e) => e.shared)),
  ];
  const nodes: ConstellationNode[] = patterns.map((_, i) => {
    const r = rBase + Math.min(degree[i], 5) * 0.8 * rScale;
    return {
      x: pos[i].x,
      y: pos[i].y,
      r,
      haloR: r + Math.min(7, r * 1.6),
      hitR: Math.max(r + 4, Math.min(14, spacing / 2)),
      degree: degree[i],
      flip: pos[i].x > SIZE * 0.62,
      depth: 1 / (1 + degree[i] * 0.35),
      wiredTags: wiredTagsOf(i),
    };
  });

  const edgePaths: ConstellationEdge[] = edges.map((e, ei) => {
    const a = nodes[e.a];
    const b = nodes[e.b];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.max(Math.hypot(dx, dy), 0.01);
    const bow = (ei % 2 === 0 ? 1 : -1) * Math.min(len * 0.16, 16);
    return {
      a: e.a,
      b: e.b,
      shared: e.shared,
      d: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${(mx + (-dy / len) * bow).toFixed(1)} ${(my + (dx / len) * bow).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
      width: e.shared.length ? (1.1 + Math.min(e.shared.length, 3) * 0.45) * Math.max(rScale, 0.55) : 0.7,
    };
  });

  const dust = Array.from({ length: 46 }, () => {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * (SIZE / 2 - 8);
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
      r: 0.4 + rand() * 0.8,
      o: 0.05 + rand() * 0.14,
    };
  });

  return {
    size: SIZE,
    nodes,
    edges: edgePaths,
    dust,
    // The drift loop rewrites every node AND every edge per frame — both
    // populations must stay small for it to earn its cost.
    animate: n <= 120 && edgePaths.length <= 320,
    gradients: edgePaths.filter((e) => e.shared.length).length <= 400,
  };
}
