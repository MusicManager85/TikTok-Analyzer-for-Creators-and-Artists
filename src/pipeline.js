// generateReport(hashtags, keywords) runs the full pipeline for any niche:
//   Apify scrape (REST) -> cover-image OCR hook extraction -> Claude synthesis -> HTML report
// and writes a self-contained report to public/reports/<slug>.html.
import fs from "node:fs";
import path from "node:path";
import { ROOT, runActor, saveJson } from "./lib.js";
import { enrichVideos } from "./enrich.js";
import { synthesizeAnalysis } from "./synthesize.js";
import { renderReport } from "./report.js";

export const MAX_RESULTS = 30;
export const MAX_HASHTAGS = 5;
const REPORTS_DIR = path.join(ROOT, "public", "reports");
const RUNS_DIR = path.join(ROOT, "data", "runs");

// Strip '#', spaces and invalid chars; lowercase; dedupe; cap to MAX_HASHTAGS.
export function sanitizeHashtags(input) {
  const arr = Array.isArray(input) ? input : String(input || "").split(",");
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const tag = String(raw).trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
    if (out.length >= MAX_HASHTAGS) break;
  }
  return out;
}

export function sanitizeKeywords(input) {
  return String(input || "").replace(/[\r\n]+/g, " ").trim().slice(0, 100);
}

export function nicheSlug(hashtags, keywords) {
  const parts = [...[...hashtags].sort()];
  if (keywords) parts.push("kw-" + keywords.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-"));
  return (parts.join("-") || "niche").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function titleCase(s) {
  return String(s).replace(/\b[\p{L}]/gu, (c) => c.toUpperCase());
}

export function nicheLabel(hashtags, keywords) {
  if (keywords) return titleCase(keywords);
  if (!hashtags.length) return "This niche";
  return hashtags.map(titleCase).join(" / ");
}

// Run the whole pipeline. onProgress({ step, detail, done, total }) is optional.
// Returns { slug, niche, hashtags, videoCount, reportUrl, reportPath }.
export async function generateReport(hashtagsInput, keywordsInput, { onProgress = () => {} } = {}) {
  const hashtags = sanitizeHashtags(hashtagsInput);
  const keywords = sanitizeKeywords(keywordsInput);
  if (!hashtags.length && !keywords) {
    throw new Error("Provide at least one hashtag or a keyword.");
  }

  const slug = nicheSlug(hashtags, keywords);
  const niche = nicheLabel(hashtags, keywords);
  const sources = hashtags.length + (keywords ? 1 : 0);
  const perSource = Math.max(1, Math.floor(MAX_RESULTS / Math.max(1, sources)));

  // 1. Scrape (Apify REST). Downloads + subtitles OFF, per product constraints.
  onProgress({ step: "scraping", detail: `Scraping TikTok for ${niche}` });
  const input = {
    resultsPerPage: perSource,
    oldestPostDateUnified: "30 days",
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSlideshowImages: false,
    downloadSubtitlesOptions: "NEVER_DOWNLOAD_SUBTITLES",
  };
  if (hashtags.length) input.hashtags = hashtags;
  if (keywords) input.searchQueries = [keywords];

  let items = await runActor(input, { timeoutSecs: 240 });
  items = (items || []).filter((it) => it && it.id && !it.error).slice(0, MAX_RESULTS);
  if (!items.length) throw new Error("No videos returned for that niche. Try different hashtags.");

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  saveJson(path.join("data", "runs", `${slug}.raw.json`), items);

  // 2. Hook extraction (cover-image OCR).
  onProgress({ step: "reading", detail: "Reading on-screen text from covers", done: 0, total: items.length });
  const enriched = await enrichVideos(items, {
    onProgress: (done, total) =>
      onProgress({ step: "reading", detail: `Reading covers ${done}/${total}`, done, total }),
  });

  // 3. Synthesis pass.
  onProgress({ step: "analyzing", detail: "Finding hook patterns and sound strategy" });
  const analysis = await synthesizeAnalysis(enriched, { niche, hashtags });

  // 4. Render report.
  onProgress({ step: "building", detail: "Building report" });
  const html = renderReport(analysis, enriched);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `${slug}.html`);
  fs.writeFileSync(reportPath, html);
  saveJson(path.join("data", "runs", `${slug}.analysis.json`), analysis);

  const result = { slug, niche, hashtags, videoCount: enriched.length, reportUrl: `/report/${slug}`, reportPath };
  onProgress({ step: "done", detail: "Done", ...result });
  return result;
}
