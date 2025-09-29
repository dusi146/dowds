import gsap from "https://esm.sh/gsap";
import { vec2 } from "https://esm.sh/vecteur";

/* ======== LOADING OVERLAY ======== */
const loading = document.getElementById("loading");
function showLoading(){ loading && loading.classList.remove("hidden"); }
function hideLoading(){ loading && loading.classList.add("hidden"); }

/* ========= Elastic Bubble Cursor ========= */
class ElasticCursor {
  constructor(el){
    this.node = el;
    this.pos = { prev: vec2(-100,-100), now: vec2(-100,-100), aim: vec2(-100,-100), ease: 0.12 };
    this.size = { prev: 1, now: 1, aim: 1, ease: 0.14 };
    this.active = false; this.target = null;
    this._bindSticky();
  }
  _bindSticky(){
    gsap.utils.toArray("[data-sticky]").forEach((el) => {
      const area = el.querySelector("[data-sticky-area]");
      area.addEventListener("pointerover", () => { this.active = true; this.target = area; el.classList.add("is-bubbled"); });
      area.addEventListener("pointerout",  () => { this.active = false; this.target = null; el.classList.remove("is-bubbled"); });
      const moveX = gsap.quickTo(el, "x", { duration: 1, ease: "elastic.out(1,0.3)" });
      const moveY = gsap.quickTo(el, "y", { duration: 1, ease: "elastic.out(1,0.3)" });
      el.addEventListener("pointermove", (ev) => {
        const { clientX, clientY } = ev; const r = el.getBoundingClientRect();
        moveX((clientX - (r.left + r.width/2)) * 0.2); moveY((clientY - (r.top + r.height/2)) * 0.2);
      });
      el.addEventListener("pointerout", () => { moveX(0); moveY(0); });
    });
  }
  moveTo(x,y){
    if (this.active && this.target){
      const r = this.target.getBoundingClientRect(), cx = r.x + r.width/2, cy = r.y + r.height/2;
      const dx = x - cx, dy = y - cy;
      this.pos.aim.x = cx + dx * 0.15; this.pos.aim.y = cy + dy * 0.15; this.size.aim = 2;
      const angle = Math.atan2(dy,dx) * 180/Math.PI, dist = Math.hypot(dx,dy) * 0.01;
      gsap.set(this.node,{ rotate: angle });
      gsap.to(this.node,{ scaleX: this.size.aim + Math.pow(Math.min(dist,.6),3)*3, scaleY: this.size.aim - Math.pow(Math.min(dist,.3),3)*3, duration:.5, ease:"power4.out", overwrite:true });
    } else { this.pos.aim.x = x; this.pos.aim.y = y; this.size.aim = 1; }
  }
  update(){
    this.pos.now.lerp(this.pos.aim, this.pos.ease);
    this.size.now = gsap.utils.interpolate(this.size.now, this.size.aim, this.size.ease);
    const diff = this.pos.now.clone().sub(this.pos.prev);
    this.pos.prev.copy(this.pos.now); this.size.prev = this.size.now;
    gsap.set(this.node, { x: this.pos.now.x, y: this.pos.now.y });
    if (!this.active){
      const ang = Math.atan2(diff.y, diff.x) * 180/Math.PI, d = Math.hypot(diff.x,diff.y)*0.04;
      gsap.set(this.node, { rotate: ang, scaleX: this.size.now + Math.min(d,1), scaleY: this.size.now - Math.min(d,.3) });
    }
  }
}
const bubble = new ElasticCursor(document.querySelector(".bubble"));
addEventListener("mousemove", e => bubble.moveTo(e.clientX, e.clientY));
(function raf(){ bubble.update(); requestAnimationFrame(raf); })();

