// videoplaster/js/background.js
const TITLE = "VIDEOPLASTER 02";
const SUBTITLE = "armandofrezzedurand.com";

// aspect-fill (cover): preserve source aspect while covering W x H. (v11 drawSource math)
export function fitDims(sw, sh, W, H) {
  const ar = sw / sh, cAr = W / H;
  return ar > cAr ? { dw: H * ar, dh: H } : { dw: W, dh: W / ar };
}

export class BackgroundCanvas {
  constructor(w, h) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d");
    this.img = null; this.video = null; this.hasMedia = false;
    this.scaleX = 1; this.scaleY = 1; this.rot = 0;
  }
  resize(w, h) { this.canvas.width = w; this.canvas.height = h; }
  loadFile(file) {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
      if (this.video) { this.video.pause(); this.video.src = ""; }
      const v = document.createElement("video");
      v.src = url; v.loop = true; v.muted = true; v.playsInline = true; v.play();
      this.video = v; this.img = null; this.hasMedia = true;
    } else {
      const i = new Image();
      i.onload = () => { this.img = i; this.video = null; this.hasMedia = true; };
      i.src = url;
    }
  }
  clear() { this.img = null; if (this.video) { this.video.pause(); } this.video = null; this.hasMedia = false; }
  setTransform({ scaleX, scaleY, rot }) {
    if (scaleX !== undefined) this.scaleX = scaleX;
    if (scaleY !== undefined) this.scaleY = scaleY;
    if (rot !== undefined) this.rot = rot;
  }
  draw() {
    const W = this.canvas.width, H = this.canvas.height, ctx = this.ctx;
    const media = this.video || this.img;
    const ready = media && (this.video ? this.video.readyState >= 2 : true);
    if (this.hasMedia && ready) {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(this.rot * Math.PI / 180);
      ctx.scale(this.scaleX, this.scaleY);
      const sw = media.videoWidth || media.naturalWidth || W;
      const sh = media.videoHeight || media.naturalHeight || H;
      const { dw, dh } = fitDims(sw, sh, W, H);
      ctx.drawImage(media, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    } else {
      this._drawDefault(W, H);
    }
    return this.canvas;
  }
  _drawDefault(W, H) {
    const ctx = this.ctx;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.65)"; ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // L-shaped registration brackets in the 4 corners
    const b = 22; ctx.lineWidth = 1.5;
    const bracket = (cx, cy, dx, dy) => { ctx.beginPath(); ctx.moveTo(cx + dx * b, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * b); ctx.stroke(); };
    bracket(0, 0, 1, 1); bracket(W, 0, -1, 1); bracket(W, H, -1, -1); bracket(0, H, 1, -1);
    // center title
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = "bold 15px monospace";
    ctx.fillText(TITLE, W / 2, H / 2 - 8);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "10px monospace";
    ctx.fillText(SUBTITLE, W / 2, H / 2 + 12);
  }
}
