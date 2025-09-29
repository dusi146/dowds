import "dotenv/config.js";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import {
  YTDLP, FFMPEG,
  probeWithRetry,
  buildDownloadArgs,
  buildAudioPipeline,
  pipeProcessToRes
} from "./ytdlp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));

/** Chuẩn hoá URL (không xử lý comment FB) */
function cleanUrl(s) {
  try {
    const u = new URL(String(s || "").trim());

    // TikTok
    if (/tiktok\.com/i.test(u.hostname)) {
      u.pathname = u.pathname.replace(/\/_video\//, "/video/");
      u.search = ""; u.hash = "";
      return u.toString();
    }

    // YouTube
    if (/youtu\.be/i.test(u.hostname)) {
      const id = u.pathname.replace(/^\/+/, "");
      return `https://www.youtube.com/watch?v=${id}`;
    }
    if (/youtube\.com/i.test(u.hostname)) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/watch?v=${id}`;
      u.search = ""; u.hash = "";
      return u.toString();
    }

    // Facebook: chuyển về m.facebook.com, giữ query như nguyên (không chế biến comment)
    if (/facebook\.com|fb\.watch/i.test(u.hostname)) {
      if (!/^m\.facebook\.com$/i.test(u.hostname)) u.hostname = "m.facebook.com";
      u.hash = "";
      return u.toString();
    }

    // Instagram
    if (/instagram\.com/i.test(u.hostname)) {
      u.search = ""; u.hash = "";
      return u.toString();
    }

    u.search = ""; u.hash = "";
    return u.toString();
  } catch {
    return s;
  }
}

/* ======================  API  ====================== */

/** /probe -> metadata */
app.post("/probe", async (req, res) => {
  const raw = req.body?.url;
  if (!raw) return res.status(400).json({ error: "Missing url" });

  try {
    const url = cleanUrl(raw);
    const info = await probeWithRetry(url);

    const formats = Array.isArray(info.formats) ? info.formats.map(f => {
      let resolution = null;
      if (f.height) resolution = `${f.height}p`;
      else if (f.format_note && /\d+p/.test(f.format_note)) resolution = f.format_note;

      return {
        id: f.format_id,
        ext: f.ext,
        acodec: f.acodec,
        vcodec: f.vcodec,
        filesize: f.filesize || f.filesize_approx || null,
        resolution
      };
    }).filter(Boolean) : [];

    res.json({
      title: info.title,
      extractor: info.extractor || info.extractor_key,
      duration: info.duration,
      thumbnail: info.thumbnail || (info.thumbnails?.[0]?.url ?? null),
      formats
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** /download -> stream MP4 */
app.get("/download", async (req, res) => {
  const raw = req.query.url;
  const formatId = req.query.format;
  if (!raw) return res.status(400).send("Missing url");

  try {
    const url = cleanUrl(raw);

    let filename = "video.mp4";
    try {
      const info = await probeWithRetry(url);
      const base = (info.title || "video").replace(/[\\/:*?"<>|]+/g, " ").trim();
      filename = `${base}.mp4`;
    } catch {}

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

    const args = buildDownloadArgs(url, formatId);
    pipeProcessToRes(YTDLP, args, res, () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

/** /audio -> stream MP3 320k */
app.get("/audio", async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).send("Missing url");

  try {
    const url = cleanUrl(raw);

    let filename = "audio.mp3";
    try {
      const info = await probeWithRetry(url);
      const base = (info.title || "audio").replace(/[\\/:*?"<>|]+/g, " ").trim();
      filename = `${base}.mp3`;
    } catch {}

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

    const { ytdlpArgs, ffArgs } = buildAudioPipeline(url);

    const y = spawn(YTDLP, ytdlpArgs, { shell: false, windowsHide: true });
    const f = spawn(FFMPEG, ffArgs, { shell: false, windowsHide: true });

    y.stdout.pipe(f.stdin);
    f.stdout.pipe(res);

    const endWithErr = () => {
      if (!res.headersSent) res.status(500);
      try { res.end(); } catch {}
    };

    y.stderr.on("data", () => {}); f.stderr.on("data", () => {});
    y.on("error", endWithErr);     f.on("error", endWithErr);
    y.on("close", c => { if (c !== 0) endWithErr(); });
    f.on("close", c => { if (c !== 0) endWithErr(); });
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

app.listen(PORT, () => {
  console.log(`[downloader] http://localhost:${PORT}`);
  console.log(`yt-dlp : ${YTDLP}`);
  console.log(`ffmpeg : ${FFMPEG}`);
});
