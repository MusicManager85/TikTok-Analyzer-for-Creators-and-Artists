// Render the single self-contained HTML report from an analysis object.
//
// As a module:  import { renderReport } from "./report.js"  ->  html string
// As a CLI:     npm run report   (reads data/analysis.json + data/enriched.json)
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJson } from "./lib.js";

// ---- shared text helpers ----
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
// Hyphens only, never em/en dashes (hard product rule).
const dash = (s) => String(s == null ? "" : s).replace(/[—–]/g, "-");
const clean = (s) => esc(dash(s));
const multiline = (s) => clean(s).replace(/\r?\n/g, "<br>");

function fmt(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "K";
  return String(n);
}
const pct = (x) => (x * 100).toFixed(x * 100 >= 10 ? 0 : 1) + "%";

// Build the full HTML document string from an analysis object + enriched videos.
export function renderReport(a, vids) {
  const s = a.sound_strategy;
  const origPct = Math.round(s.original_share * 100);
  const trendPct = 100 - origPct;

  const scoreboard = () => {
    const cards = [
      ["Videos analyzed", String(a.scoreboard.videos), "top TikToks in this niche"],
      ["Combined views", fmt(a.scoreboard.combined_views), "across the set"],
      ["Top engagement rate", pct(a.scoreboard.top_engagement_rate), "best single video"],
      ["Dominant format", clean(a.scoreboard.dominant_format), "what wins on screen"],
    ];
    return `<section class="board">${cards
      .map(
        ([label, val, sub]) => `<div class="stat">
        <div class="stat-val">${val}</div>
        <div class="stat-label">${clean(label)}</div>
        <div class="stat-sub">${sub}</div>
      </div>`
      )
      .join("")}</section>`;
  };

  const top5 = () => `<section>
    <h2>Top 5 performers</h2>
    <div class="cards">${a.top5
      .map((v, i) => {
        const badge = v.music_original
          ? `<span class="badge orig">original audio</span>`
          : `<span class="badge trend">trending sound</span>`;
        return `<div class="perf">
        <div class="perf-rank">#${i + 1}</div>
        <div class="perf-body">
          <div class="perf-author">@${clean(v.author)} ${v.hook_source === "ocr" ? "" : '<span class="dim">(caption hook)</span>'}</div>
          <blockquote class="hook">&ldquo;${multiline(v.hook_text)}&rdquo;</blockquote>
          <div class="perf-meta">
            <span>${fmt(v.plays)} views</span>
            <span>${pct(v.engagement_rate)} eng</span>
            ${badge}
            <a href="${esc(v.url)}" target="_blank" rel="noopener">watch</a>
          </div>
        </div>
      </div>`;
      })
      .join("")}</div>
  </section>`;

  const taxonomy = () => `<section>
    <h2>Hook taxonomy <span class="h2sub">the on-screen text patterns that stop the scroll</span></h2>
    <div class="tax-grid">${a.hook_taxonomy
      .map(
        (h, i) => `<div class="tax">
        <div class="tax-num">${String(i + 1).padStart(2, "0")}</div>
        <h3>${clean(h.name)}</h3>
        <p class="tax-desc">${clean(h.description)}</p>
        <div class="examples">${(h.examples || [])
          .map((e) => `<div class="ex">&ldquo;${multiline(e.text)}&rdquo;<span class="ex-by">@${clean(e.author)}</span></div>`)
          .join("")}</div>
      </div>`
      )
      .join("")}</div>
  </section>`;

  const sound = () => {
    const reused = s.reused_sounds || [];
    const reusedHtml = reused.length
      ? `<ul class="reused">${reused
          .map(
            (r) => `<li><strong>${clean(r.music_name)}</strong> by ${clean(r.music_author)}
          <span class="dim">used by ${r.count} videos (${clean([...new Set(r.authors)].map((x) => "@" + x).join(", "))})</span></li>`
          )
          .join("")}</ul>`
      : `<p class="dim">No single sound was reused across multiple creators in this set. That is an open lane: be the first artist to seed a track before the trend saturates.</p>`;

    const cmp = [
      ["Top third", s.top_third_original_share],
      ["Bottom third", s.bottom_third_original_share],
    ];
    return `<section class="sound">
      <h2>Sound strategy <span class="h2sub">original artist audio vs trending sounds</span></h2>
      <div class="sound-split">
        <div class="split-bar">
          <div class="seg orig" style="width:${origPct}%">${origPct >= 12 ? "original " + origPct + "%" : ""}</div>
          <div class="seg trend" style="width:${trendPct}%">${trendPct >= 12 ? "trending " + trendPct + "%" : ""}</div>
        </div>
        <div class="split-legend">
          <span><i class="dot orig"></i>Original audio - ${s.original_count} videos</span>
          <span><i class="dot trend"></i>Trending / licensed - ${s.trending_count} videos</span>
        </div>
      </div>
      <div class="sound-cols">
        <div>
          <h3>Does the split shift with performance?</h3>
          <div class="cmp">${cmp
            .map(
              ([label, v]) => `<div class="cmp-row"><span class="cmp-label">${label}</span>
            <div class="cmp-track"><div class="cmp-fill" style="width:${Math.round(v * 100)}%"></div></div>
            <span class="cmp-val">${Math.round(v * 100)}% original</span></div>`
            )
            .join("")}</div>
        </div>
        <div>
          <h3>Sounds worth riding this week</h3>
          ${reusedHtml}
        </div>
      </div>
      <p class="takeaway">${clean(s.takeaway)}</p>
    </section>`;
  };

  const findings = () => {
    const vp = a.visual_patterns || {};
    const formats = (vp.formats || []).slice(0, 6);
    const maxF = Math.max(1, ...formats.map((f) => f.approx_share_pct || 0));
    const day = a.posting.by_day || {};
    const maxDay = Math.max(1, ...Object.values(day));
    const tags = (a.caption_hashtag.top_hashtags || []).slice(0, 8);
    return `<section>
      <h2>Visual format, captions, and posting</h2>
      <div class="find-grid">
        <div class="panel">
          <h3>What is on screen</h3>
          <p>${clean(vp.summary)}</p>
          <div class="mini">${formats
            .map(
              (f) => `<div class="mini-row"><span>${clean(f.label)}</span>
            <div class="mini-track"><div class="mini-fill" style="width:${Math.round(((f.approx_share_pct || 0) / maxF) * 100)}%"></div></div>
            <span class="mini-val">${f.approx_share_pct || 0}%</span></div>`
            )
            .join("")}</div>
          <p class="tag-note"><strong>Length:</strong> ${clean(vp.length_sweet_spot)}<br><strong>Balance:</strong> ${clean(vp.text_vs_visual)}</p>
        </div>
        <div class="panel">
          <h3>Captions and hashtags</h3>
          <p>${clean(a.caption_hashtag.style || "")} ${clean(a.caption_hashtag.notes || "")}</p>
          <p class="tag-note"><strong>${a.caption_hashtag.avg_hashtags}</strong> hashtags on average, ~<strong>${a.caption_hashtag.avg_caption_length}</strong> caption characters.</p>
          <div class="chips">${tags
            .map((t) => `<span class="chip">#${clean(t.tag)} <b>${t.count}</b></span>`)
            .join("")}</div>
        </div>
        <div class="panel">
          <h3>When top performers posted</h3>
          <div class="days">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            .map(
              (d) => `<div class="day"><div class="day-bar" style="height:${Math.round(((day[d] || 0) / maxDay) * 100)}%"></div><span>${d}</span><em>${day[d] || 0}</em></div>`
            )
            .join("")}</div>
          <p class="tag-note dim">Times shown in UTC. ${Object.entries(a.posting.by_bucket)
            .sort((x, y) => y[1] - x[1])[0][0]} is the busiest window.</p>
        </div>
      </div>
    </section>`;
  };

  const ideas = () => `<section>
    <h2>Your next 5 videos <span class="h2sub">ready to shoot, mapped to the data</span></h2>
    <div class="idea-grid">${a.content_ideas
      .map(
        (c, i) => `<div class="idea">
        <div class="idea-num">${i + 1}</div>
        <div class="idea-hook">On-screen text:<br><strong>&ldquo;${multiline(c.hook_text)}&rdquo;</strong></div>
        <dl>
          <dt>Film</dt><dd>${clean(c.film)}</dd>
          <dt>Length</dt><dd>${clean(c.length_s)}s</dd>
          <dt>Sound</dt><dd>${clean(c.sound_approach)}</dd>
          <dt>Why</dt><dd>${clean(c.why)}</dd>
        </dl>
      </div>`
      )
      .join("")}</div>
  </section>`;

  const dateStr = new Date(a.meta.generated_at).toISOString().slice(0, 10);
  const hashLine = (a.meta.hashtags || []).map((h) => "#" + h).join(" ");
  // Truthful date window: most results are recent, but TikTok's hashtag feed can
  // surface a few older evergreen hits, so state the real span rather than assert "last 30 days".
  const dates = vids.map((v) => v.created).filter(Boolean).sort();
  const spanFrom = dates.length ? dates[0].slice(0, 10) : dateStr;
  const spanTo = dates.length ? dates[dates.length - 1].slice(0, 10) : dateStr;
  const recent = vids.filter((v) => {
    const d = new Date(v.created).getTime();
    return d >= new Date(a.meta.generated_at).getTime() - 30 * 864e5;
  }).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hook Decoder - ${clean(a.meta.niche)}</title>
<style>
:root{
  --bg:#0a0a0f; --bg2:#111119; --card:#16161f; --line:#26263a;
  --ink:#f4f4fb; --dim:#9a9ab5; --accent:#c6ff3a; --accent2:#7b5cff;
  --orig:#c6ff3a; --trend:#7b5cff;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);
  font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px 80px}
section{margin-top:64px}
h2{font-size:30px;font-weight:800;letter-spacing:-.02em;margin-bottom:22px}
.h2sub{display:block;font-size:14px;font-weight:500;color:var(--dim);letter-spacing:0;margin-top:4px}
h3{font-size:16px;font-weight:700;margin-bottom:8px}
a{color:var(--accent)}
.dim{color:var(--dim)}
/* hero */
.hero{padding:72px 0 8px;border-bottom:1px solid var(--line)}
.eyebrow{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;
  color:var(--bg);background:var(--accent);padding:5px 11px;border-radius:6px}
.hero h1{font-size:clamp(48px,9vw,104px);font-weight:900;letter-spacing:-.045em;line-height:.92;margin:20px 0 14px;
  background:linear-gradient(96deg,#fff 20%,var(--accent) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:19px;color:var(--dim);max-width:640px}
.hero .meta{margin-top:16px;font-size:14px;color:var(--dim)}
.hero .meta b{color:var(--ink)}
/* scoreboard */
.board{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:44px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
.stat-val{font-size:34px;font-weight:900;letter-spacing:-.03em;line-height:1;color:var(--accent)}
.stat-label{margin-top:10px;font-size:14px;font-weight:600}
.stat-sub{font-size:12px;color:var(--dim);margin-top:2px}
/* cards */
.cards{display:flex;flex-direction:column;gap:12px}
.perf{display:flex;gap:18px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.perf-rank{font-size:26px;font-weight:900;color:var(--accent2);min-width:44px}
.perf-author{font-weight:700;margin-bottom:6px}
.hook{font-size:19px;font-weight:600;line-height:1.35;border-left:3px solid var(--accent);padding-left:12px;margin:2px 0 10px}
.perf-meta{display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:13px;color:var(--dim)}
.badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.04em}
.badge.orig{background:rgba(198,255,58,.14);color:var(--orig)}
.badge.trend{background:rgba(123,92,255,.18);color:#b9a8ff}
/* taxonomy */
.tax-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.tax{position:relative;background:linear-gradient(180deg,var(--bg2),var(--card));border:1px solid var(--line);border-radius:16px;padding:24px}
.tax-num{position:absolute;top:18px;right:20px;font-size:44px;font-weight:900;color:var(--line)}
.tax h3{font-size:20px}
.tax-desc{color:var(--dim);font-size:14px;margin-bottom:14px;max-width:88%}
.examples{display:flex;flex-direction:column;gap:8px}
.ex{background:#0c0c12;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:14px;font-weight:600}
.ex-by{display:block;color:var(--accent2);font-weight:600;font-size:12px;margin-top:5px}
/* sound */
.sound{background:linear-gradient(180deg,rgba(123,92,255,.07),transparent);border:1px solid var(--line);border-radius:22px;padding:34px}
.split-bar{display:flex;height:46px;border-radius:12px;overflow:hidden;border:1px solid var(--line)}
.seg{display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:#0a0a0f}
.seg.orig{background:var(--orig)}
.seg.trend{background:var(--trend);color:#fff}
.split-legend{display:flex;gap:24px;margin-top:12px;font-size:13px;color:var(--dim)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px}
.dot.orig{background:var(--orig)}.dot.trend{background:var(--trend)}
.sound-cols{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:28px}
.cmp-row{display:flex;align-items:center;gap:12px;margin-bottom:12px;font-size:14px}
.cmp-label{min-width:92px;color:var(--dim)}
.cmp-track{flex:1;height:12px;background:#0c0c12;border-radius:8px;overflow:hidden;border:1px solid var(--line)}
.cmp-fill{height:100%;background:var(--orig)}
.cmp-val{min-width:90px;text-align:right;font-weight:700}
.reused{list-style:none;display:flex;flex-direction:column;gap:10px}
.reused li{background:#0c0c12;border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-size:14px}
.takeaway{margin-top:26px;font-size:17px;line-height:1.6;border-top:1px solid var(--line);padding-top:22px}
/* findings */
.find-grid{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:16px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;font-size:14px}
.panel p{color:var(--dim)}
.mini{margin:14px 0 6px;display:flex;flex-direction:column;gap:7px}
.mini-row{display:flex;align-items:center;gap:8px;font-size:12px}
.mini-row>span:first-child{min-width:120px;color:var(--ink)}
.mini-track{flex:1;height:8px;background:#0c0c12;border-radius:6px;overflow:hidden}
.mini-fill{height:100%;background:linear-gradient(90deg,var(--accent2),var(--accent))}
.mini-val{min-width:34px;text-align:right;color:var(--dim)}
.tag-note{margin-top:12px;font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
.chip{background:#0c0c12;border:1px solid var(--line);border-radius:20px;padding:5px 11px;font-size:12px;color:var(--dim)}
.chip b{color:var(--accent)}
.days{display:flex;gap:8px;align-items:flex-end;height:110px;margin:6px 0 4px}
.day{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.day-bar{width:70%;background:linear-gradient(180deg,var(--accent),var(--accent2));border-radius:5px 5px 0 0;min-height:3px}
.day span{font-size:11px;color:var(--dim);margin-top:6px}
.day em{font-size:11px;color:var(--ink);font-style:normal}
/* ideas */
.idea-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.idea{position:relative;background:linear-gradient(160deg,rgba(198,255,58,.06),var(--card));border:1px solid var(--line);border-radius:16px;padding:22px}
.idea-num{width:30px;height:30px;border-radius:50%;background:var(--accent);color:#0a0a0f;font-weight:900;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.idea-hook{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px}
.idea-hook strong{display:block;font-size:18px;color:var(--ink);text-transform:none;letter-spacing:0;margin-top:6px;line-height:1.3}
.idea dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px}
.idea dt{color:var(--accent);font-weight:700}
.idea dd{color:var(--dim)}
/* footer */
footer{margin-top:72px;padding-top:26px;border-top:1px solid var(--line);color:var(--dim);font-size:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
.backlink{display:inline-block;margin:26px 0 -20px;font-size:14px}
@media(max-width:860px){
  .board{grid-template-columns:repeat(2,1fr)}
  .tax-grid,.idea-grid,.sound-cols,.find-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="wrap">
  <a class="backlink" href="/">&larr; Decode another niche</a>
  <header class="hero">
    <span class="eyebrow">TikTok Content Playbook</span>
    <h1>Hook Decoder</h1>
    <p>Content playbook for: <b style="color:var(--ink)">${clean(a.meta.niche)}</b> - generated from ${a.meta.video_count} top TikToks (${recent} from the last 30 days).</p>
    <div class="meta">Niche hashtags: <b>${clean(hashLine)}</b> &nbsp;&middot;&nbsp; Posts ${spanFrom} to ${spanTo} &nbsp;&middot;&nbsp; Generated ${dateStr}</div>
  </header>
  ${scoreboard()}
  ${top5()}
  ${taxonomy()}
  ${sound()}
  ${findings()}
  ${ideas()}
  <footer>
    <span>Built with Apify + Claude.</span>
    <span>Hook = the on-screen text overlay that stops the scroll.</span>
  </footer>
</div>
</body>
</html>`;
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = readJson("data/analysis.json");
  const vids = readJson("data/enriched.json");
  const html = renderReport(a, vids);
  const outPath = path.join(ROOT, "hook-decoder-report.html");
  fs.writeFileSync(outPath, html);
  console.log(`[report] wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
}
