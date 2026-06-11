"""
Autoresearch server — lightweight HTTP API for CoffeeSim UI.

Endpoints:
  POST /api/research    {partial_config, iterations, seed?}  → {job_id, status_url}
  GET  /api/research/{job_id}                                → {status, best_config, results}
  GET  /api/results                                          → all historical results
  GET  /api/health                                           → server health
"""

import json
import os
import sys
import threading
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(__file__))
from simulator import run_from_config, DEFAULT_PRICING

# ─── Config ──────────────────────────────────────────────────────────

RESULTS_FILE = os.path.join(os.path.dirname(__file__), "results.tsv")
JOURNAL_DIR = os.path.join(os.path.dirname(__file__), "journals")
PORT = int(os.environ.get("RESEARCH_PORT", 8765))

os.makedirs(JOURNAL_DIR, exist_ok=True)

VALID = {
    "location": ["urban", "suburban", "mall", "office", "university"],
    "menu": ["gourmet", "everyday", "sweet", "speed"],
    "equipment": ["automated", "manual", "specialized"],
    "contract": ["spot", "monthly", "coop", "direct"],
    "capital": ["all-equity", "balanced", "leveraged", "max-debt"],
}

# ─── Job store ───────────────────────────────────────────────────────

jobs: dict = {}
lock = threading.Lock()

# ─── Researcher ──────────────────────────────────────────────────────

import random
from rng import SeededRNG


def _random_config(partial: dict, rng: random.Random) -> dict:
    cfg = {}
    for key, options in VALID.items():
        if key in partial and partial[key] in options:
            cfg[key] = partial[key]
        else:
            cfg[key] = rng.choice(options)
    return cfg


def _random_manager(rng: random.Random) -> dict:
    skill = rng.randint(5, 8)
    return {"role": "manager", "skill": skill}


def _random_pricing(rng: random.Random) -> dict:
    return {
        "drip": round(rng.uniform(2.0, 6.0), 2),
        "espresso": round(rng.uniform(3.0, 7.0), 2),
        "specialty": round(rng.uniform(4.0, 9.0), 2),
        "food": round(rng.uniform(2.0, 6.0), 2),
    }


def _random_staff(rng: random.Random) -> list:
    count = rng.randint(1, 3)
    return [{"role": "barista", "skill": rng.randint(1, 5)} for _ in range(count)]


def run_research(job_id: str, partial: dict, iterations: int, base_seed: int):
    rng = random.Random(base_seed)
    best_score = float("-inf")
    best_config = None
    best_result = None
    header_written = os.path.exists(RESULTS_FILE)

    try:
        for i in range(iterations):
            seed = base_seed + i
            cfg = _random_config(partial, rng)

            # Manager (required)
            if "manager" in partial:
                cfg["manager"] = partial["manager"]
            else:
                cfg["manager"] = _random_manager(rng)

            # Personnel budget
            if "personnel_budget" in partial:
                cfg["personnel_budget"] = partial["personnel_budget"]
            else:
                cfg["personnel_budget"] = rng.choice([8000, 10000, 12000, 15000])

            cfg["pricing"] = _random_pricing(rng)
            cfg["staff"] = _random_staff(rng)
            cfg["seed"] = seed

            result = run_from_config(cfg)
            score = result["results"]["score"]

            # Append to results.tsv
            with open(RESULTS_FILE, "a") as f:
                if not header_written:
                    f.write("iteration\tjob_id\tseed\tscore\tlocation\tmenu\tequipment\tcontract\tcapital\tmanager_skill\tbudget\tcash\tdebt\treputation\tdays\tgame_over\treason\n")
                    header_written = True
                f.write(
                    f"{i}\t{job_id}\t{seed}\t{score:.2f}\t"
                    f"{cfg['location']}\t{cfg['menu']}\t{cfg['equipment']}\t"
                    f"{cfg['contract']}\t{cfg['capital']}\t"
                    f"{cfg['manager']['skill']}\t{cfg['personnel_budget']}\t"
                    f"{result['results']['final_cash']:.2f}\t"
                    f"{result['results']['final_debt']:.2f}\t"
                    f"{result['results']['final_reputation']:.2f}\t"
                    f"{result['results']['days_survived']}\t"
                    f"{result['results']['game_over']}\t"
                    f"{result['results']['game_over_reason']}\n"
                )

            if score > best_score:
                best_score = score
                best_config = cfg
                best_result = result["results"]

            with lock:
                jobs[job_id] = {
                    "status": "running",
                    "progress": i + 1,
                    "total": iterations,
                    "best_score": best_score,
                    "best_config": best_config,
                    "best_result": best_result,
                    "completed_iterations": i + 1,
                }

        with lock:
            jobs[job_id]["status"] = "complete"

    except Exception as e:
        with lock:
            jobs[job_id] = {
                "status": "error",
                "error": str(e),
                "best_score": best_score if best_config else None,
                "best_config": best_config,
            }


