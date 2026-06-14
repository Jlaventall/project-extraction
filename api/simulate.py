"""
Vercel serverless function — single simulation run.

POST /api/simulate
Body: {location, menu, equipment, contract, capital, pricing, manager, personnel_budget, staff?, seed}
Returns: {config, results, manager}
"""

import json
import os
import sys

# Add autoresearch to path so we can import the simulator
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "autoresearch"))

from simulator import run_from_config
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(content_length))

        try:
            result = run_from_config(body)
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
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress logs in serverless
