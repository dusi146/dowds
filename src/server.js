import "dotenv/config.js";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAudioMp3 } from "./ytdlp.js";

import {
  probe,                // lấy metadata + danh sách format đã lọc sẵn
  downloadVideo,        // stream MP4 (progressive – tránh HLS/DASH)
  downloadAudioMp3      // stream MP3 320k qua ffmpeg
} from "./ytdlp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));

/** Chuẩn hoá URL (gọn nhưng không can thiệp comment FB) */
function cleanUrl(s) {
  try {
    const u = new URL(String(s || "").trim());

    // TikTok: fix đường dẫn thử nghiệm -> chuẩn /video/ID
    if (/tiktok\.com/i.test(u.hostname)) {
      u.pathname = u.pathname.replace(/\/_video\//, "/video/");
      u.search = ""; u.hash = "";
      return u.toString();
    }

    // YouTube: youtu.be -> full; youtube.com chỉ giữ ?v=
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

    // Facebook: chuyển về m.facebook.com, giữ query
    if (/facebook\.com|fb\.watch/i.test(u.hostname)) {
      if (!/^m\.facebook\.com$/i.test(u.hostname)) u.hostname = "m.facebook.com";
      u.hash = "";
      return u.toString();
    }

    // Instagram: bỏ query/hash
    if (/instagram\.com/i.test(u.hostname)) {
      u.search = ""; u.hash = "";
      return u.toString();
    }

    // default
    u.search = ""; u.hash = "";
    return u.toString();
  } catch {
    return s;
  }
}

/* ============== API ============== */

/** /probe -> metadata + formats (đã lọc sẵn progressive, không WM) */
app.post("/probe", async (req, res) => {
  const raw = req.body?.url;
  if (!raw) return res.status(400).json({ error: "Missing url" });

  try {
    const url = cleanUrl(raw);
    const { meta, formats } = await probe(url);

    const mapped = formats.map(f => {
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
    });

    res.json({
      title: meta.title,
      extractor: meta.extractor || meta.extractor_key,
      duration: meta.duration,
      thumbnail: meta.thumbnail || (meta.thumbnails?.[0]?.url ?? null),
      formats: mapped
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** /download -> stream MP4 (ưu tiên chất lượng cao nhất an toàn) */
app.get("/download", async (req, res) => {
  const raw = req.query.url;
  const formatId = req.query.format; // có thể null -> dùng fallback an toàn
  if (!raw) return res.status(400).send("Missing url");

  try {
    const url = cleanUrl(raw);

    // đặt tên file đẹp
    let filename = "video.mp4";
    try {
      const { meta } = await probe(url);
      const base = (meta.title || "video").replace(/[\\/:*?"<>|]+/g, " ").trim();
      filename = `${base}.mp4`;
    } catch {}

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

    const child = downloadVideo({ url, format: formatId });
    child.stdout.pipe(res);

    // nếu yt-dlp lỗi, đóng response
    const endWithErr = () => { if (!res.headersSent) res.status(500); try { res.end(); } catch {} };
    child.stderr.on("data", () => {});
    child.on("error", endWithErr);
    child.on("close", code => { if (code !== 0) endWithErr(); });
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

/** /audio -> stream MP3 320k (yt-dlp -> ffmpeg) */
app.get("/audio", async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).send("Missing url");

  try {
    const url = cleanUrl(raw);

    let filename = "audio.mp3";
    try {
      const { meta } = await probe(url);
      const base = (meta.title || "audio").replace(/[\\/:*?"<>|]+/g, " ").trim();
      filename = `${base}.mp3`;
    } catch {}

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

    const { ytdlp, ffmpeg } = downloadAudioMp3({ url });

    ytdlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    const endWithErr = () => { if (!res.headersSent) res.status(500); try { res.end(); } catch {} };
    ytdlp.stderr.on("data", () => {});  ffmpeg.stderr.on("data", () => {});
    ytdlp.on("error", endWithErr);      ffmpeg.on("error", endWithErr);
    ytdlp.on("close", c => { if (c !== 0) endWithErr(); });
    ffmpeg.on("close", c => { if (c !== 0) endWithErr(); });
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

app.listen(PORT, () => {
  console.log(`[downloader] http://localhost:${PORT}`);
});
