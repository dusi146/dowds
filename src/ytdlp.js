import { spawn } from "child_process";
import path from "node:path";

/** Path tới binary */
function ytdlpBin() {
  return process.env.YTDLP_BIN || path.join(process.cwd(), "bin", "yt-dlp");
}
function ffmpegBin() {
  return process.env.FFMPEG_BIN || path.join(process.cwd(), "bin", "ffmpeg");
}

const commonArgs = () => [
  "--no-color",
  "--newline",
  "--restrict-filenames",
  "--no-warnings",
  "--concurrent-fragments", "4",
];

/** Parse JSON/NDJSON */
export function parseYtdlpJsonLines(lines = []) {
  const info = { title: "", thumbnail: "", duration: 0, extractor: "", formats: [] };
  for (const ln of lines) {
    if (!ln) continue;
    try {
      const obj = JSON.parse(ln);
      if (obj._type === "video") {
        info.title     = obj.title     ?? info.title;
        info.thumbnail = obj.thumbnail ?? info.thumbnail;
        info.duration  = obj.duration  ?? info.duration;
        info.extractor = obj.extractor ?? info.extractor;
      }
      if (obj.format_id) {
        const ext = (obj.ext || "").toLowerCase();
        const hasVideo = !!obj.vcodec && obj.vcodec !== "none";
        const hasAudio = !!obj.acodec && obj.acodec !== "none";
        if (ext === "mp4" && hasVideo && hasAudio) {
          info.formats.push({
            id: obj.format_id,
            ext: obj.ext,
            resolution: obj.height ? `${obj.height}p` : "auto",
            filesize: obj.filesize || 0,
          });
        }
      }
    } catch {}
  }
  return info;
}

/** Metadata video */
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
        const raw  = Buffer.concat(chunks).toString("utf8").trim();
        const json = JSON.parse(raw);

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

/** Stream MP4 */
export function pipeProcessToRes({ url, formatId, res }) {
  const args = [...commonArgs()];
  if (formatId) args.push("-f", formatId);
  args.push("-o", "-");
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

/** Stream MP3 qua ffmpeg */
export function buildAudioPipeline({ url }) {
  const ytdlp = spawn(
    ytdlpBin(),
    [...commonArgs(), "-f", "bestaudio", "-o", "-", url],
    { windowsHide: true }
  );

  const ffmpeg = spawn(
    ffmpegBin(),
    ["-i", "pipe:0", "-vn", "-acodec", "libmp3lame", "-b:a", "320k", "-f", "mp3", "pipe:1"],
    { windowsHide: true }
  );

  ytdlp.stdout.pipe(ffmpeg.stdin);

  return { ytdlp, ffmpeg };
}
