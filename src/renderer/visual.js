/** 自绘黑胶 —— 严格按 Android VinylDiscView 六层算法移植（视觉）
 *  1 石墨灰径向盘面  2 46圈沟槽  3 抛光金环  4 旋转反光带
 *  5 中心标签(封面/琥珀+音符)  6 标签金边
 *  转速：桌面版没有真实音频频谱（B站音频跨域，AnalyserNode 取不到数据），
 *  改用内部节拍时钟驱动——每拍一个能量脉冲(快升慢降)，转速在慢基准与拍点峰值间
 *  波动；BPM 与旋律包络由曲目派生，做到「按节拍/音调转」，暂停缓缓停下。
 */

const hex = (r, g, b, a = 1) => `rgba(${r},${g},${b},${a})`;

const BASE_DPS = 18;   // 慢基准：≈20 秒/圈（唱片idle时的匀速）
const PEAK_DPS = 92;   // 拍点峰值：拍击瞬间叠加，≈6.5 秒/圈；远低于原 150
const BEAT_BASE_BPM = 76; // 基准节拍，按曲目派生 68~104 BPM

export class VinylView {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.angle = 0;
    this.energy = 0;
    this.targetEnergy = 0;
    this.curDps = 0;
    this.playing = false;
    this.bands = { bass: 0, mid: 0, hi: 0 };
    this.last = performance.now();
    this.beatT0 = this.last;       // 节拍时钟起点
    this.bpm = BEAT_BASE_BPM;
    this.beatMs = 60000 / this.bpm;
    this.phrase = 4;               // 每 4 拍一个乐句包络
    this.coverImg = null;
    this.dpr = canvas.width / 760;
  }

  /** 每首曲子派生不同的节拍速度与旋律包络，让转速跟着「节拍+音调」变化 */
  setTrack(id) {
    let h = 0;
    const s = String(id || 'soundhunt');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    this.bpm = BEAT_BASE_BPM - 8 + (h % 37);          // 68 ~ 104 BPM
    this.beatMs = 60000 / this.bpm;
    this.phrase = 3 + (h % 5);                         // 3~7 拍一循环的音调起伏
    this.melodySeed = ((h >>> 8) % 100) / 100;
  }

  setCover(url) {
    if (!url) { this.coverImg = null; return; }
    if (this._url === url) return;
    this._url = url;
    const img = new Image();
    img.onload = () => { this.coverImg = img; };
    img.src = url;
  }
  // 保留接口兼容（如需接入真实频谱），但桌面版不主动喂入
  setBands(bass, mid, hi) { this.bands = { bass, mid, hi }; }
  setPlaying(p) { if (p && !this.playing) this.beatT0 = performance.now(); this.playing = p; }

  tick(now) {
    let dt = now - this.last; this.last = now;
    if (dt <= 0) dt = 16;
    dt = Math.min(dt, 100);

    if (this.playing) {
      // 节拍时钟：当前时刻落在第几拍、拍内相位 0..1
      const beatF = (now - this.beatT0) / this.beatMs;
      const beatIdx = Math.floor(beatF);
      const phase = beatF - beatIdx;             // 0=拍点
      // 拍击脉冲：拍点给满能量，随后指数衰减（快升慢降）
      const kick = Math.exp(-phase * 4.5);
      // 音调包络：每 phrase 拍一个强-弱的缓慢起伏，让不同乐句转速有高低
      const melodic = 0.62 + 0.38 * Math.abs(Math.sin((beatIdx / this.phrase + this.melodySeed) * Math.PI));
      this.targetEnergy = Math.max(0, Math.min(1, kick * melodic));
    } else {
      this.targetEnergy = 0;
    }
    // 能量平滑：上升快、回落慢（Android 同款 tau）
    const tau = this.targetEnergy > this.energy ? 90 : 260;
    this.energy += (this.targetEnergy - this.energy) * Math.min(1, dt / tau);
    const targetDps = this.playing ? (BASE_DPS + (PEAK_DPS - BASE_DPS) * this.energy) : 0;
    this.curDps += (targetDps - this.curDps) * Math.min(1, dt / 180);
    if (Math.abs(this.curDps) > 0.05) {
      this.angle = (this.angle + this.curDps * dt / 1000) % 360;
    }
    this.draw();
  }

  /** 香槟金 ScatterGradient：两处对称高光 */
  metalGold(ctx, cx, cy, r) {
    const g = ctx.createConicGradient(0, cx, cy);
    const stops = [
      [0.00, hex(148,110,58)], [0.12, hex(206,167,101)], [0.20, hex(255,243,210)],
      [0.30, hex(206,167,101)], [0.42, hex(148,110,58)], [0.55, hex(206,167,101)],
      [0.63, hex(255,243,210)], [0.72, hex(206,167,101)], [0.85, hex(148,110,58)],
      [1.00, hex(148,110,58)]
    ];
    for (const [p, c] of stops) g.addColorStop(p, c);
    return g;
  }

  draw() {
    const ctx = this.ctx;
    const S = this.c.width;
    const cx = S / 2, cy = S / 2;
    const dp = this.dpr; // 1 逻辑 dp 对应的像素
    const R = Math.min(cx, cy) - 6 * dp;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angle * Math.PI / 180);

    // 1. 黑胶盘面：中心略亮石墨灰 → 外近黑
    const g = ctx.createRadialGradient(0, 0, R * 0.05, 0, 0, R);
    g.addColorStop(0, hex(29,29,32)); g.addColorStop(0.62, hex(19,19,22)); g.addColorStop(1, hex(14,14,16));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();

    // 2. 46 圈沟槽
    ctx.lineWidth = 0.7 * dp;
    for (let i = 0; i < 46; i++) {
      const rr = R * (0.455 + 0.505 * i / 46);
      ctx.strokeStyle = i % 2 === 0 ? hex(255,255,255,13/255) : hex(0,0,0,9/255);
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
    }

    // 3. 外圈金环
    ctx.lineWidth = 3.2 * dp;
    ctx.strokeStyle = hex(26,20,13,210/255);
    ctx.beginPath(); ctx.arc(0, 0, R - 1.6 * dp, 0, Math.PI * 2); ctx.stroke();
    const rimR = R - 1.6 * dp;
    ctx.lineWidth = 1.9 * dp; ctx.strokeStyle = this.metalGold(ctx, 0, 0, rimR);
    ctx.beginPath(); ctx.arc(0, 0, rimR, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 0.6 * dp; ctx.strokeStyle = this.metalGold(ctx, 0, 0, rimR);
    ctx.beginPath(); ctx.arc(0, 0, rimR + 0.9 * dp, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 0.8 * dp; ctx.strokeStyle = hex(255,255,255,20/255);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2); ctx.stroke();

    // 4. 旋转反光带
    const sweep = ctx.createConicGradient(0, 0, 0);
    const sb = [
      [0.00, hex(255,244,220,0)], [0.10, hex(255,244,220,0)], [0.16, hex(255,244,220,62/255)],
      [0.24, hex(255,244,220,0)], [0.50, hex(255,244,220,0)], [0.58, hex(255,244,220,0)],
      [0.66, hex(255,244,220,30/255)], [0.74, hex(255,244,220,0)], [1.00, hex(255,244,220,0)]
    ];
    for (const [p, c] of sb) sweep.addColorStop(p, c);
    ctx.fillStyle = sweep;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.99, 0, Math.PI * 2); ctx.fill();

    // 5. 中心标签
    const lr = R * 0.43;
    if (this.coverImg) {
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, lr, 0, Math.PI * 2); ctx.clip();
      const side = Math.min(this.coverImg.width, this.coverImg.height);
      const sc = (lr * 2) / Math.max(1, side);
      const dw = this.coverImg.width * sc, dh = this.coverImg.height * sc;
      ctx.drawImage(this.coverImg, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    } else {
      const lg = ctx.createRadialGradient(-lr * 0.3, -lr * 0.3, 0, -lr * 0.3, -lr * 0.3, lr * 1.4);
      lg.addColorStop(0, hex(244,208,148)); lg.addColorStop(0.55, hex(184,132,60)); lg.addColorStop(1, hex(58,40,20));
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(0, 0, lr, 0, Math.PI * 2); ctx.fill();
      this.drawNote(ctx, lr * 0.42);
    }

    // 6. 标签金边
    ctx.lineWidth = 2.6 * dp; ctx.strokeStyle = hex(26,20,13,210/255);
    ctx.beginPath(); ctx.arc(0, 0, lr - 0.4 * dp, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5 * dp; ctx.strokeStyle = this.metalGold(ctx, 0, 0, lr);
    ctx.beginPath(); ctx.arc(0, 0, lr - 0.4 * dp, 0, Math.PI * 2); ctx.stroke();

    ctx.restore();
  }

  drawNote(ctx, s) {
    ctx.fillStyle = hex(36,26,12,190/255);
    ctx.beginPath();
    ctx.ellipse(-s * 0.33, s * 0.51, s * 0.47, s * 0.35, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(s * 0.02, -s * 0.92, s * 0.2, s * 1.46);
    ctx.beginPath();
    ctx.moveTo(s * 0.22, -s * 0.92);
    ctx.quadraticCurveTo(s * 1.02, -s * 0.60, s * 0.78, s * 0.06);
    ctx.lineTo(s * 0.58, -s * 0.14);
    ctx.quadraticCurveTo(s * 0.74, -s * 0.54, s * 0.22, -s * 0.60);
    ctx.closePath(); ctx.fill();
  }
}

/** 声波波形（保留兼容，未启用） */
export class WaveView {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.particles = []; this.energy = 0; this.playing = false;
  }
  setPlaying(p) { this.playing = p; }
  setEnergy(e) { this.energy = e; }
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.c.getBoundingClientRect();
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
  }
  tick() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.playing) return;
    const n = 60, cy = this.h * 0.8;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const x = (i / n) * this.w + Math.sin(i * 1.7) * 4;
      const amp = (0.3 + 0.7 * Math.abs(Math.sin(i * 0.4 + performance.now() / 300))) * this.energy;
      const h = 8 + amp * 90;
      const grad = ctx.createLinearGradient(0, cy - h, 0, cy);
      grad.addColorStop(0, 'rgba(227,179,106,0)');
      grad.addColorStop(1, `rgba(244,217,138,${0.15 + amp * 0.3})`);
      ctx.fillStyle = grad; ctx.fillRect(x - 2, cy - h, 4, h);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
