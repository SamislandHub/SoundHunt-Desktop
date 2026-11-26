/**
 * 曲目数据模型 —— 移植自 Android 版 Track.java（纯 JS 对象 + 工厂方法）
 */
export const SOURCE_BILIBILI = 'bilibili';
export const SOURCE_AUDIUS = 'audius';

export function makeTrack(o = {}) {
  return {
    id: o.id || '',
    title: o.title || '',
    artist: o.artist || '',
    cover: o.cover || '',
    source: o.source || SOURCE_BILIBILI,
    sourceUrl: o.sourceUrl || '',
    bvid: o.bvid || '',
    previewUrl: o.previewUrl || '',
    durationMs: o.durationMs || 0,
    previewOnly: !!o.previewOnly,
    page: o.page || 0,
    cid: o.cid || 0,
    parentTitle: o.parentTitle || '',
    playCount: o.playCount || 0,
    danmakuCount: o.danmakuCount || 0,
    favoriteCount: o.favoriteCount || 0,
    likeCount: o.likeCount || 0,
    pubdate: o.pubdate || 0,
    tag: o.tag || '',
    recommendScore: 0,
    // 运行态（不持久化）
    _coverFailed: false,
  };
}

export function isCollection(t) {
  return (t.durationMs || 0) >= 8 * 60_000;
}

export function stableId(t) {
  return t.source + ':' + t.id;
}

export function sourceLabel(t) {
  return t.source === SOURCE_AUDIUS ? 'Audius' : 'B站';
}

export function isRetiredSource(source) {
  return source === 'itunes';
}

export function toJSON(t) {
  return {
    id: t.id, title: t.title, artist: t.artist, cover: t.cover,
    source: t.source, sourceUrl: t.sourceUrl, bvid: t.bvid,
    previewUrl: t.previewUrl, durationMs: t.durationMs,
    previewOnly: !!t.previewOnly, page: t.page, cid: t.cid,
    parentTitle: t.parentTitle || '', playCount: t.playCount,
    danmakuCount: t.danmakuCount, favoriteCount: t.favoriteCount,
    likeCount: t.likeCount, pubdate: t.pubdate, tag: t.tag || '',
  };
}

export function fromJSON(o) {
  return makeTrack(o);
}