/* ========= DOM refs ========= */
const platforms = document.getElementById("platforms");
const panel = document.getElementById("panel");
const panelTitle = document.getElementById("panelTitle");
const platformDot = document.getElementById("platformDot");
const urlInput = document.getElementById("urlInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const closePanel = document.getElementById("closePanel");

const resultBox = document.getElementById("result");
const thumb = document.getElementById("thumb");
const title = document.getElementById("title");
const desc = document.getElementById("desc");
const fmtSel = document.getElementById("formatSelect");
const dlMp4 = document.getElementById("dlMp4");
const dlMp3 = document.getElementById("dlMp3");

let currentPlatform = null;

/* ========= Clean URL (rút gọn tự động) ========= */
function cleanUrl(raw) {
  const s = String(raw || "").trim();
  try {
    const u = new URL(s);

    // TikTok: sửa /_video/ -> /video/, bỏ query/hash
    if (/tiktok\.com/i.test(u.hostname)) {
      u.pathname = u.pathname.replace(/\/_video\//, "/video/");
      u.search = ""; 
      u.hash = "";
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

    // Facebook: giữ tham số quan trọng cho watch/permalink
    if (/facebook\.com/i.test(u.hostname)) {
      const keep = new URLSearchParams();
      const want = ["comment_id", "story_fbid", "id", "v"];
      for (const k of want) {
        const val = u.searchParams.get(k);
        if (val) keep.set(k, val);
      }
      u.search = keep.toString();
      u.hash = "";
      return u.toString();
    }

    // Instagram: bỏ query/hash
    if (/instagram\.com/i.test(u.hostname)) {
      u.search = ""; u.hash = "";
      return u.toString();
    }

    // default: bỏ query/hash
    u.search = ""; u.hash = "";
    return u.toString();
  } catch {
    return s;
  }
}

/* ========= UI logic ========= */
document.querySelectorAll(".icon-btn[data-platform]").forEach(btn=>{
  btn.addEventListener("click", () => {
    currentPlatform = btn.dataset.platform;
    const info = {
      tiktok:   { name: "TikTok",    color: "#111"     },
      youtube:  { name: "YouTube",   color: "#FF0033"  },
      facebook: { name: "Facebook",  color: "#1877F2"  },
      instagram:{ name: "Instagram", color: "#E4405F"  }
    }[currentPlatform];

    platformDot.style.background = info.color;
    panelTitle.textContent = `Nhập liên kết ${info.name}`;

    platforms.style.display = "none";
    panel.classList.add("show");
    panel.setAttribute("aria-hidden","false");
    resultBox.classList.add("hidden");
    urlInput.value = ""; urlInput.focus();
    fmtSel.innerHTML = "";
  });
});

/* đóng panel -> quay lại chọn nền tảng */
closePanel.addEventListener("click", () => {
  panel.classList.remove("show");
  panel.setAttribute("aria-hidden","true");
  setTimeout(()=>{ platforms.style.display = "flex"; }, 200);
});

/* gọi /probe */
analyzeBtn.addEventListener("click", async () => {
  const cleaned = cleanUrl(urlInput.value);
  if (!cleaned) return alert("Nhập liên kết trước đã.");
  urlInput.value = cleaned; // hiển thị link gọn ngay

  // chặn spam bấm trong lúc đang tải
  analyzeBtn.disabled = true;
  showLoading();

  try {
    const r = await fetch("/probe", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ url: cleaned })
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || "Phân tích thất bại.");

    // đổ meta
    thumb.src = data.thumbnail || "";
    title.textContent = data.title || "Không có tiêu đề";
    desc.textContent = (data.extractor ? `${data.extractor}` : "") + (data.duration ? ` • ${Math.round(data.duration)}s` : "");

    /* ====== CHỌN FORMAT ỔN ĐỊNH (tối đa 3 lựa chọn, ưu tiên 480p/720p/1080p, bỏ audio-only) ====== */
    const raw = Array.isArray(data.formats) ? data.formats : [];

    // Chuẩn hoá & lọc: chỉ giữ format có video (vcodec != 'none'), ext mp4 (ổn định tải)
    const videoFormats = raw
      .map(f => {
        let res = null;
        if (f.resolution && /\d+p/.test(f.resolution)) res = f.resolution;
        // fallback theo height nếu server có gửi
        if (!res && f.height) res = `${f.height}p`;
        return {
          id: f.id,
          ext: (f.ext || "").toLowerCase(),
          vcodec: f.vcodec || "",
          filesize: f.filesize || null,
          resolution: res || "auto"
        };
      })
      .filter(f => f.ext === "mp4" && f.vcodec && f.vcodec !== "none"); // loại audio-only

    // Ưu tiên 3 mốc cơ bản
    const targets = ["480p","720p","1080p"];
    let filtered = videoFormats.filter(f => targets.includes(f.resolution));

    // Nếu không có đúng 480/720/1080p => lấy 3 format có độ phân giải cao nhất (khác "auto")
    if (filtered.length === 0) {
      filtered = videoFormats
        .filter(f => f.resolution !== "auto")
        .sort((a,b) => parseInt(b.resolution) - parseInt(a.resolution))
        .slice(0,3);
    }

    // Nếu vẫn trống (trường hợp hiếm) => cho phép cả "auto" nhưng vẫn là mp4 + có video
    if (filtered.length === 0) {
      filtered = videoFormats.slice(0,3);
    }

    // Render options
    fmtSel.innerHTML = "";
    if (filtered.length === 0) {
      // bất đắc dĩ: không tìm được gì ngoài auto
      const o = document.createElement("option");
      o.value = ""; o.textContent = "auto • MP4";
      fmtSel.appendChild(o);
    } else {
      filtered.forEach(f => {
        const o = document.createElement("option");
        o.value = f.id;
        const size = f.filesize ? ` • ${(f.filesize/1024/1024).toFixed(1)} MB` : "";
        o.textContent = `${f.resolution} • MP4${size}`;
        fmtSel.appendChild(o);
      });
    }

    // Chọn mặc định = độ phân giải cao nhất trong filtered
    if (filtered.length > 0) {
      const highest = filtered.reduce((max,f) => {
        const fr = parseInt((f.resolution||"0").replace("p","")) || 0;
        const mr = parseInt((max?.resolution||"0").replace("p","")) || 0;
        return (fr > mr) ? f : max;
      }, null);
      if (highest) fmtSel.value = highest.id;
    }

    // Cập nhật link tải
    const linkBase = `/download?url=${encodeURIComponent(cleaned)}`;
    const setHref = () => {
      const fid = fmtSel.value;
      dlMp4.href = fid ? `${linkBase}&format=${encodeURIComponent(fid)}` : linkBase;
    };
    setHref();
    fmtSel.onchange = setHref;

    // MP3 luôn để bestaudio
    dlMp3.href = `/audio?url=${encodeURIComponent(cleaned)}`;

    resultBox.classList.remove("hidden");
  } catch (e) {
    console.error(e);
    alert(e.message || "Phân tích thất bại.");
  } finally {
    hideLoading();
    analyzeBtn.disabled = false;
  }
});

/* rút gọn link ngay khi rời input (tùy thích) */
urlInput.addEventListener("blur", () => {
  const v = cleanUrl(urlInput.value);
  if (v) urlInput.value = v;
});
