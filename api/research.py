"""
Vercel serverless function — batch config optimization research.

POST /api/research
Body: {partial_config?, iterations (default 50), seed?}
Returns: {best_config, best_result, best_score, progress, total, status}

Note: Vercel free tier has 10s timeout. ~50 iterations is safe.
For larger runs, upgrade to Hobby (15s) or Pro (60s).
"""

import json
import os
import random
import sys
import time
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autoresearch"))

from simulator import run_from_config, DEFAULT_PRICING

VALID = {
    "location": ["urban", "suburban", "mall", "office", "university"],
    "menu": ["gourmet", "everyday", "sweet", "speed"],
    "equipment": ["automated", "manual", "specialized"],
    "contract": ["spot", "monthly", "coop", "direct"],
    "capital": ["all-equity", "balanced", "leveraged", "max-debt"],
}

MAX_ITERATIONS = 100  # safety cap for serverless timeout


def _random_config(partial, rng):
    cfg = {}
    for key, options in VALID.items():
        if key in partial and partial[key] in options:
            cfg[key] = partial[key]
        else:
            cfg[key] = rng.choice(options)
    return cfg


def _random_pricing(rng):
    return {
        "drip": round(rng.uniform(2.0, 6.0), 2),
        "espresso": round(rng.uniform(3.0, 7.0), 2),
        "specialty": round(rng.uniform(4.0, 9.0), 2),
        "food": round(rng.uniform(2.0, 6.0), 2),
    }


def _random_staff(rng):
    count = rng.randint(1, 3)
    return [{"role": "barista", "skill": rng.randint(1, 5)} for _ in range(count)]


def run_research(partial, iterations, base_seed):
    rng = random.Random(base_seed)
    iterations = min(iterations, MAX_ITERATIONS)
    best_score = float("-inf")
    best_config = None
    best_result = None

    for i in range(iterations):
        seed = base_seed + i
        cfg = _random_config(partial, rng)

        cfg["manager"] = partial.get("manager", {
            "role": "manager", "skill": rng.randint(5, 8)
        })
        cfg["personnel_budget"] = partial.get("personnel_budget", rng.choice([8000, 10000, 12000, 15000]))
        cfg["pricing"] = _random_pricing(rng)
        cfg["staff"] = _random_staff(rng)
        cfg["seed"] = seed

        result = run_from_config(cfg)
        score = result["results"]["score"]

        if score > best_score:
            best_score = score
            best_config = cfg
            best_result = result["results"]

    return {
        "best_config": best_config,
        "best_result": best_result,
        "best_score": best_score,
        "progress": iterations,
        "total": iterations,
        "status": "complete",
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(content_length))

        partial = body.get("partial_config", {})
        iterations = body.get("iterations", 50)
        seed = body.get("seed", int(time.time()))

        try:
            result = run_research(partial, iterations, seed)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e), "status": "error"}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        pass
