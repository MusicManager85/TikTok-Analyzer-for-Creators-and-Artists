// One synthesis pass over the enriched dataset -> analysis object.
// Hard numbers come from stats.js; the model supplies qualitative structure only.
//
// As a module:  import { synthesizeAnalysis } from "./synthesize.js"
// As a CLI:     npm run synthesize   (reads data/enriched.json + config.json)
import { readJson, saveJson, callClaude, parseJsonLoose } from "./lib.js";
import { computeStats } from "./stats.js";

const SYSTEM =
  "You are a TikTok content strategist for a dance-music artist. The HOOK is the ON-SCREEN " +
  "TEXT OVERLAY that stops the scroll (never spoken words / transcripts). Ground every claim " +
  "in the provided data. Use hooks verbatim. No em dashes anywhere; hyphens only. Return ONLY JSON.";

const SCHEMA = `{
  "hook_taxonomy": [
    {"name": "short pattern name", "description": "1 sentence on why it works",
     "examples": [{"text": "verbatim on-screen hook", "author": "handle", "n": 3}],
     "video_ns": [3, 7]}
  ],
  "visual_patterns": {
    "summary": "2-3 sentences: what is on screen while the hook does the work",
    "length_sweet_spot": "short phrase referencing the duration data",
    "text_vs_visual": "short phrase: text-heavy vs visual-heavy tendency",
    "formats": [{"label": "e.g. DJ + crowd", "approx_share_pct": 40}]
  },
  "sound_takeaway": "3-4 sentences. State plainly whether original audio or trending sounds are winning in this niche right now, cite the split and the top-third vs bottom-third difference, and name the 1-3 specific reused sounds worth riding this week (or say none repeated).",
  "caption_cta": {"style": "short phrase on caption + CTA style", "notes": "1 sentence"},
  "content_ideas": [
    {"hook_text": "exact on-screen text to use", "film": "what to film while it is on screen",
     "length_s": 15, "sound_approach": "original track OR a specific trending sound from the data",
     "why": "1 sentence mapping to the data"}
  ]
}`;

// Build the analysis object from enriched videos. niche is the display label,
// hashtags is the array shown in the report meta.
export async function synthesizeAnalysis(vids, { niche, hashtags = [] } = {}) {
  const stats = computeStats(vids);

  const compact = vids.map((v, i) => ({
    n: i + 1,
    id: v.id,
    author: v.author,
    onscreen_hook: v.hook_text || "(none read)",
    hook_source: v.hook_source,
    visual: v.visual_desc,
    caption_first_line: v.caption_hook,
    hashtags: v.hashtags,
    duration_s: v.duration,
    plays: v.plays,
    engagement_rate: +(v.engagement_rate * 100).toFixed(1),
    sound: v.music_original ? "ORIGINAL audio" : `trending/licensed: "${v.music_name}" by ${v.music_author}`,
  }));

  const prompt =
    `NICHE: ${niche}\n` +
    `VIDEOS (ranked best-first by blended engagement rate):\n${JSON.stringify(compact, null, 1)}\n\n` +
    `PRE-COMPUTED STATS (exact, use these numbers, do not recompute):\n${JSON.stringify(stats, null, 1)}\n\n` +
    `Produce EXACTLY this JSON shape (no extra keys, no markdown fence):\n${SCHEMA}\n\n` +
    `Rules: hook_taxonomy = 4 to 6 named ON-SCREEN-TEXT patterns actually present above, each with ` +
    `2-3 verbatim examples and the video numbers that used them. content_ideas = exactly 5 ready-to-shoot ` +
    `ideas for a dance-music artist. Every on-screen hook must be plausible as burned-in text. JSON only.`;

  const out = await callClaude([{ type: "text", text: prompt }], { maxTokens: 4000, system: SYSTEM });
  const model = parseJsonLoose(out);

  const top5 = vids.slice(0, 5).map((v) => ({
    author: v.author,
    author_nick: v.author_nick,
    hook_text: v.hook_text || v.caption_hook || "(no on-screen text)",
    hook_source: v.hook_source,
    plays: v.plays,
    engagement_rate: v.engagement_rate,
    music_original: v.music_original,
    url: v.url,
  }));

  return {
    meta: {
      niche,
      generated_at: new Date().toISOString(),
      hashtags,
      video_count: vids.length,
    },
    scoreboard: {
      videos: stats.video_count,
      combined_views: stats.combined_views,
      top_engagement_rate: stats.top_engagement_rate,
      dominant_format: model.visual_patterns?.formats?.[0]?.label || "performance + crowd",
    },
    top5,
    hook_taxonomy: model.hook_taxonomy || [],
    visual_patterns: model.visual_patterns || {},
    sound_strategy: { ...stats.sound, takeaway: model.sound_takeaway || "" },
    caption_hashtag: { ...stats.hashtags, ...(model.caption_cta || {}), avg_caption_length: stats.caption.avg_length },
    posting: stats.posting,
    duration: stats.duration,
    content_ideas: model.content_ideas || [],
  };
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = readJson("config.json");
  const vids = readJson("data/enriched.json");
  console.log("[synthesize] calling claude-sonnet-4-6 over", vids.length, "videos...");
  const analysis = await synthesizeAnalysis(vids, { niche: cfg.niche_label, hashtags: cfg.final.hashtags });
  const p = saveJson("data/analysis.json", analysis);
  console.log(`[synthesize] wrote ${p}: ${analysis.hook_taxonomy.length} hook patterns, ${analysis.content_ideas.length} content ideas.`);
}
