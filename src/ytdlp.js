// src/ytdlp.js
import { spawn } from "child_process";
import path from "node:path";

/** Path tới binary yt-dlp (ưu tiên ENV → ./bin/yt-dlp) */
function ytdlpBin() {
  return process.env.YTDLP_BIN || path.join(process.cwd(), "bin", "yt-dlp");
}

/** Tham số dùng chung cho yt-dlp */
const commonArgs = () => [
  "--no-color",
  "--newline",
  "--restrict-filenames",
  "--no-warnings",
  "--concurrent-fragments", "4",
];

/** Convert NDJSON/JSON từ yt-dlp về cấu trúc gọn cho UI */
export function parseYtdlpJsonLines(lines = []) {
  const info = { title: "", thumbnail: "", duration: 0, extractor: "", formats: [] };

  for (const ln of lines) {
    if (!ln) continue;
    try {
      const obj = JSON.parse(ln);

      // metadata video
      if (obj._type === "video") {
        info.title     = obj.title     ?? info.title;
        info.thumbnail = obj.thumbnail ?? info.thumbnail;
        info.duration  = obj.duration  ?? info.duration;
        info.extractor = obj.extractor ?? info.extractor;
      }

      // định dạng
      if (obj.format_id) {
        const ext = (obj.ext || "").toLowerCase();
        const hasVideo = !!obj.vcodec && obj.vcodec !== "none";
        const hasAudio = !!obj.acodec && obj.acodec !== "none";

        // Giữ **progressive MP4** (tránh DASH gây dính logo/không tiếng trên vài nguồn)
        if (ext === "mp4" && hasVideo && hasAudio) {
          info.formats.push({
            id: obj.format_id,
            ext: obj.ext,
            resolution: obj.height ? `${obj.height}p` : "auto",
            filesize: obj.filesize || 0,
          });
        }
      }
    } catch { /* bỏ dòng lỗi parse */ }
  }
  return info;
}

/** Probe: gọi yt-dlp lấy metadata + danh sách format */
export function probeWithYtdlp({ url }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ytdlpBin(),
      [...commonArgs(), "-J", "--no-simulate", url],
      { windowsHide: true }
    );

    const chunks = [];
    child.stdout.on("data", d => chunks.push(d));
    child.stderr.on("data", d => console.error("[yt-dlp]", d.toString()));

    child.on("error", (err) => reject(new Error(`yt-dlp spawn error: ${err.message}`)));
    child.on("close", () => {
      try {
        // -J thường trả **một** JSON object lớn
        const raw  = Buffer.concat(chunks).toString("utf8").trim();
        const json = JSON.parse(raw);

        // ép về dạng NDJSON để tái dụng parser ở trên
        const lines = [];
        lines.push(JSON.stringify({
          _type: "video",
          title: json.title,
          thumbnail: json.thumbnail,
          duration: json.duration,
          extractor: json.extractor,
        }));
        (json.formats || []).forEach(f => lines.push(JSON.stringify(f)));

        resolve(parseYtdlpJsonLines(lines));
      } catch (e) {
        reject(new Error(`yt-dlp parse error: ${e.message}`));
      }
    });
  });
}

/** Stream MP4 trực tiếp ra response */
export function pipeProcessToRes({ url, formatId, res }) {
  const args = [...commonArgs()];
  if (formatId) args.push("-f", formatId);
  args.push("-o", "-"); // stdout
  args.push(url);

  const child = spawn(ytdlpBin(), args, { windowsHide: true });

  child.stdout.pipe(res);
  child.stderr.on("data", d => console.error("[yt-dlp]", d.toString()));
  child.on("error", err => res.destroy(err));
  child.on("close", (code) => {
    if (code !== 0) res.destroy(new Error(`yt-dlp exited with code ${code}`));
    else res.end();
  });

  return child;
}

/** (Tạm tắt) Tải MP3: cần ffmpeg — không bundle trên Render Free */
export function buildAudioPipeline() {
  throw new Error("FFmpeg is not bundled on Render free plan. Disable MP3 or add ffmpeg layer.");
}
