// Enrich scraped TikToks with on-screen-text hooks + engagement metrics.
//
// As a module:  import { enrichVideos } from "./enrich.js"
// As a CLI:     npm run enrich -- sample | final
//
// Hook extraction layers (priority order):
//   1. Native text sticker data  (this actor exposes none -> effectStickers are visual effects)
//   2. Cover-image OCR via claude-sonnet-4-6 vision  <- the real work
//   3. Caption first line         (secondary written-hook signal, never a substitute)
import { readJson, saveJson, callClaude, parseJsonLoose, mapLimit, unflatten, hashtagsFromText } from "./lib.js";

const OCR_SYSTEM =
  "You analyze TikTok cover thumbnails for a music-content strategist. The hook is the " +
  "ON-SCREEN TEXT OVERLAY that stops the scroll, not spoken words. Reply with JSON only.";

// Anthropic fetches the image server-side (url source), which bypasses this
// container's egress allowlist that blocks the TikTok CDN directly.
function ocrContent(url) {
  return [
    { type: "image", source: { type: "url", url } },
    {
      type: "text",
      text:
        "Return ONLY JSON: {\"onscreen_text\": string, \"visual\": string}. " +
        "onscreen_text = every word of text burned onto or stickered on this frame, verbatim, " +
        "exactly as written (empty string \"\" if there is genuinely no text). Do NOT include the " +
        "TikTok @username watermark or the app UI. " +
        "visual = what is shown, MAX 10 words, no full sentence " +
        "(e.g. \"DJ behind decks, crowd in front\", \"girl dancing in bedroom\", \"text-only black screen\"). " +
        "No commentary, no markdown.",
    },
  ];
}

function clampWords(s, n) {
  const w = (s || "").trim().split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : w.slice(0, n).join(" ");
}

function firstLine(text) {
  return (text || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#")) || "";
}

// Extract hooks + metrics for an array of raw scraped items. Returns enriched
// records sorted best-first by blended engagement score. onProgress(done,total)
// is called after each video.
export async function enrichVideos(rawItems, { onProgress, concurrency = 4 } = {}) {
  const raw = rawItems.map(unflatten);
  let done = 0;
  const enriched = await mapLimit(raw, concurrency, async (v) => {
    const cover = v.videoMeta?.coverUrl;
    let onscreen = "";
    let visual = "";
    let ocrError = null;
    if (cover) {
      try {
        const out = await callClaude(ocrContent(cover), { system: OCR_SYSTEM, maxTokens: 300 });
        const parsed = parseJsonLoose(out);
        onscreen = (parsed.onscreen_text || "").trim();
        visual = clampWords((parsed.visual || "").trim(), 10);
      } catch (e) {
        ocrError = String(e.message || e).slice(0, 120);
      }
    }

    const p = v.playCount || 0;
    const rate = (n) => (p > 0 ? (n || 0) / p : 0);
    const like_rate = rate(v.diggCount);
    const comment_rate = rate(v.commentCount);
    const share_rate = rate(v.shareCount);
    const save_rate = rate(v.collectCount);
    // Blended score on RATES (bounded), so one mega-viral outlier cannot drown patterns.
    // Saves + shares weighted highest: strongest "worth keeping / worth sending" signals.
    const blended = like_rate * 1 + comment_rate * 2 + share_rate * 3 + save_rate * 3;
    const engagement_rate = like_rate + comment_rate + share_rate + save_rate;

    const music = v.musicMeta || {};
    done++;
    if (onProgress) onProgress(done, raw.length);

    return {
      id: v.id,
      author: v.authorMeta?.name,
      author_nick: v.authorMeta?.nickName,
      verified: !!v.authorMeta?.verified,
      url: v.webVideoUrl,
      cover_url: cover,
      caption: v.text || "",
      caption_hook: firstLine(v.text),
      hashtags: v.hashtags && v.hashtags.length ? v.hashtags.map((h) => h.name) : hashtagsFromText(v.text),
      hook_text: onscreen || null,
      hook_source: onscreen ? "ocr" : "none",
      visual_desc: visual,
      ocr_error: ocrError,
      duration: v.videoMeta?.duration || 0,
      created: v.createTimeISO,
      plays: p,
      likes: v.diggCount || 0,
      comments: v.commentCount || 0,
      shares: v.shareCount || 0,
      saves: v.collectCount || 0,
      like_rate,
      comment_rate,
      share_rate,
      save_rate,
      engagement_rate,
      blended,
      music_name: music.musicName || "",
      music_author: music.musicAuthor || "",
      music_id: music.musicId || "",
      music_original: !!music.musicOriginal,
    };
  });

  enriched.sort((a, b) => b.blended - a.blended);
  return enriched;
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] === "final" ? "final" : "sample";
  const inFile = mode === "final" ? "data/raw.json" : "data/sample.json";
  const raw = readJson(inFile);
  console.log(`[enrich:${mode}] ${raw.length} videos from ${inFile}`);
  const enriched = await enrichVideos(raw, {
    onProgress: (d, t) => process.stdout.write(`  [${d}/${t}]\r`),
  });
  const p = saveJson("data/enriched.json", enriched);
  const okOcr = enriched.filter((e) => e.hook_source === "ocr").length;
  console.log(`\n[enrich:${mode}] wrote ${enriched.length} -> ${p}. OCR hooks found on ${okOcr}/${enriched.length}.`);
}
