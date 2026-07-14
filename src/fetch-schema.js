// Fetch the clockworks/tiktok-scraper input schema + a sample output item,
// so we use exact field names instead of guessing. Run: npm run schema
import { actorInputSchema, runActor, saveJson } from "./lib.js";

const schema = await actorInputSchema();
if (schema) {
  saveJson("data/input-schema.json", schema);
  console.log("Input properties:");
  for (const [k, v] of Object.entries(schema.properties || {})) {
    console.log(`  ${k} (${v.type || v.editor || "?"}): ${(v.title || "").slice(0, 60)}`);
  }
} else {
  console.log("Could not resolve input schema from build.");
}

// One tiny run to capture the exact output field names.
console.log("\nFetching 1 sample item to inspect output fields...");
const items = await runActor({
  hashtags: ["edm"],
  resultsPerPage: 1,
  shouldDownloadVideos: false,
  shouldDownloadCovers: false,
  shouldDownloadSubtitles: false,
});
saveJson("data/output-sample.json", items);
if (items[0]) console.log("Top-level output keys:", Object.keys(items[0]).join(", "));
