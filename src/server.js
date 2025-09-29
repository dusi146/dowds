import "dotenv/config";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  probeWithYtdlp as probe,
  pipeProcessToRes,
  buildAudioPipeline,
} from "./ytdlp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));

function cleanUrl(s) {
  try {
    const u = new URL(String(s).trim());
    if (/tiktok\.com/i.test(u.hostname)) u.pathname = u.pathname.replace(/\/_video\//, "/video/");
    if (/youtu\.be/i.test(u.hostname)) return `https://www.youtube.com/watch?v=${u.pathname.replace(/^\/+/, "")}`;
    if (/youtube\.com/i.test(u.hostname)) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (/facebook\.com|instagram\.com/i.test(u.hostname)) { u.search = ""; u.hash = ""; }
    u.search = ""; u.hash = "";
    return u.toString();
  } catch {
    return String(s || "");
  }
}

function pickTopFormats(progressive = []) {
  const score = (f) => {
    const m = /(\d+)p/i.exec(f.resolution || "");
    const h = m ? Number(m[1]) : 0;
    return h * 10 + (f.filesize ? 1 : 0);
  };
  return [...progressive].sort((a, b) => score(b) - score(a)).slice(0, 3);
}

/** Probe */
app.post("/probe", async (req, res) => {
  try {
    const url = cleanUrl(req.body?.url);
    if (!url) return res.status(400).json({ error: "Missing URL" });
    const raw = await probe({ url });
    const formats = pickTopFormats(raw.formats || []);
    res.json({
      title: raw.title,
      thumbnail: raw.thumbnail,
      duration: raw.duration,
      extractor: raw.extractor,
      formats,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** MP4 */
app.get("/download", (req, res) => {
  const url    = cleanUrl(req.query.url);
  const format = req.query.format || "";
  if (!url) return res.status(400).send("Missing URL");
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("X-Accel-Buffering", "no");
  pipeProcessToRes({ url, formatId: format, res });
});

/** MP3 */
app.get("/audio", (req, res) => {
  try {
    const url = cleanUrl(req.query.url);
    if (!url) return res.status(400).send("Missing URL");
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Accel-Buffering", "no");
    const { ytdlp, ffmpeg } = buildAudioPipeline({ url });
    ffmpeg.stdout.pipe(res);

    ytdlp.on("error", err => res.destroy(err));
    ffmpeg.on("error", err => res.destroy(err));

    ffmpeg.on("close", (code) => {
      if (code !== 0) res.destroy(new Error(`ffmpeg exited with code ${code}`));
      else res.end();
    });
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

app.listen(PORT, () => console.log("Server listening on", PORT));
