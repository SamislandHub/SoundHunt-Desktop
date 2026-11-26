/**
 * B站接口客户端 —— 移植自 Android 版 BiliClient.java
 * 用 Node 内置 https 请求（主进程跑），wbi 签名 / 搜索 / 播放地址 / 合集展开 / 标题清洗逐行对齐。
 */
import https from 'node:https';
import crypto from 'node:crypto';
import { makeTrack, SOURCE_BILIBILI } from './Track.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';
const COOKIE = 'buvid3=8F2A4C1E-1234-4A5B-9C6D-7E8F9A0B1C2Dinfoc';

export const QUALITY_64K = 30216;
export const QUALITY_132K = 30232;
export const QUALITY_FLAC = 30280;

export function qualityLabel(id) {
  if (id === QUALITY_64K) return '64K';
  if (id === QUALITY_FLAC) return '无损 FLAC';
  return '高清 132K';
}

export function audioHeaders() {
  return { 'User-Agent': UA, Referer: REFERER, Origin: 'https://www.bilibili.com' };
}

/** HTTP GET，返回 JSON。strict=false 时不校验业务 code（nav 未登录返回 -101 但 wbi_img 有效）。 */
function getJson(url, strict = true) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': UA, Referer: REFERER, Origin: 'https://www.bilibili.com',
        Cookie: COOKIE, Accept: 'application/json', 'Accept-Encoding': 'identity',
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('HTTP ' + res.statusCode));
        }
        try {
          const json = JSON.parse(body);
          if (strict && (json.code ?? -1) !== 0) {
            return reject(new Error('B站接口：' + (json.message || '请求失败')));
          }
          resolve(json);
        } catch (e) {
          reject(new Error('JSON 解析失败: ' + e.message));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

function readBody(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, Referer: REFERER, Origin: 'https://www.bilibili.com', ...headers },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}
export { readBody };

function clean(value) {
  if (value == null) return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

const TITLE_TAIL = /[\s\-—_|｜]*(歌词版|纯享|分集播放|持续更新|值得收藏|已打包|可下载|无损音质|Hi-Res|HiRes|高品质|顶级文案|录音棚|\d+\s*首)[\s\S]*$/i;

function cleanTitle(value) {
  const raw = clean(value);
  let s = raw.replace(/【[^】]*】/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  s = s.replace(/（[^）]*）/g, ' ');
  s = s.replace(TITLE_TAIL, ' ');
  s = s.replace(/\s+/g, ' ').replace(/^[\s\-—_|｜,，、.。]+|[\s\-—_|｜,，、.。]+$/g, '').trim();
  return s.length >= 2 ? s : raw;
}

function durationMs(value) {
  if (!value) return 0;
  const parts = String(value).split(':');
  let s = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) return 0;
    s = s * 60 + n;
  }
  return s * 1000;
}

function count(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number') return Math.floor(raw);
  let s = String(raw).trim().replace(/,/g, '');
  if (!s) return 0;
  let factor = 1;
  if (s.endsWith('万')) { factor = 10000; s = s.slice(0, -1); }
  else if (s.endsWith('亿')) { factor = 100000000; s = s.slice(0, -1); }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.floor(n * factor) : 0;
}

function httpsUrl(value) {
  if (!value) return '';
  if (value.startsWith('//')) return 'https:' + value;
  return value.replace(/^http:\/\//, 'https://');
}

// ---------------- wbi 签名 ----------------
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

let mixinKey = null;
let mixinKeyAt = 0;

function fileNameKey(url) {
  if (!url) return '';
  const name = url.substring(url.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(0, dot) : name;
}

async function getMixinKey() {
  const now = Date.now();
  if (mixinKey && now - mixinKeyAt < 12 * 3600_000) return mixinKey;
  const data = (await getJson('https://api.bilibili.com/x/web-interface/nav', false)).data;
  const wbi = data.wbi_img || {};
  let imgKey = wbi.img_key || '';
  let subKey = wbi.sub_key || '';
  if (!imgKey) imgKey = fileNameKey(wbi.img_url || '');
  if (!subKey) subKey = fileNameKey(wbi.sub_url || '');
  if (!imgKey || !subKey) throw new Error('wbi key 获取失败');
  const both = imgKey + subKey;
  let sb = '';
  for (let i = 0; i < 54; i++) sb += both.charAt(MIXIN_TAB[i]);
  mixinKey = sb;
  mixinKeyAt = now;
  return mixinKey;
}

function urlEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '%20');
}

function md5Hex(value) {
  return crypto.createHash('md5').update(value, 'utf8').digest('hex');
}

