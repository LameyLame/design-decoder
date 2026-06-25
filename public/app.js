/* Decode — frontend logic
   Upload → analyze → render. No framework, no build step. */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    dropzone: $("dropzone"),
    fileInput: $("file-input"),
    empty: $("dropzone-empty"),
    preview: $("preview"),
    previewImg: $("preview-img"),
    previewName: $("preview-name"),
    changeBtn: $("change-btn"),
    analyzeBtn: $("analyze-btn"),

    resultsEmpty: $("results-empty"),
    resultsLoading: $("results-loading"),
    resultsError: $("results-error"),
    result: $("result"),
    loadingText: $("loading-text"),
    errorMsg: $("error-msg"),
    retryBtn: $("retry-btn"),
    newBtn: $("new-btn"),

    styleSummary: $("style-summary"),
    keywords: $("keywords"),
    palette: $("palette"),
    typography: $("typography"),
    layout: $("layout"),
    spacing: $("spacing"),
    standout: $("standout"),
    readyPrompt: $("ready-prompt"),
    copyPrompt: $("copy-prompt"),

    modelSelect: $("model-select"),
    keyBtn: $("key-btn"),
    keyBtnLabel: $("key-btn-label"),
    keyDot: $("key-dot"),
    keyPop: $("key-pop"),
    keyInput: $("key-input"),
    keySave: $("key-save"),
    keyClear: $("key-clear"),
    browseBtn: $("browse-btn"),
    pasteBtn: $("paste-btn"),

    toast: $("toast"),
  };

  const STORE = { key: "decode.apiKey", model: "decode.model" };

  const state = {
    base64: null,      // raw base64 (no data: prefix)
    mediaType: null,   // image/png etc.
    dataUrl: null,
    fileName: null,
  };

  const MAX_BYTES = 8 * 1024 * 1024;
  const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

  const LOADING_LINES = [
    "Reading the composition…",
    "Sampling the color palette…",
    "Identifying the typographic voice…",
    "Mapping the layout & grid…",
    "Writing your prompt…",
  ];

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    requestAnimationFrame(() => els.toast.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("show");
      setTimeout(() => (els.toast.hidden = true), 220);
    }, 1600);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback for non-secure contexts
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
    }
  }

  /* ---------- file handling ---------- */
  function handleFile(file) {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast("Please use a PNG, JPG, WEBP, or GIF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast("That image is over 8MB. Try a smaller one.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      state.dataUrl = dataUrl;
      state.base64 = String(dataUrl).split(",")[1];
      state.mediaType = file.type;
      state.fileName = file.name;
      showPreview();
    };
    reader.onerror = () => toast("Couldn't read that file.");
    reader.readAsDataURL(file);
  }

  function showPreview() {
    els.previewImg.src = state.dataUrl;
    els.previewName.textContent = state.fileName || "image";
    els.empty.hidden = true;
    els.preview.hidden = false;
    els.dropzone.classList.add("has-image");
    els.analyzeBtn.disabled = false;
  }

  function resetUpload() {
    state.base64 = state.mediaType = state.dataUrl = state.fileName = null;
    els.fileInput.value = "";
    els.empty.hidden = false;
    els.preview.hidden = true;
    els.previewImg.removeAttribute("src");
    els.dropzone.classList.remove("has-image");
    els.analyzeBtn.disabled = true;
  }

  /* ---------- view switching ---------- */
  function showView(which) {
    els.resultsEmpty.hidden = which !== "empty";
    els.resultsLoading.hidden = which !== "loading";
    els.resultsError.hidden = which !== "error";
    els.result.hidden = which !== "result";
  }

  let loadingTimer = null;
  function startLoadingCopy() {
    let i = 0;
    els.loadingText.textContent = LOADING_LINES[0];
    loadingTimer = setInterval(() => {
      i = (i + 1) % LOADING_LINES.length;
      els.loadingText.textContent = LOADING_LINES[i];
    }, 2200);
  }
  function stopLoadingCopy() {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }

  /* ---------- analyze ---------- */
  async function analyze() {
    if (!state.base64) return;
    if (!getKey() && !serverHasKey) {
      toast("Add your API key first ↑");
      openKeyPop(true);
      return;
    }
    showView("loading");
    startLoadingCopy();
    els.analyzeBtn.classList.add("is-loading");
    els.analyzeBtn.disabled = true;

    try {
      let res;
      try {
        res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: state.base64,
            media_type: state.mediaType,
            api_key: getKey(),
            model: els.modelSelect.value,
          }),
        });
      } catch {
        throw new Error("Couldn't reach the server. Is it running? (python3 server.py)");
      }

      // The API always replies with JSON; if it didn't, the server is down or a
      // proxy returned an HTML error page — give a clear message, not a parse error.
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          res.status === 404
            ? "Server reached, but /api/analyze wasn't found. Restart the server (python3 server.py)."
            : "The server returned an unexpected (non-JSON) response. It may have stopped — restart it (python3 server.py)."
        );
      }
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      renderResult(data);
      showView("result");
    } catch (err) {
      els.errorMsg.textContent = err.message || "Something went wrong.";
      showView("error");
    } finally {
      stopLoadingCopy();
      els.analyzeBtn.classList.remove("is-loading");
      els.analyzeBtn.disabled = false;
    }
  }

  /* ---------- render ---------- */
  function safe(v, fallback = "—") {
    return (typeof v === "string" && v.trim()) ? v : fallback;
  }

  function renderResult(d) {
    els.styleSummary.textContent = safe(d.style_summary);

    // keywords
    els.keywords.innerHTML = "";
    (Array.isArray(d.keywords) ? d.keywords : []).forEach((kw) => {
      if (!kw) return;
      const tag = document.createElement("button");
      tag.type = "button";
      tag.className = "tag";
      tag.textContent = kw;
      tag.addEventListener("click", async () => {
        if (await copy(kw)) {
          tag.classList.add("copied");
          toast(`Copied “${kw}”`);
          setTimeout(() => tag.classList.remove("copied"), 700);
        }
      });
      els.keywords.appendChild(tag);
    });

    // palette
    els.palette.innerHTML = "";
    const ke = d.key_elements || {};
    (Array.isArray(ke.color_palette) ? ke.color_palette : []).forEach((c) => {
      const hex = normalizeHex(c && c.hex);
      if (!hex) return;
      els.palette.appendChild(buildSwatch(hex, safe(c.name, ""), safe(c.role, "")));
    });
    if (!els.palette.children.length) {
      els.palette.innerHTML = '<p class="muted small">No palette detected.</p>';
    }

    els.typography.textContent = safe(ke.typography);
    els.layout.textContent = safe(ke.layout);
    els.spacing.textContent = safe(ke.spacing);
    els.standout.textContent = safe(ke.standout_details);

    els.readyPrompt.textContent = safe(d.ready_prompt);
    resetCopyButton();
  }

  function normalizeHex(hex) {
    if (typeof hex !== "string") return null;
    let h = hex.trim();
    if (!h.startsWith("#")) h = "#" + h;
    if (/^#[0-9a-fA-F]{3}$/.test(h)) {
      h = "#" + h.slice(1).split("").map((x) => x + x).join("");
    }
    return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : null;
  }

  function buildSwatch(hex, name, role) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "swatch";
    el.title = `Copy ${hex}`;
    el.innerHTML = `
      <span class="swatch-chip" style="background:${hex}"></span>
      <span class="swatch-meta">
        <span class="swatch-hex">${hex}<span class="copy-dot"></span></span>
        ${name && name !== "—" ? `<span class="swatch-name">${escapeHtml(name)}</span>` : ""}
        ${role && role !== "—" ? `<span class="swatch-role">${escapeHtml(role)}</span>` : ""}
      </span>`;
    el.addEventListener("click", async () => {
      if (await copy(hex)) {
        el.classList.add("copied");
        toast(`Copied ${hex}`);
        setTimeout(() => el.classList.remove("copied"), 800);
      }
    });
    return el;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function resetCopyButton() {
    els.copyPrompt.classList.remove("copied");
    els.copyPrompt.querySelector("span").textContent = "Copy";
  }

  /* ---------- settings: api key + model ---------- */
  let serverHasKey = false;

  function getKey() {
    try { return (localStorage.getItem(STORE.key) || "").trim(); } catch { return ""; }
  }
  function reflectKeyState() {
    const local = !!getKey();
    els.keyDot.classList.toggle("set", local || serverHasKey);
    els.keyBtnLabel.textContent = local ? "API key · set"
      : serverHasKey ? "API key · server" : "API key";
  }
  function openKeyPop(open) {
    els.keyPop.hidden = !open;
    els.keyBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      els.keyInput.value = getKey();
      setTimeout(() => els.keyInput.focus(), 0);
    }
  }
  function saveKey() {
    const v = els.keyInput.value.trim();
    try {
      if (v) localStorage.setItem(STORE.key, v);
      else localStorage.removeItem(STORE.key);
    } catch {}
    reflectKeyState();
    openKeyPop(false);
    toast(v ? "API key saved" : "API key cleared");
  }
  function clearKey() {
    els.keyInput.value = "";
    try { localStorage.removeItem(STORE.key); } catch {}
    reflectKeyState();
    toast("API key cleared");
  }
  function initSettings() {
    reflectKeyState();
    try {
      const m = localStorage.getItem(STORE.model);
      if (m && [...els.modelSelect.options].some((o) => o.value === m)) {
        els.modelSelect.value = m;
      }
    } catch {}
    // ask the server whether it already has a key (.env) so the indicator is honest
    fetch("/health")
      .then((r) => r.json())
      .then((h) => { serverHasKey = !!h.key; reflectKeyState(); })
      .catch(() => {});
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      toast("Clipboard not available — press ⌘/Ctrl+V instead.");
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          const ext = (type.split("/")[1] || "png").replace("jpeg", "jpg");
          handleFile(new File([blob], `pasted-image.${ext}`, { type }));
          return;
        }
      }
      toast("No image on the clipboard.");
    } catch {
      toast("Clipboard blocked — press ⌘/Ctrl+V instead.");
    }
  }

  /* ---------- events ---------- */
  els.dropzone.addEventListener("click", (e) => {
    if (els.dropzone.classList.contains("has-image")) return;
    els.fileInput.click();
  });
  els.dropzone.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !els.dropzone.classList.contains("has-image")) {
      e.preventDefault();
      els.fileInput.click();
    }
  });
  els.fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

  ["dragenter", "dragover"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("dragover");
    }));
  ["dragleave", "drop"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === "dragleave" && els.dropzone.contains(e.relatedTarget)) return;
      els.dropzone.classList.remove("dragover");
    }));
  els.dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });

  // paste an image from clipboard
  window.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) handleFile(item.getAsFile());
  });

  els.changeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    els.fileInput.click();
  });
  els.browseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    els.fileInput.click();
  });
  els.pasteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    pasteFromClipboard();
  });

  // model selector
  els.modelSelect.addEventListener("change", () => {
    try { localStorage.setItem(STORE.model, els.modelSelect.value); } catch {}
  });

  // api key popover
  els.keyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openKeyPop(els.keyPop.hidden);
  });
  els.keySave.addEventListener("click", saveKey);
  els.keyClear.addEventListener("click", clearKey);
  els.keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveKey();
    if (e.key === "Escape") openKeyPop(false);
  });
  document.addEventListener("click", (e) => {
    if (!els.keyPop.hidden && !e.target.closest(".key-wrap")) openKeyPop(false);
  });

  els.analyzeBtn.addEventListener("click", analyze);
  els.retryBtn.addEventListener("click", analyze);
  els.newBtn.addEventListener("click", () => {
    resetUpload();
    showView("empty");
    els.previewImg.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  els.copyPrompt.addEventListener("click", async () => {
    const text = els.readyPrompt.textContent;
    if (await copy(text)) {
      els.copyPrompt.classList.add("copied");
      els.copyPrompt.querySelector("span").textContent = "Copied";
      toast("Prompt copied");
      setTimeout(resetCopyButton, 1600);
    }
  });

  // init
  initSettings();
  showView("empty");
})();
