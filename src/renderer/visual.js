/** 自绘视觉：黑胶唱片（跟随能量旋转）+ 声波波形 —— 移植 VinylDiscView / WaveView 的算法思路 */

export class VinylView {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.angle = 0;
    this.energy = 0;
    this.targetEnergy = 0;
    this.playing = false;
    this.bands = { bass: 0, mid: 0, hi: 0 };
    this.last = performance.now();
    this.coverImg = null;
  }

  setCover(url) {
    if (!url) { this.coverImg = null; return; }
    const img = new Image();
    img.onload = () => { this.coverImg = img; };
    img.src = url;
  }
  setBands(bass, mid, hi) { this.bands = { bass, mid, hi }; }
  setPlaying(p) { this.playing = p; }

  tick(now) {
    const dt = Math.min(50, now - this.last) / 1000;
    this.last = now;
    // 能量平滑：上升快、回落慢
    this.targetEnergy = this.playing ? Math.min(1, this.bands.bass * 0.7 + this.bands.mid * 0.3 + 0.12) : 0;
    const tau = this.targetEnergy > this.energy ? 0.09 : 0.26;
    this.energy += (this.targetEnergy - this.energy) * (1 - Math.exp(-dt / tau));
    // 转速：基础 + 能量，节拍兜底 100BPM
    const baseRpm = this.playing ? 33 + this.energy * 45 : 0;
    const beatBoost = this.playing && this.bands.bass > 0.7 ? 6 : 0;
    this.angle += (baseRpm + beatBoost) * 6 * dt;
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const S = this.c.width, R = S / 2, cx = R, cy = R;
    ctx.clearRect(0, 0, S, S);

    // 唱片外圈金边
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((this.angle * Math.PI) / 180);
    // 盘面
    const g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
    g.addColorStop(0, '#1a1c22'); g.addColorStop(0.5, '#0d0f13'); g.addColorStop(1, '#16181e');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.98, 0, Math.PI * 2); ctx.fill();
    // 纹路
    ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
    for (let r = R * 0.34; r < R * 0.96; r += 4) {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    }
    // 扫光
    const sweep = ctx.createLinearGradient(-R, -R, R, R);
    sweep.addColorStop(0, 'rgba(255,255,255,0)');
    sweep.addColorStop(0.45, 'rgba(255,255,255,0)');
    sweep.addColorStop(0.5, `rgba(255,255,255,${0.06 + this.energy * 0.08})`);
    sweep.addColorStop(0.55, 'rgba(255,255,255,0)');
    ctx.fillStyle = sweep;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.96, 0, Math.PI * 2); ctx.fill();

    // 封面标签（旋转）
    const lr = R * 0.32;
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, lr, 0, Math.PI * 2); ctx.clip();
    if (this.coverImg) {
      ctx.drawImage(this.coverImg, -lr, -lr, lr * 2, lr * 2);
    } else {
      const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, lr);
      lg.addColorStop(0, '#c99b34'); lg.addColorStop(1, '#8a6a1f');
      ctx.fillStyle = lg; ctx.fillRect(-lr, -lr, lr * 2, lr * 2);
    }
    ctx.restore();
    // 标签金边
    ctx.strokeStyle = 'rgba(227,179,65,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, lr, 0, Math.PI * 2); ctx.stroke();
    // 外金环
    ctx.strokeStyle = 'rgba(227,179,65,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.97, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

export class WaveView {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.energy = 0;
    this.playing = false;
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
    const n = 60;
    const cy = this.h * 0.8;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const x = (i / n) * this.w + Math.sin(i * 1.7) * 4;
      const amp = (0.3 + 0.7 * Math.abs(Math.sin(i * 0.4 + performance.now() / 300))) * this.energy;
      const h = 8 + amp * 90;
      const grad = ctx.createLinearGradient(0, cy - h, 0, cy);
      grad.addColorStop(0, 'rgba(227,179,65,0)');
      grad.addColorStop(1, `rgba(244,217,138,${0.15 + amp * 0.3})`);
      ctx.fillStyle = grad;
      ctx.fillRect(x - 2, cy - h, 4, h);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
