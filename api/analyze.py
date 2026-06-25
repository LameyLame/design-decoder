"""
Vercel serverless function — POST /api/analyze

Mirrors the logic in ../server.py (the local dev server) so the app works both
when run locally (python3 server.py) and when deployed to Vercel. Kept
self-contained on purpose: Vercel bundles each api/*.py file on its own, so we
avoid cross-file imports. If you change the prompt or schema here, mirror it in
server.py (and vice-versa).
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request
import urllib.error

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = os.environ.get("DECODE_MODEL", "gemini-2.5-flash")
MAX_UPLOAD_BYTES = 12 * 1024 * 1024

ALLOWED_MODELS = {
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-pro-preview",
    "gemini-2.0-flash",
}

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "style_summary": {"type": "string"},
        "keywords": {"type": "array", "items": {"type": "string"}},
        "key_elements": {
            "type": "object",
            "properties": {
                "color_palette": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "hex": {"type": "string"},
                            "name": {"type": "string"},
                            "role": {"type": "string"},
                        },
                        "required": ["hex", "name", "role"],
                        "propertyOrdering": ["hex", "name", "role"],
                    },
                },
                "typography": {"type": "string"},
                "layout": {"type": "string"},
                "spacing": {"type": "string"},
                "standout_details": {"type": "string"},
            },
            "required": ["color_palette", "typography", "layout", "spacing", "standout_details"],
            "propertyOrdering": ["color_palette", "typography", "layout", "spacing", "standout_details"],
        },
        "ready_prompt": {"type": "string"},
    },
    "required": ["style_summary", "keywords", "key_elements", "ready_prompt"],
    "propertyOrdering": ["style_summary", "keywords", "key_elements", "ready_prompt"],
}

SYSTEM_PROMPT = """You are a senior art director and brand designer with a sharp \
eye for visual language. You analyze a single design reference (a landing page, \
poster, branding, app screen, packaging — any visual design) and decode exactly \
what makes it work, then write a prompt that lets someone recreate that style with \
an AI image or design tool.

Be specific and confident, the way a great designer talks. Name real typographic \
styles (e.g. "grotesque sans", "transitional serif", "monospace"), real layout \
systems (e.g. "asymmetric editorial grid", "centered hero"), and concrete moods. \
Read the actual hex colors off the image as accurately as you can.

Return ONLY a single JSON object — no markdown fences, no commentary before or \
after — matching exactly this shape:

{
  "style_summary": "2-3 sentence description of the overall visual style and mood",
  "keywords": ["8-14 short tag-style keywords: colors, type style, layout, mood, era/aesthetic, textures"],
  "key_elements": {
    "color_palette": [
      {"hex": "#RRGGBB", "name": "short human name for this color", "role": "e.g. background / primary / accent / text"}
    ],
    "typography": "1-3 sentences on typeface style, weight, hierarchy, pairing",
    "layout": "1-3 sentences on composition, grid, focal points, balance",
    "spacing": "1-2 sentences on whitespace, density, rhythm",
    "standout_details": "1-3 sentences on the details that make it work (textures, motifs, shadows, iconography, etc.)"
  },
  "ready_prompt": "A detailed, polished, copy-paste prompt (120-220 words) someone can give to an AI image/design tool to recreate THIS style. Describe the aesthetic, palette (with hex), typography, layout, mood, and finishing details. Write it as direct instructions, not as a description of the original."
}

Include 4-6 colors in color_palette. Hex values must be valid 6-digit hex. Keywords \
must be lowercase unless they're proper nouns."""


def get_env_key():
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def call_gemini(image_b64, media_type, api_key, model):
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"inline_data": {"mime_type": media_type, "data": image_b64}},
                    {"text": "Decode this design reference."},
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.6,
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }
    req = urllib.request.Request(
        GEMINI_URL.format(model=model),
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=55) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    candidates = data.get("candidates") or []
    if not candidates:
        block = (data.get("promptFeedback") or {}).get("blockReason")
        raise ValueError(f"blocked: {block}" if block else "empty response")
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts)


def extract_json(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in model response")
    return json.loads(text[start : end + 1])


class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_UPLOAD_BYTES:
            return self._send(413, {"error": "Image too large or empty. Try an image under ~8MB."})

        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            image_b64 = body["image"]
            media_type = body.get("media_type", "image/png")
        except (ValueError, KeyError):
            return self._send(400, {"error": "Invalid request body."})

        api_key = (body.get("api_key") or "").strip() or get_env_key()
        if not api_key:
            return self._send(401, {
                "error": "No API key. Add one in the UI (the “API key” button, top "
                         "right), or set GEMINI_API_KEY in the Vercel project's "
                         "Environment Variables. Get a key at aistudio.google.com/apikey."
            })

        model = (body.get("model") or "").strip()
        if model not in ALLOWED_MODELS:
            model = DEFAULT_MODEL

        try:
            raw = call_gemini(image_b64, media_type, api_key, model)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")
            msg = "Upstream API error."
            try:
                msg = json.loads(detail).get("error", {}).get("message", msg)
            except ValueError:
                pass
            return self._send(502, {"error": f"Vision API: {msg}"})
        except urllib.error.URLError as e:
            return self._send(502, {"error": f"Could not reach the vision API: {e.reason}"})
        except ValueError as e:
            return self._send(502, {"error": f"Vision API returned no usable result ({e})."})

        try:
            result = extract_json(raw)
        except ValueError:
            return self._send(502, {"error": "The model returned an unexpected response. Try again."})

        return self._send(200, result)
