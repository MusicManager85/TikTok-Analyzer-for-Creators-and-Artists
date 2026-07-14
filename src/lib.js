// Shared helpers: credential loading + Apify REST calls.
// Token resolution order: APIFY_TOKEN env var, then .secrets/apify_token file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function apifyToken() {
  if (process.env.APIFY_TOKEN && process.env.APIFY_TOKEN.trim()) {
    return process.env.APIFY_TOKEN.trim();
  }
  const f = path.join(ROOT, ".secrets", "apify_token");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  throw new Error(
    "No Apify token. Set APIFY_TOKEN env var or write it to .secrets/apify_token"
  );
}

const ACTOR = "clockworks~tiktok-scraper";

export async function actorDetails() {
  const token = apifyToken();
  const url = `https://api.apify.com/v2/acts/${ACTOR}?token=${token}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`actor details HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()).data;
}

export async function actorInputSchema() {
  const d = await actorDetails();
  const build = d.taggedBuilds?.[d.defaultRunOptions?.build || "latest"] || d.taggedBuilds?.latest;
  const buildId = build?.buildId;
  if (!buildId) return null;
  const token = apifyToken();
  const r = await fetch(`https://api.apify.com/v2/actor-builds/${buildId}?token=${token}`);
  if (!r.ok) throw new Error(`build HTTP ${r.status}`);
  const data = (await r.json()).data;
  const raw = data.inputSchema;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

// Run the actor synchronously and return dataset items.
export async function runActor(input, { timeoutSecs = 300 } = {}) {
  const token = apifyToken();
  const url =
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
    `?token=${token}&timeout=${timeoutSecs}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`run-sync HTTP ${r.status}: ${await r.text()}`);
  return await r.json();
}

export function saveJson(rel, obj) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

export function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

// ---- Anthropic (Claude) helpers ----
export function anthropicKey() {
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) {
    return process.env.ANTHROPIC_API_KEY.trim();
  }
  const f = path.join(ROOT, ".secrets", "anthropic_key");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  throw new Error("No Anthropic key. Set ANTHROPIC_API_KEY or .secrets/anthropic_key");
}

export const MODEL = "claude-sonnet-4-6";

// Call the Messages API and return concatenated text. `content` is a message
// content array (text and/or image blocks). Retries transient errors.
export async function callClaude(content, { model = MODEL, maxTokens = 1024, system } = {}) {
  const key = anthropicKey();
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
  };
  if (system) body.system = system;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`retryable HTTP ${r.status}: ${await r.text()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const data = await r.json();
      return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// Download an image URL and return { base64, mediaType }.
export async function fetchImageBase64(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
  });
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  let mediaType = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^image\//.test(mediaType)) mediaType = "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  return { base64: buf.toString("base64"), mediaType };
}

// Strip ```json fences and parse the first JSON value in a string.
export function parseJsonLoose(text) {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const a = t.indexOf("[");
    const start = a !== -1 && (a < s || s === -1) ? a : s;
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start !== -1 && end !== -1) return JSON.parse(t.slice(start, end + 1));
    throw new Error("no JSON found in model output");
  }
}

// Un-flatten dot-notation keys ("videoMeta.coverUrl") into nested objects.
// Apify MCP get-dataset-items returns projected fields flattened; scrape.js
// (REST) returns them nested. This normalizes both to the nested shape.
export function unflatten(item) {
  if (!item || typeof item !== "object") return item;
  const hasDots = Object.keys(item).some((k) => k.includes("."));
  if (!hasDots) return item;
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (!k.includes(".")) {
      out[k] = v;
      continue;
    }
    const parts = k.split(".");
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      node[parts[i]] = node[parts[i]] || {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = v;
  }
  return out;
}

// Extract #hashtags from caption text, lowercased, order-preserved, de-duped.
export function hashtagsFromText(text) {
  const out = [];
  const seen = new Set();
  for (const m of (text || "").matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const t = m[1].toLowerCase();
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

// Run async fn over items with limited concurrency, preserving order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
