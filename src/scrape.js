// Scrape top TikToks for the configured niche via clockworks/tiktok-scraper.
//
//   npm run scrape -- test     -> 10 videos from #edm, saved to data/sample.json
//   npm run scrape -- final    -> ~30 videos across the final hashtags, data/raw.json
//
// Transcript + video/cover download add-ons are intentionally OFF: hooks come
// from native sticker text + cover-image OCR, never from spoken transcripts.
import { runActor, saveJson, readJson } from "./lib.js";

const mode = process.argv[2] === "final" ? "final" : "test";
const cfg = readJson("config.json");

// Date filter: last N days -> oldestPostDateUnified (the actor accepts "30 days").
function buildInput() {
  // Common flags: all download/transcript add-ons OFF.
  const base = {
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSlideshowImages: false,
    downloadSubtitlesOptions: "NEVER_DOWNLOAD_SUBTITLES",
  };
  if (mode === "test") {
    return {
      out: "data/sample.json",
      input: { hashtags: cfg.test.hashtags, resultsPerPage: cfg.test.resultsPerPage, ...base },
    };
  }
  const f = cfg.final;
  // Hashtag scraping has no sort field: TikTok's hashtag feed is popularity-ordered,
  // and the pipeline re-ranks by blended engagement anyway.
  return {
    out: "data/raw.json",
    input: {
      hashtags: f.hashtags,
      resultsPerPage: f.perHashtag,
      oldestPostDateUnified: `${f.lastDays} days`,
      ...base,
    },
  };
}

const { out, input } = buildInput();
console.log(`[scrape:${mode}] input:`, JSON.stringify(input));
const items = await runActor(input, { timeoutSecs: 420 });
const p = saveJson(out, items);
console.log(`[scrape:${mode}] saved ${items.length} items -> ${p}`);
