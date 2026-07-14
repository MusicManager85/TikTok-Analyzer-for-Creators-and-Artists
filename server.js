// Hook Decoder local web app.
// Keys (ANTHROPIC_API_KEY, APIFY_TOKEN) are read server-side from .env only and
// are never sent to any client. Start with: npm start  ->  http://localhost:3000
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./src/lib.js";
import {
  generateReport,
  sanitizeHashtags,
  sanitizeKeywords,
  nicheSlug,
  nicheLabel,
  MAX_HASHTAGS,
  MAX_RESULTS,
} from "./src/pipeline.js";

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_MS = 60 * 60 * 1000; // serve an existing report if the niche ran within the last hour

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const jobs = new Map(); // jobId -> { status, step, detail, done, total, reportUrl, niche, error }
const cache = new Map(); // slug  -> { time, reportUrl, niche, videoCount }

// ---- shared page chrome (same dark palette as the report) ----
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title, body) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#0a0a0f;--card:#16161f;--line:#26263a;--ink:#f4f4fb;--dim:#9a9ab5;--accent:#c6ff3a;--accent2:#7b5cff}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{width:100%;max-width:560px}
.eyebrow{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--bg);background:var(--accent);padding:5px 11px;border-radius:6px}
h1{font-size:clamp(44px,10vw,76px);font-weight:900;letter-spacing:-.045em;line-height:.92;margin:18px 0 12px;background:linear-gradient(96deg,#fff 20%,var(--accent) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{font-size:18px;color:var(--dim);margin-bottom:30px;max-width:480px}
label{display:block;font-size:13px;font-weight:700;letter-spacing:.02em;margin:0 0 7px;color:var(--ink)}
.hint{font-weight:400;color:var(--dim)}
input{width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px 16px;color:var(--ink);font-size:16px;font-family:inherit;outline:none}
input:focus{border-color:var(--accent2)}
.field{margin-bottom:18px}
button{width:100%;background:var(--accent);color:#0a0a0f;border:0;border-radius:12px;padding:16px;font-size:17px;font-weight:800;letter-spacing:-.01em;cursor:pointer;margin-top:6px}
button:disabled{opacity:.55;cursor:not-allowed}
.err{color:#ff8a8a;font-size:14px;margin-top:14px;min-height:18px}
.foot{margin-top:26px;font-size:13px;color:var(--dim)}
.spin{width:54px;height:54px;border:4px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:sp 1s linear infinite;margin:0 auto 26px}
@keyframes sp{to{transform:rotate(360deg)}}
.step{font-size:20px;font-weight:700;text-align:center;margin-bottom:8px}
.detail{text-align:center;color:var(--dim);font-size:15px;min-height:22px}
.track{height:8px;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:26px 0 8px}
.fill{height:100%;width:8%;background:linear-gradient(90deg,var(--accent2),var(--accent));transition:width .4s ease}
.center{text-align:center}
a{color:var(--accent)}
</style></head><body><div class="box">${body}</div></body></html>`;
}

// ---- landing ----
app.get("/", (_req, res) => {
  res.send(
    page(
      "Hook Decoder",
      `<span class="eyebrow">TikTok Content Playbook</span>
<h1>Hook Decoder</h1>
<p class="lead">Enter a niche and get a data-backed playbook: the on-screen text hooks, sound strategy, and 5 videos to shoot, pulled from the top TikToks right now.</p>
<form id="f">
  <div class="field">
    <label>Hashtags <span class="hint">comma separated, up to ${MAX_HASHTAGS}</span></label>
    <input id="hashtags" name="hashtags" placeholder="edm, housemusic, rave" autocomplete="off" autofocus>
  </div>
  <div class="field">
    <label>Keyword <span class="hint">optional</span></label>
    <input id="keywords" name="keywords" placeholder="melodic techno" autocomplete="off">
  </div>
  <button id="go" type="submit">Decode</button>
  <div class="err" id="err"></div>
</form>
<div class="foot">Scrapes up to ${MAX_RESULTS} videos. A run takes 1-3 minutes.</div>
<script>
const f=document.getElementById('f'),go=document.getElementById('go'),err=document.getElementById('err');
f.addEventListener('submit',async(e)=>{
  e.preventDefault();err.textContent='';go.disabled=true;go.textContent='Starting...';
  try{
    const r=await fetch('/generate',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({hashtags:document.getElementById('hashtags').value,keywords:document.getElementById('keywords').value})});
    const d=await r.json();
    if(!r.ok){throw new Error(d.error||'Something went wrong')}
    if(d.reportUrl && d.cached){location.href=d.reportUrl;return}
    location.href='/loading/'+d.jobId;
  }catch(ex){err.textContent=ex.message;go.disabled=false;go.textContent='Decode';}
});
</script>`
    )
  );
});

// ---- start a run (or serve cache) ----
app.post("/generate", (req, res) => {
  const hashtags = sanitizeHashtags(req.body.hashtags);
  const keywords = sanitizeKeywords(req.body.keywords);
  if (!hashtags.length && !keywords) {
    return res.status(400).json({ error: "Enter at least one hashtag (or a keyword)." });
  }

  const slug = nicheSlug(hashtags, keywords);
  const reportFile = path.join(ROOT, "public", "reports", `${slug}.html`);
  // Cache hit = a report for this exact niche was produced within the last hour.
  // Fall back to the report file's mtime so cache survives a server restart.
  let hit = cache.get(slug);
  if (!hit && fs.existsSync(reportFile)) {
    hit = { time: fs.statSync(reportFile).mtimeMs, reportUrl: `/report/${slug}`, niche: nicheLabel(hashtags, keywords) };
  }
  if (hit && Date.now() - hit.time < CACHE_MS && fs.existsSync(reportFile)) {
    return res.json({ cached: true, reportUrl: hit.reportUrl, niche: hit.niche });
  }

  const jobId = crypto.randomUUID();
  const job = { status: "running", step: "starting", detail: "Starting", done: 0, total: 0, niche: nicheLabel(hashtags, keywords), reportUrl: null, error: null };
  jobs.set(jobId, job);

  generateReport(hashtags, keywords, {
    onProgress: (p) => {
      job.step = p.step || job.step;
      job.detail = p.detail || job.detail;
      if (typeof p.done === "number") job.done = p.done;
      if (typeof p.total === "number") job.total = p.total;
    },
  })
    .then((result) => {
      job.status = "done";
      job.step = "done";
      job.detail = "Done";
      job.reportUrl = result.reportUrl;
      job.niche = result.niche;
      cache.set(slug, { time: Date.now(), reportUrl: result.reportUrl, niche: result.niche, videoCount: result.videoCount });
    })
    .catch((e) => {
      job.status = "error";
      job.error = String(e.message || e);
      console.error(`[generate] ${slug} failed:`, e);
    });

  res.json({ jobId });
});

// ---- job status (polled by the loading page) ----
app.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Unknown job" });
  res.json(job);
});

// ---- loading page ----
app.get("/loading/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  if (!jobs.has(jobId)) return res.redirect("/");
  res.send(
    page(
      "Decoding...",
      `<div class="center"><div class="spin"></div>
<div class="step" id="step">Warming up</div>
<div class="detail" id="detail">Starting the pipeline</div>
<div class="track"><div class="fill" id="fill"></div></div>
<div class="foot" id="foot">This takes 1-3 minutes. Keep this tab open.</div></div>
<script>
const id=${JSON.stringify(jobId)};
const steps={starting:['Warming up',8],scraping:['Scraping TikTok',22],reading:['Reading on-screen hooks',55],analyzing:['Analyzing patterns',80],building:['Building your report',94],done:['Done',100]};
async function poll(){
  try{
    const r=await fetch('/status/'+id);const j=await r.json();
    if(j.status==='error'){document.getElementById('step').textContent='Something went wrong';
      document.getElementById('detail').innerHTML=(j.error||'Please try again')+'<br><br><a href="/">Start over</a>';
      document.querySelector('.spin').style.display='none';return;}
    const s=steps[j.step]||['Working',40];
    document.getElementById('step').textContent=s[0];
    let d=j.detail||'';if(j.step==='reading'&&j.total){d='Reading covers '+j.done+'/'+j.total;}
    document.getElementById('detail').textContent=d;
    let pctv=s[1];
    if(j.step==='reading'&&j.total){pctv=22+Math.round((j.done/j.total)*33);}
    document.getElementById('fill').style.width=pctv+'%';
    if(j.status==='done'&&j.reportUrl){document.getElementById('fill').style.width='100%';location.href=j.reportUrl;return;}
  }catch(e){}
  setTimeout(poll,1500);
}
poll();
</script>`
    )
  );
});

// ---- serve a generated report ----
app.get("/report/:slug", (req, res) => {
  const slug = String(req.params.slug).replace(/[^a-z0-9-]/gi, "");
  const file = path.join(ROOT, "public", "reports", `${slug}.html`);
  if (!fs.existsSync(file)) {
    return res.status(404).send(page("Not found", `<div class="center"><h1>404</h1><p class="lead">No report for that niche yet.</p><a href="/">Decode a niche</a></div>`));
  }
  res.type("html").send(fs.readFileSync(file, "utf8"));
});

app.listen(PORT, () => {
  console.log(`Hook Decoder running at http://localhost:${PORT}`);
  if (!process.env.APIFY_TOKEN) console.warn("WARNING: APIFY_TOKEN not set - scraping will fail. Add it to .env");
  if (!process.env.ANTHROPIC_API_KEY && !fs.existsSync(path.join(ROOT, ".secrets", "anthropic_key")))
    console.warn("WARNING: ANTHROPIC_API_KEY not set - OCR/analysis will fail. Add it to .env");
});
