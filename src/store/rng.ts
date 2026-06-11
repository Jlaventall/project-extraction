/**
 * Seeded RNG — MINSTD (Lehmer) LCG for deterministic random number generation.
 * Produces IDENTICAL sequences to rng.py for cross-language reproducibility.
 *
 * Algorithm: s = (48271 * s) mod (2^31 - 1)
 * Output: s / (2^31 - 1)  →  uniform in (0, 1)
 */
export class SeededRNG {
  private static readonly A = 48271;
  private static readonly M = 2147483647; // 2^31 - 1
  private seed: number;

  constructor(seed: number = 42) {
    this.seed = Math.abs(seed) % (SeededRNG.M - 1) + 1; // [1, M-1]
  }

  next(): number {
    this.seed = (SeededRNG.A * this.seed) % SeededRNG.M;
    return this.seed / SeededRNG.M;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  nextGaussian(mu: number = 0, sigma: number = 1): number {
    const u1 = Math.max(this.next(), 1e-10);
    const u2 = this.next();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * sigma + mu;
  }

  nextPareto(alpha: number = 2.5): number {
    const u = this.next();
    return Math.pow(u, -1.0 / alpha);
  }

  choice<T>(items: T[]): T {
    return items[this.nextInt(items.length)];
  }
}
