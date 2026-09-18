# Legacy reference runs

The previous TypeScript/Zustand and `autoresearch/simulator.py` models are
preserved at `/home/nan/projects/coffeesim`. They are behavioral references,
not parity targets: the reboot intentionally replaces instant replenishment,
whole-SKU expiry, direct green-bean consumption, and duplicate accounting with
lot-level SimPy processes.

Before removing that legacy checkout, retain its Git commits:

- `f23657c` — initial 360-day game engine
- `3cba286` — Vercel restructuring
- `d8434b1` — cleanup

New regression tests assert physical and accounting invariants, deterministic
replay, lead-time behavior, and the Gymnasium API contract.

