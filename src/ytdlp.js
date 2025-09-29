import { spawn } from "child_process";

/** Chọn binary yt-dlp từ PATH */
function ytdlpBin() {
  return process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
}

/** Tham số chung – ưu tiên IPv4, UA/Referer cho FB/IG, giảm log ồn */
function commonArgs() {
  return [
    "--no-warnings",
    "--force-ipv4",
    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "--add-header", "Referer:https://www.facebook.com/",
  ];
}

/** Các cấu hình extractor-args cho TikTok (thử lần lượt để tăng tỉ lệ no-WM) */
const TIKTOK_EXTRACTOR_PROFILES = [
  "--extractor-args=tiktok:app_info=android,hd=1",
  "--extractor-args=tiktok:app_info=ios,hd=1",
];

/** Biến thể domain Facebook để tăng tỉ lệ bắt video công khai */
function fbVariants(raw) {
  try {
    const u = new URL(raw);
    if (!/facebook\.com/i.test(u.hostname)) return [raw];
    const path = u.pathname + (u.search || "") + (u.hash || "");
    return [
      `https://www.facebook.com${path}`,
      `https://m.facebook.com${path}`,
      `https://mbasic.facebook.com${path}`,
    ];
  } catch { return [raw]; }
}

/** Gọi yt-dlp để lấy JSON metadata (kèm extra args) */
function runProbe(url, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ytdlpBin(),
      [...commonArgs(), ...extraArgs, "-J", url],
      { windowsHide: true }
    );
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += String(d)));
    child.on("error", e => reject(new Error(`yt-dlp spawn error: ${e.message}`)));
    child.on("close", code => {
      if (code !== 0) return reject(new Error(err || `yt-dlp exited ${code}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(e); }
    });
  });
}

/** Lọc format: bỏ watermark / HLS-DASH / thiếu audio hoặc video */
function filterFormats(raw = []) {
  return raw.filter(f => {
    const note = String(f.format_note || "").toLowerCase();
    const prot = String(f.protocol || "").toLowerCase();
    if (note.includes("watermark")) return false;
    if (prot.includes("m3u8") || prot.includes("http_dash")) return false;
    if (!f.vcodec || f.vcodec === "none") return false;
    if (!f.acodec || f.acodec === "none") return false;
    return true; // progressive mp4/webm
  });
}

/** PROBE có retry cho TikTok (profiles) & Facebook (domain variants) */
export async function probe(url) {
  const isTikTok = /tiktok\.com/i.test(url);
  const isFacebook = /facebook\.com/i.test(url);

  const tiktokProfiles = isTikTok ? TIKTOK_EXTRACTOR_PROFILES : [""];
  const fbUrls = isFacebook ? fbVariants(url) : [url];

  let lastErr;

  for (const candidateUrl of fbUrls) {
    const profiles = isTikTok ? tiktokProfiles : [""];
    for (const profile of profiles) {
      try {
        const meta = await runProbe(candidateUrl, profile ? [profile] : []);
        const formats = filterFormats(meta.formats || []);
        if (formats.length > 0 || (!isTikTok && !isFacebook)) {
          return { meta, formats };
        }
        lastErr = new Error("Only adaptive/watermarked formats; retrying profile/domain…");
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error("probe failed");
}

/** Stream video: ưu tiên progressive mp4/webm; tránh HLS/DASH */
export function downloadVideo({ url, format }) {
  const fallback =
    "best[ext=mp4][vcodec!=none][acodec!=none][protocol!=m3u8][protocol!=http_dash_segment_base]/" +
    "best[ext=webm][vcodec!=none][acodec!=none]/best";
  const args = [
    ...commonArgs(),
    ...( /tiktok\.com/i.test(url) ? [TIKTOK_EXTRACTOR_PROFILES[0]] : [] ),
    "-f", format || fallback,
    "-o", "-", url,
  ];
  return spawn(ytdlpBin(), args, { windowsHide: true });
}

/** Stream MP3: bestaudio -> ffmpeg (320k) */
export function downloadAudioMp3({ url }) {
  const ytdlp = spawn(
    ytdlpBin(),
    [...commonArgs(), "-f", "bestaudio", "-o", "-", url],
    { windowsHide: true }
  );
  const ffmpeg = spawn(
    "ffmpeg",
    ["-i", "pipe:0", "-vn", "-acodec", "libmp3lame", "-b:a", "320k", "-f", "mp3", "pipe:1"],
    { windowsHide: true }
  );
  return { ytdlp, ffmpeg };
}
