// src/ytdlp.js
import { spawn } from "child_process";
import path from "node:path";

/** Trả về path tới binary yt-dlp (ưu tiên ENV, sau đó ./bin/yt-dlp) */
function ytdlpBin() {
  return process.env.YTDLP_BIN || path.join(process.cwd(), "bin", "yt-dlp");
}

/** Common args bạn đang dùng — giữ nguyên nếu trước đó có */
const commonArgs = () => [
  "--no-color",
  "--newline",
  "--restrict-filenames",
  "--no-warnings",
  "--concurrent-fragments", "4",
];

/** Parse formats (lọc progressive mp4 nếu muốn) — giữ nguyên nếu bạn đã có */
export function parseYtdlpJsonLines(lines = []) {
  const info = { title: "", thumbnail: "", duration: 0, extractor: "", formats: [] };

  for (const ln of lines) {
    if (!ln) continue;
    try {
      const obj = JSON.parse(ln);
      if (obj._type === "video") {
        info.title = obj.title || info.title;
        info.thumbnail = obj.thumbnail || info.thumbnail;
        info.duration = obj.duration || info.duration;
        info.extractor = obj.extractor || info.extractor;
      }
      if (obj.format_id) {
        const ext = (obj.ext || "").toLowerCase();
        const hasVideo = !!obj.vcodec && obj.vcodec !== "none";
        const hasAudio = !!obj.acodec && obj.acodec !== "none";

        // chỉ giữ progressive MP4
        if (ext === "mp4" && hasVideo && hasAudio) {
          const f = {
            id: obj.format_id,
            ext: obj.ext,
            resolution: obj.height ? `${obj.height}p` : "auto",
            filesize: obj.filesize || 0,
          };
          info.formats.push(f);
        }
      }
    } catch {}
  }
  return info;
}

/** Gọi yt-dlp để probe */
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
        // yt-dlp -J có thể trả 1 JSON object lớn, không phải NDJSON
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        const json = JSON.parse(raw);

        // chuyển về cấu trúc info dùng chung
        const lines = [];
        lines.push(JSON.stringify({
          _type: "video",
          title: json.title,
          thumbnail: json.thumbnail,
          duration: json.duration,
          extractor: json.extractor,
        }));
        (json.formats || []).forEach(f => lines.push(JSON.stringify(f)));

        const info = parseYtdlpJsonLines(lines);
        resolve(info);
      } catch (e) {
        reject(new Error(`yt-dlp parse error: ${e.message}`));
      }
    });
  });
}

/** Tải MP4: stream trực tiếp định dạng đã chọn */
export function pipeProcessToRes({ url, formatId, res }) {
  const args = [...commonArgs()];
  if (formatId) args.push("-f", formatId);
  args.push("-o", "-"); // stdout
  args.push(url);

  const child = spawn(ytdlpBin(), args, { windowsHide: true });

  child.stdout.pipe(res);
  child.stderr.on("data", d => console.error("[yt-dlp]", d.toString()));
  child.on("error", err => {
    res.destroy(err);
  });
  child.on("close", (code) => {
    if (code !== 0) {
      res.destroy(new Error(`yt-dlp exited with code ${code}`));
    } else {
      res.end();
    }
  });

  return child;
}

/** (Tuỳ chọn) Tải MP3: cần ffmpeg — nếu chưa cài ffmpeg thì tạm chưa dùng hàm này */
export function buildAudioPipeline({ url }) {
  // Nếu chưa cài ffmpeg, tạm throw để nút MP3 không được dùng
  throw new Error("FFmpeg is not bundled yet on Render. Please add ffmpeg or disable MP3.");
}
export { downloadAudio as downloadAudioMp3 };