# ─── HTTP Handler ────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[research] {args[0]}", flush=True)

    def _json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/results":
            rows = []
            if os.path.exists(RESULTS_FILE):
                with open(RESULTS_FILE) as f:
                    lines = f.readlines()
                    if len(lines) > 1:
                        headers = lines[0].strip().split("\t")
                        for line in lines[1:]:
                            vals = line.strip().split("\t")
                            rows.append(dict(zip(headers, vals)))
            self._json({"results": rows, "count": len(rows)})
        elif path.startswith("/api/research/"):
            job_id = path.split("/api/research/")[1]
            with lock:
                job = jobs.get(job_id)
            if not job:
                self._json({"error": "job not found"}, 404)
            else:
                self._json(job)
        elif path == "/api/health":
            self._json({"status": "ok", "jobs": len(jobs)})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/research":
            body = self._read_body()
            partial = body.get("partial_config", {})
            iterations = body.get("iterations", 100)
            seed = body.get("seed", int(time.time()))

            job_id = str(uuid.uuid4())[:8]
            with lock:
                jobs[job_id] = {
                    "status": "starting", "progress": 0,
                    "total": iterations, "job_id": job_id,
                }

            t = threading.Thread(
                target=run_research,
                args=(job_id, partial, iterations, seed),
                daemon=True,
            )
            t.start()
            self._json({"job_id": job_id, "status_url": f"/api/research/{job_id}", "iterations": iterations})
        elif path == "/api/journal/save":
            body = self._read_body()
            game_id = body.get("gameId", "")
            entry = body.get("entry", {})
            if not game_id:
                self._json({"error": "missing gameId"}, 400)
                return
            # Save to file: journals/{gameId}_week{N}.json
            week_num = entry.get("week", 0)
            fname = f"{game_id}_week{week_num:02d}.json"
            fpath = os.path.join(JOURNAL_DIR, fname)
            with open(fpath, "w") as f:
                json.dump(entry, f, indent=2)
            self._json({"ok": True, "path": fpath})
        elif path == "/api/journal/list":
            # Return list of saved games with summary
            games = {}
            if os.path.exists(JOURNAL_DIR):
                for fname in sorted(os.listdir(JOURNAL_DIR)):
                    if fname.endswith(".json"):
                        game_id = fname.rsplit("_week", 1)[0]
                        if game_id not in games:
                            games[game_id] = {"gameId": game_id, "weeks": 0, "latest": None, "summary": {}}
                        fpath = os.path.join(JOURNAL_DIR, fname)
                        with open(fpath) as f:
                            data = json.load(f)
                        games[game_id]["weeks"] += 1
                        if games[game_id]["latest"] is None or data["week"] > games[game_id]["latest"]:
                            games[game_id]["latest"] = data["week"]
                            games[game_id]["summary"] = {
                                "location": data.get("location", "?"),
                                "capital": data.get("capital", "?"),
                                "totalRevenue": data.get("totalRevenue", 0),
                                "endCash": data.get("endCash", 0),
                                "timestamp": data.get("timestamp", ""),
                            }
            self._json({"games": list(games.values())})
        else:
            self._json({"error": "not found"}, 404)


def main():
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[research] Server running on port {PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[research] Shutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
