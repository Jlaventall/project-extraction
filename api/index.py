"""Vercel entrypoint for the CoffeeSim FastAPI application."""

import sys
from pathlib import Path

# Vercel executes this file from the repository root without installing the
# ``src`` package as an editable distribution.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from coffeesim.api.app import app

__all__ = ["app"]
