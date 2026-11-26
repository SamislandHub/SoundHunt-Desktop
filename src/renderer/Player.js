/** 播放内核（渲染进程）—— 移植 Android MusicService 的播放算法设计 */

export class Player {
  constructor(api, onState) {
    this.api = api;
    this.onState = onState || (() => {});
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.queue = [];
    this.index = -1;
    this.queueSource = 'feed';
    this.playing = false;
    this.quality = 30232;
    this.candidates = [];
    this.candidateIndex = 0;
    this.requestSerial = 0;
    this.proxyPort = 0;
    this.pendingSeekMs = 0;
    this.repeat = false;
    this.autoFailures = 0;

    this.audio.addEventListener('timeupdate', () => this.onState('progress'));
    this.audio.addEventListener('play', () => { this.playing = true; this.onState('play'); });
    this.audio.addEventListener('pause', () => { this.playing = false; this.onState('pause'); });
    this.audio.addEventListener('ended', () => this.next(true));
    this.audio.addEventListener('error', () => this._onError());
  }

  setProxyPort(p) { this.proxyPort = p; }
  setQuality(q) { this.quality = q; }

  current() { return this.index >= 0 ? this.queue[this.index] : null; }
  getPosition() { return Math.floor((this.audio.currentTime || 0) * 1000); }
  getDuration() { return Math.floor((this.audio.duration || 0) * 1000) || (this.current()?.durationMs || 0); }

  playQueue(tracks, index = 0, source = 'feed') {
    this.queue = tracks || [];
    this.index = index;
    this.queueSource = source;
    this.playAt(index);
  }
  appendQueue(tracks) { if (tracks && tracks.length) this.queue.push(...tracks); }

  async playAt(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.index = index;
    this.autoFailures = 0;
    await this._loadCurrent(true);
  }

  async _loadCurrent(autoPlay = true) {
    const t = this.current();
    if (!t) return;
    const serial = ++this.requestSerial;
    const r = await this.api.playurl(t, this.quality);
    if (!r.ok || serial !== this.requestSerial) return;
    if (r.data.cid && !t.cid) t.cid = r.data.cid;
    this.candidates = (r.data.urls || []).map((u) => this._proxyUrl(u));
    this.candidateIndex = 0;
    this.lastQualityLabel = r.data.label;
    this.audio.src = this.candidates[0] || '';
    if (this.pendingSeekMs > 0) {
      this.audio.addEventListener('loadedmetadata', () => {
        try { this.audio.currentTime = this.pendingSeekMs / 1000; } catch (e) {}
        this.pendingSeekMs = 0;
      }, { once: true });
    }
    if (autoPlay) this.audio.play().catch(() => {});
    this.onState('track');
    this._prefetchNeighbors();
  }

  _proxyUrl(u) {
    if (!this.proxyPort) return u;
    return `http://127.0.0.1:${this.proxyPort}/audio?u=` + encodeURIComponent(u);
  }

  async _onError() {
    // 多线路容错：逐条尝试候选地址
    if (this.candidateIndex < this.candidates.length - 1) {
      this.candidateIndex++;
      this.audio.src = this.candidates[this.candidateIndex];
      this.audio.play().catch(() => {});
      return;
    }
    // 所有线路失败：自动跳下一首（有限次，防死循环）
    if (this.autoFailures < this.queue.length) {
      this.autoFailures++;
      await this.next(true);
    }
  }

  toggle() { if (this.playing) this.pause(); else this.resume(); }
  pause() { this.audio.pause(); }
  resume() { if (!this.audio.src) { this._loadCurrent(true); return; } this.audio.play().catch(() => {}); }

  async next(auto = false) {
    if (!this.queue.length) return;
    let ni = this.index + 1;
    if (ni >= this.queue.length) {
      if (this.repeat) ni = 0;
      else { this.pause(); return; }
    }
    await this.playAt(ni);
  }
  async previous() {
    if (!this.queue.length) return;
    // 播放超过 5s 时，上一首先回到开头
    if (this.getPosition() > 5000) { this.seekTo(0); return; }
    let pi = this.index - 1;
    if (pi < 0) pi = this.repeat ? this.queue.length - 1 : 0;
    await this.playAt(pi);
  }

  seekTo(ms) { try { this.audio.currentTime = ms / 1000; } catch (e) {} }

  async switchQuality(q) {
    const pos = this.getPosition();
    const wasPlaying = this.playing;
    this.quality = q;
    this.pendingSeekMs = pos;
    await this._loadCurrent(wasPlaying);
  }

  toggleRepeat() { this.repeat = !this.repeat; return this.repeat; }

  _prefetchNeighbors() {
    // 预取上下首的播放地址（不让浏览器立刻加载音频，只解析地址备用）
    // 桌面版用 <audio preload> 由浏览器管理，这里仅做轻量地址缓存占位
  }
}

export function fmtTime(ms) {
  if (!ms || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
