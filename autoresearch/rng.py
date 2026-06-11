"""
Seeded RNG — MINSTD (Lehmer) LCG for deterministic random number generation.
Produces IDENTICAL sequences to rng.ts for cross-language reproducibility.

Algorithm: s = (48271 * s) mod (2^31 - 1)
Output: s / (2^31 - 1)  →  uniform in (0, 1)
"""

import math


class SeededRNG:
    A = 48271
    M = 2147483647  # 2^31 - 1

    def __init__(self, seed: int = 42):
        # Map any integer to [1, M-1] (0 is forbidden for MINSTD)
        self.seed = abs(seed) % (self.M - 1) + 1

    def next(self) -> float:
        """Uniform random in (0, 1)."""
        self.seed = (self.A * self.seed) % self.M
        return self.seed / self.M

    def next_int(self, max_val: int) -> int:
        """Integer in [0, max_val)."""
        return int(self.next() * max_val)

    def next_gaussian(self, mu: float = 0.0, sigma: float = 1.0) -> float:
        """Box-Muller transform for Gaussian distribution."""
        u1 = max(self.next(), 1e-10)
        u2 = self.next()
        z0 = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
        return z0 * sigma + mu

    def paretovariate(self, alpha: float = 2.5) -> float:
        """Pareto via inverse CDF: F^(-1)(u) = u^(-1/α)."""
        u = self.next()
        return u ** (-1.0 / alpha)

    def choice(self, items: list):
        """Random choice from list."""
        return items[self.next_int(len(items))]

    def random(self) -> float:
        """Alias for next() — matches Python's random.random()."""
        return self.next()
