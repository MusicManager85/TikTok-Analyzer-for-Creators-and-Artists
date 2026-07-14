// Deterministic stats computed in Node so the report shows exact numbers
// (the model handles only qualitative synthesis, never the arithmetic).

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeStats(vids) {
  const n = vids.length;
  const sorted = [...vids].sort((a, b) => b.blended - a.blended);
  const third = Math.max(1, Math.round(n / 3));
  const topThird = sorted.slice(0, third);
  const botThird = sorted.slice(-third);

  const origShare = (arr) => (arr.length ? arr.filter((v) => v.music_original).length / arr.length : 0);

  // Reused sounds: same musicId across 2+ videos (a sound to jump on).
  const byMusic = new Map();
  for (const v of vids) {
    if (!v.music_id) continue;
    if (!byMusic.has(v.music_id)) {
      byMusic.set(v.music_id, {
        music_id: v.music_id,
        music_name: v.music_name,
        music_author: v.music_author,
        music_original: v.music_original,
        count: 0,
        authors: [],
        video_ids: [],
      });
    }
    const m = byMusic.get(v.music_id);
    m.count++;
    m.authors.push(v.author);
    m.video_ids.push(v.id);
  }
  const reused = [...byMusic.values()].filter((m) => m.count >= 2).sort((a, b) => b.count - a.count);

  // Hashtag frequency + co-occurrence with top third.
  const tagCount = new Map();
  const tagTop = new Map();
  for (const v of vids) {
    const set = new Set(v.hashtags || []);
    for (const t of set) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
  for (const v of topThird) {
    for (const t of new Set(v.hashtags || [])) tagTop.set(t, (tagTop.get(t) || 0) + 1);
  }
  const topHashtags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag, count]) => ({ tag, count, top_count: tagTop.get(tag) || 0 }));

  // Posting: day of week + time-of-day bucket (UTC).
  const byDay = Object.fromEntries(DAYS.map((d) => [d, 0]));
  const buckets = { "Night 0-6": 0, "Morning 6-12": 0, "Afternoon 12-18": 0, "Evening 18-24": 0 };
  for (const v of vids) {
    if (!v.created) continue;
    const d = new Date(v.created);
    byDay[DAYS[d.getUTCHours() >= 0 ? d.getUTCDay() : d.getUTCDay()]]++;
    const h = d.getUTCHours();
    if (h < 6) buckets["Night 0-6"]++;
    else if (h < 12) buckets["Morning 6-12"]++;
    else if (h < 18) buckets["Afternoon 12-18"]++;
    else buckets["Evening 18-24"]++;
  }

  const durations = vids.map((v) => v.duration).filter((x) => x > 0).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
  const shortShare = durations.length ? durations.filter((d) => d <= 30).length / durations.length : 0;

  const avgCaptionLen = Math.round(vids.reduce((s, v) => s + (v.caption || "").length, 0) / n);
  const avgHashtags = +(vids.reduce((s, v) => s + (v.hashtags || []).length, 0) / n).toFixed(1);

  return {
    video_count: n,
    combined_views: vids.reduce((s, v) => s + v.plays, 0),
    top_engagement_rate: Math.max(...vids.map((v) => v.engagement_rate)),
    sound: {
      original_share: origShare(vids),
      trending_share: 1 - origShare(vids),
      original_count: vids.filter((v) => v.music_original).length,
      trending_count: vids.filter((v) => !v.music_original).length,
      top_third_original_share: origShare(topThird),
      bottom_third_original_share: origShare(botThird),
      reused_sounds: reused,
    },
    hashtags: { avg_hashtags: avgHashtags, top_hashtags: topHashtags },
    posting: { by_day: byDay, by_bucket: buckets },
    duration: { median, short_share: shortShare, min: durations[0] || 0, max: durations[durations.length - 1] || 0 },
    caption: { avg_length: avgCaptionLen },
  };
}
