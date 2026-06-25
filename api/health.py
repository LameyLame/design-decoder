"""Vercel serverless function — GET /api/health (and /health via rewrite).

Lets the UI show whether the deployment already has a server-side key set."""

from http.server import BaseHTTPRequestHandler
import json
import os


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        has_key = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
        body = json.dumps({
            "ok": True,
            "model": os.environ.get("DECODE_MODEL", "gemini-2.5-flash"),
            "key": has_key,
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
