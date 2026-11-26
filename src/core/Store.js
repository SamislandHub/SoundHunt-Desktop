/**
 * 本地持久化 —— 收藏、设置、音质偏好、缓存目录
 * 用 electron-store 风格的 JSON 文件（无第三方依赖，node:fs）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { toJSON, fromJSON, isRetiredSource } from './Track.js';

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'soundhunt-data.json');
    this.cacheDir = path.join(dataDir, 'audio-cache');
    this.coverDir = path.join(dataDir, 'cover-cache');
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.mkdirSync(this.coverDir, { recursive: true });
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) { /* 损坏则重建 */ }
    return { favorites: [], quality: 30232, theme: 'dark', playMode: 'random' };
  }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) { console.error('保存失败', e); }
  }

  // ---- 收藏 ----
  favorites() {
    return (this.data.favorites || [])
      .map(fromJSON)
      .filter((t) => !isRetiredSource(t.source));
  }
  setFavorites(tracks) {
    this.data.favorites = tracks.map(toJSON);
    this.save();
  }
  isFavorite(track) {
    return (this.data.favorites || []).some((o) => o.source === track.source && o.id === track.id);
  }
  toggleFavorite(track) {
    const arr = this.data.favorites || [];
    const idx = arr.findIndex((o) => o.source === track.source && o.id === track.id);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.unshift(toJSON(track));
    this.data.favorites = arr;
    this.save();
    return idx < 0; // true=已收藏
  }

  // ---- 设置 ----
  get(key, fallback) {
    return this.data[key] !== undefined ? this.data[key] : fallback;
  }
  set(key, value) {
    this.data[key] = value;
    this.save();
  }
}
