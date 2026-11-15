/**
 * Seeded PRNG (mulberry32). `Math.random` cannot be seeded, and the concept requires that the
 * same DSL + seed always yields the same painting, so all randomness must flow through this.
 * Uses only 32-bit integer ops, so the sequence is identical on every JS engine and platform.
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derives an independent stream so adding an op does not shift the randomness of later layers. */
export function deriveSeed(seed: number, ...path: (string | number)[]): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (const ch of path.join("/")) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
