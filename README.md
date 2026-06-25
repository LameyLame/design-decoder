# Decode

Turn any design reference into a reusable AI prompt.

Upload a landing page, poster, brand, or UI screen — Decode reads its visual style
and returns:

1. **Style summary** — the overall mood and aesthetic
2. **Design keywords** — copyable tag-style descriptors
3. **Key elements** — color palette (as copyable hex swatches), typography, layout,
   spacing, and standout details
4. **Ready-to-use prompt** — a polished, copy-paste prompt for any AI image/design tool

Built with the Python standard library only (no pip installs) and a vanilla
HTML/CSS/JS frontend. It calls the Google Gemini vision API directly, using a
forced JSON `responseSchema` for reliable structured output.

## Run it

```bash
cd design-decoder
python3 server.py
```

Then open **http://127.0.0.1:5050**.

You need a Gemini API key (get one free at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Two ways to
provide it:

- **In a `.env` file** — copy the example and add your key, then start:
  ```bash
  cp .env.example .env   # then edit .env and paste your key
  ```
- **In the UI** — click **API key** in the top-right and paste one. It's stored only
  in your browser, sent per request, and overrides the server key.

Pick the vision model from the **Model** dropdown in the top bar (Gemini 2.5 Flash ·
2.5 Pro · 3 Pro · 2.0 Flash). Drop, browse, or **paste from clipboard** (or ⌘/Ctrl+V)
to load a design.

### Config

| Env var          | Default            | Purpose                                       |
|------------------|--------------------|-----------------------------------------------|
| `GEMINI_API_KEY` | —                  | API key (or `GOOGLE_API_KEY`). UI key wins.   |
| `DECODE_MODEL`   | `gemini-2.5-flash` | Default model if the UI doesn't send one.     |
| `PORT`           | `5050`             | Local port.                                   |

## How it works

- `server.py` serves the static frontend and exposes `POST /api/analyze`.
- The frontend reads the image as base64 and posts it to that endpoint.
- The server forwards the image to the Gemini API (`generateContent`) with a system
  prompt and a forced JSON `responseSchema`, then returns the validated result.
- No image or key ever leaves your machine except the call to the Gemini API.

## Publishing to GitHub

This repo is ready to push as-is. **`.env` is gitignored — your API key is never
committed.** Anyone who clones it provides their own key via `.env` or the UI.

```bash
git init && git add . && git commit -m "Initial commit"
gh repo create design-decoder --public --source=. --push   # or add a remote manually
```

## Deploy to Vercel

The same code runs on Vercel — the `public/` folder is served statically and the
backend runs as Python serverless functions in `api/` (`api/analyze.py`,
`api/health.py`). `vercel.json` wires the routes and timeouts.

1. Push this repo to GitHub and import it in Vercel (or run `vercel`).
2. In **Project → Settings → Environment Variables**, add `GEMINI_API_KEY` (the
   `.env` file is **not** deployed). Redeploy after adding it.
3. That's it — open the deployment URL.

> ⚠️ **Cost note:** if you set `GEMINI_API_KEY` on a *public* URL, anyone who visits
> can run analyses on your key/quota. Either leave the server key unset and let each
> visitor paste their own key (via the **API key** button in the UI), or put the
> deployment behind Vercel access protection.

## License

MIT — see [LICENSE](LICENSE).
