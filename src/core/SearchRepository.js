/**
 * 搜索与推荐编排 —— 移植自 Android 版 SearchRepository.java
 */
import { BiliClient } from './BiliClient.js';
import { RecommendEngine } from './RecommendEngine.js';
import { stableId } from './Track.js';

const TRENDING_QUERIES = [
  '抖音热歌 歌曲', '华语流行 歌曲', '经典老歌 金曲', '网络热歌 新歌',
  '古风 歌曲', '说唱 rap 歌曲', '摇滚 歌曲', '民谣 歌曲',
  '轻音乐 纯音乐', '粤语歌 经典', '英文歌 热门', '影视 OST 主题曲',
  '电子音乐 EDM', '周杰伦 歌曲', '热门 BGM 背景音乐', '治愈 歌曲',
];
const TRENDING_SIZE = 12;
const QUERIES_PER_PAGE = 3;

function dedupe(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const id = stableId(t);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
}

export class SearchRepository {
  constructor() {
    this.bili = new BiliClient();
    this.engine = new RecommendEngine();
    this.queryCursor = 0;
    this.pagePerQuery = 1;
    this.busy = false;
  }

  async search(query) {
    const result = { tracks: [], errors: [] };
    try {
      result.tracks = await this.bili.search(query);
    } catch (e) {
      result.errors.push('B站搜索暂时不可用：' + e.message);
    }
    result.tracks = dedupe(result.tracks);
    return result;
  }

  refreshProfile(favorites) { this.engine.buildProfile(favorites); }
  resetFeedSession() {
    this.engine.clearSession();
    this.queryCursor = 0;
    this.pagePerQuery = 1;
  }

  async trending() {
    if (this.busy) return { tracks: [], errors: [] };
    this.busy = true;
    try {
      const result = { tracks: [], errors: [] };
      const batch = [];
      for (let i = 0; i < QUERIES_PER_PAGE; i++) {
        batch.push(TRENDING_QUERIES[this.queryCursor % TRENDING_QUERIES.length]);
        this.queryCursor++;
      }
      const page = this.pagePerQuery++;
      const settled = await Promise.all(batch.map((q) => this.bili.search(q, page).catch(() => null)));
      const groups = settled.map((g, i) => {
        if (!g) { result.errors.push('B站推荐暂时不可用'); return []; }
        return g;
      });
      // 交错合并，保证单页内也混合不同主题
      const seenThisPage = new Map();
      let longest = 0;
      for (const g of groups) longest = Math.max(longest, g.length);
      for (let i = 0; i < longest; i++) {
        for (const g of groups) {
          if (i >= g.length) continue;
          const t = g[i];
          const id = stableId(t);
          if (!seenThisPage.has(id)) seenThisPage.set(id, t);
        }
      }
      result.tracks = this.engine.rank([...seenThisPage.values()], TRENDING_SIZE);
      if (!result.tracks.length) result.errors.push('推荐源暂时离线');
      return result;
    } finally {
      this.busy = false;
    }
  }

  async expand(track) {
    try { return await this.bili.expand(track); } catch (e) { return null; }
  }
}