async function signWbi(params) {
  const key = await getMixinKey();
  const sorted = Object.keys(params).sort();
  sorted.push('wts');
  params.wts = String(Math.floor(Date.now() / 1000));
  const pairs = [];
  for (const k of sorted) {
    const value = String(params[k]).replace(/[!'()*]/g, '');
    pairs.push(urlEncode(k) + '=' + urlEncode(value));
  }
  const query = pairs.join('&');
  const wrid = md5Hex(query + key);
  return query + '&w_rid=' + wrid;
}

export class BiliClient {
  async search(query, page = 1) {
    const params = {
      search_type: 'video',
      page: String(Math.max(1, page)),
      page_size: '20',
      keyword: query,
    };
    const queryStr = await signWbi(params);
    const data = (await getJson('https://api.bilibili.com/x/web-interface/search/type?' + queryStr)).data;
    const result = data.result || [];
    const tracks = [];
    for (const item of result) {
      if (item.type && item.type !== 'video') continue;
      const bvid = item.bvid || '';
      if (!bvid) continue;
      const t = makeTrack({
        id: bvid, bvid,
        title: cleanTitle(item.title || ''),
        artist: clean(item.author || ''),
        cover: httpsUrl(item.pic || ''),
        durationMs: durationMs(item.duration || ''),
        source: SOURCE_BILIBILI,
        sourceUrl: 'https://www.bilibili.com/video/' + bvid,
        playCount: count(item.play),
        danmakuCount: count(item.review),
        favoriteCount: count(item.favorites),
        likeCount: count(item.like),
        pubdate: Number(item.pubdate) || 0,
        tag: clean(item.tag || ''),
      });
      tracks.push(t);
    }
    return tracks;
  }

  /** 播放地址：命中目标音质档优先，缺失回退最高档；返回多个容错线路。 */
  async playCandidates(track, targetQuality) {
    let cid = track.cid || 0;
    if (!cid) {
      const view = (await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + track.bvid)).data;
      cid = view.cid || 0;
      if (!cid && view.pages && view.pages.length) cid = view.pages[0].cid || 0;
    }
    if (!cid) throw new Error('无法读取视频分集');
    const playUrl = 'https://api.bilibili.com/x/player/playurl?bvid=' + track.bvid +
      '&cid=' + cid + '&qn=0&fnver=0&fnval=16&fourk=1';
    let play = null, lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        play = (await getJson(playUrl)).data;
        break;
      } catch (e) {
        lastErr = e;
        // 限流 / 临时错误：退避后重试
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    if (!play) throw lastErr || new Error('播放地址请求失败');
    const audio = play.dash && Array.isArray(play.dash.audio) ? play.dash.audio : null;
    if (!audio || audio.length === 0) throw new Error('该内容暂无公开音频流');
    const sorted = [...audio].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
    let chosen = sorted.find((s) => (s.id || 0) === targetQuality);
    let fallback = false;
    if (!chosen) { chosen = sorted[0]; fallback = true; }
    const label = fallback
      ? qualityLabel(chosen.id || 0) + '（当前曲目无 ' + qualityLabel(targetQuality) + '）'
      : qualityLabel(chosen.id || 0);
    const urls = [];
    const addUrl = (u) => { if (u && !urls.includes(u)) urls.push(u); };
    const collect = (s) => {
      addUrl(s.baseUrl || s.base_url || '');
      if (Array.isArray(s.backupUrl || s.backup_url)) {
        for (const b of (s.backupUrl || s.backup_url)) addUrl(b);
      }
    };
    collect(chosen);
    for (const s of sorted) if (s !== chosen) collect(s);
    if (!urls.length) throw new Error('未获得可播放地址');
    return { urls, label, cid };
  }

  /** 合集展开：多 P 且每 P 是歌曲长度才拆成单曲，否则返回 null。 */
  async expand(track) {
    if (!track.bvid) return null;
    const data = (await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + track.bvid)).data;
    const pages = data.pages || [];
    if (pages.length < 2) return null;
    const PAGE_MAX_MS = 8 * 60_000;
    const EXPAND_MAX = 120;
    let songLike = 0;
    const probe = Math.min(pages.length, 3);
    for (let i = 0; i < probe; i++) {
      if ((pages[i].duration || 0) * 1000 <= PAGE_MAX_MS) songLike++;
    }
    if (songLike < Math.min(2, probe)) return null;
    const ownerObj = data.owner || {};
    const upName = clean(ownerObj.name || data.author || '');
    const cover = httpsUrl(data.pic || '');
    const collectionTitle = clean(data.title || '');
    const countN = Math.min(pages.length, EXPAND_MAX);
    const out = [];
    for (let i = 0; i < countN; i++) {
      const page = pages[i];
      const dur = (page.duration || 0) * 1000;
      if (dur > PAGE_MAX_MS) continue;
      const song = parsePart(page.part || '', upName, i + 1);
      out.push(makeTrack({
        title: song[0], artist: song[1], cover,
        source: SOURCE_BILIBILI, bvid: track.bvid,
        page: Number(page.page) || i + 1, cid: Number(page.cid) || 0,
        durationMs: dur, parentTitle: collectionTitle,
        id: track.bvid + '?p=' + (Number(page.page) || i + 1),
        sourceUrl: 'https://www.bilibili.com/video/' + track.bvid + '?p=' + (Number(page.page) || i + 1),
      }));
    }
    return out.length >= 2 ? out : null;
  }
}

function parsePart(raw, fallbackArtist, page) {
  let value = (raw || '').trim();
  value = value.replace(/^[0-9]{1,3}\s*[.、．\-—)）]?\s*/, '');
  value = value.replace(/^[【\[][^】\]]*[】\]]\s*/, '').trim();
  let title = value;
  let artist = fallbackArtist;
  const split = value.split(/\s+[-—]\s+/);
  if (split.length >= 2) {
    title = split[0].trim();
    artist = split[split.length - 1].trim();
  }
  title = cleanTitle(title);
  if (!title) title = '第 ' + page + ' 首';
  if (!artist) artist = fallbackArtist;
  return [title, artist];
}
