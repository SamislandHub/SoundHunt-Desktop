/**
 * 推荐引擎 —— 移植自 Android 版 RecommendEngine.java
 * 热度 + 新鲜度 + 收藏画像 + 探索 四信号打分，MMR 多样性重排，跨页去重。
 */
import { isCollection, stableId } from './Track.js';

const W_HEAT = 0.45;
const W_FRESH = 0.15;
const W_TASTE = 0.45;
const EXPLORE_WEIGHT = 0.18;
const COLLECTION_PENALTY = 0.35;
const LAMBDA = 0.85;

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function notEmpty(s) { return s != null && String(s).trim().length > 0; }
function logNorm(value, reference) {
  if (value <= 0) return 0;
  return clamp01(Math.log10(value + 1) / Math.log10(reference + 1));
}
function lower(s) { return String(s || '').toLowerCase(); }

/** 抽中文 2~4 字片段作为关键词。 */
function keywords(title) {
  const out = [];
  if (!notEmpty(title)) return out;
  let sb = '';
  const flush = () => {
    const len = sb.length;
    for (let i = 0; i + 2 <= len; i++) {
      out.push(sb.substring(i, Math.min(len, i + 3)).toLowerCase());
      if (i + 4 <= len) out.push(sb.substring(i, i + 4).toLowerCase());
    }
    sb = '';
  };
  for (const ch of title) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) sb += ch;
    else flush();
  }
  flush();
  return out;
}

function bump(map, key, amount) {
  if (!notEmpty(key)) return;
  map.set(key, (map.get(key) || 0) + amount);
}
function normalize(map, n) {
  if (!map.size || n <= 0) return;
  for (const [k, v] of map) map.set(k, clamp01(v / n));
}

export class RecommendEngine {
  constructor() {
    this.artistTaste = new Map();
    this.tagTaste = new Map();
    this.keywordTaste = new Map();
    this.profileReady = false;
    this.sessionSeen = new Set();
  }

  buildProfile(favorites) {
    this.artistTaste.clear();
    this.tagTaste.clear();
    this.keywordTaste.clear();
    let n = 0;
    if (favorites) {
      for (const t of favorites) {
        if (!t) continue;
        n++;
        if (notEmpty(t.artist)) bump(this.artistTaste, lower(t.artist), 1.0);
        if (notEmpty(t.tag)) {
          for (const tag of String(t.tag).split(/\s+/)) {
            if (tag.length >= 2) bump(this.tagTaste, lower(tag), 0.7);
          }
        }
        for (const kw of keywords(t.title)) bump(this.keywordTaste, kw, 0.5);
      }
      normalize(this.artistTaste, n);
      normalize(this.tagTaste, n);
      normalize(this.keywordTaste, n);
    }
    this.profileReady = this.artistTaste.size > 0 || this.tagTaste.size > 0 || this.keywordTaste.size > 0;
  }

  hasProfile() { return this.profileReady; }
  markSeen(tracks) { if (tracks) for (const t of tracks) this.sessionSeen.add(stableId(t)); }
  clearSession() { this.sessionSeen.clear(); }

  rank(candidates, count) {
    if (!candidates || !candidates.length || count <= 0) return [];
    const unique = new Map();
    for (const t of candidates) {
      if (!t) continue;
      const id = stableId(t);
      if (this.sessionSeen.has(id)) continue;
      if (!unique.has(id)) unique.set(id, t);
    }
    if (!unique.size) return [];

    const pool = [];
    const nowSec = Math.floor(Date.now() / 1000);
    for (const t of unique.values()) {
      const heat = this.heatScore(t);
      const fresh = this.freshnessScore(t, nowSec);
      const taste = this.tasteScore(t);
      const explore = Math.random() * EXPLORE_WEIGHT;
      const penalty = isCollection(t) ? COLLECTION_PENALTY : 0;
      const total = heat * W_HEAT + fresh * W_FRESH + taste * W_TASTE
        + explore + this.qualityFloor(t) - penalty;
      t.recommendScore = total;
      pool.push({ track: t, heat, fresh, taste, total });
    }

    const selected = [];
    const artistCount = new Map();
    const tagCount = new Map();
    const want = Math.min(count, pool.length);
    while (selected.length < want && pool.length) {
      let best = null;
      let bestMmr = -Infinity;
      for (const s of pool) {
        const diversity = this.diversityPenalty(s, artistCount, tagCount);
        const mmr = s.total - LAMBDA * diversity;
        if (mmr > bestMmr) { bestMmr = mmr; best = s; }
      }
      if (!best) break;
      selected.push(best);
      pool.splice(pool.indexOf(best), 1);
      this.account(best.track, artistCount, tagCount);
    }
    const out = selected.map((s) => s.track);
    this.markSeen(out);
    return out;
  }

  heatScore(t) {
    const p = logNorm(t.playCount, 20_000_000);
    const l = logNorm(t.likeCount, 500_000);
    const f = logNorm(t.favoriteCount, 300_000);
    const d = logNorm(t.danmakuCount, 1_000_000);
    return clamp01(p * 0.40 + l * 0.28 + f * 0.20 + d * 0.12);
  }

  freshnessScore(t, nowSec) {
    if (!t.pubdate || t.pubdate <= 0) return 0.5;
    const age = nowSec - t.pubdate;
    if (age < 0) return 0.6;
    const years = age / (365 * 24 * 3600);
    if (years <= 0.05) return 1.0;
    if (years >= 2) return 0.3;
    return 1.0 - (years - 0.05) / 1.95 * 0.7;
  }

  tasteScore(t) {
    if (!this.profileReady) return 0;
    let score = 0;
    if (notEmpty(t.artist)) {
      const v = this.artistTaste.get(lower(t.artist));
      if (v != null) score += v * 1.0;
    }
    if (notEmpty(t.tag)) {
      for (const tag of String(t.tag).split(/\s+/)) {
        const v = this.tagTaste.get(lower(tag));
        if (v != null) score += v * 0.35;
      }
    }
    for (const kw of keywords(t.title)) {
      const v = this.keywordTaste.get(kw);
      if (v != null) score += v * 0.3;
    }
    return clamp01(score);
  }

  qualityFloor(t) {
    if (!t.playCount && !t.likeCount && !t.favoriteCount) return 0.05;
    return 0;
  }

  diversityPenalty(s, artistCount, tagCount) {
    let penalty = 0;
    const artist = lower(s.track.artist || '');
    if (artist && artistCount.has(artist)) penalty += 0.9 + 0.3 * artistCount.get(artist);
    if (notEmpty(s.track.tag)) {
      for (const tag of String(s.track.tag).split(/\s+/)) {
        const c = tagCount.get(lower(tag));
        if (c != null) penalty += Math.min(0.5, 0.15 * c);
      }
    }
    return penalty;
  }

  account(t, artistCount, tagCount) {
    const artist = lower(t.artist || '');
    if (artist) artistCount.set(artist, (artistCount.get(artist) || 0) + 1);
    if (notEmpty(t.tag)) {
      for (const tag of String(t.tag).split(/\s+/)) {
        const k = lower(tag);
        tagCount.set(k, (tagCount.get(k) || 0) + 1);
      }
    }
  }
}
