/** 核心逻辑冒烟测试：wbi 签名 + 搜索 + 推荐打分 + 播放地址 */
import { BiliClient, QUALITY_132K } from './src/core/BiliClient.js';
import { RecommendEngine } from './src/core/RecommendEngine.js';
import { SearchRepository } from './src/core/SearchRepository.js';

const log = (...a) => console.log(...a);

async function main() {
  log('=== 1) B站搜索（含 wbi 签名）===');
  const bili = new BiliClient();
  const tracks = await bili.search('周杰伦 歌曲', 1);
  log(`搜索返回 ${tracks.length} 首`);
  if (tracks.length) {
    const t = tracks[0];
    log(`  样例: ${t.title} —— ${t.artist} | ${Math.round(t.durationMs / 1000)}s | 播放${t.playCount} | tag=${t.tag}`);
    log(`  stableId: ${t.source}:${t.id}`);

    log('\n=== 2) 播放地址（132K 音质）===');
    try {
      const qr = await bili.playCandidates(t, QUALITY_132K);
      log(`  音质: ${qr.label} | 容错线路 ${qr.urls.length} 条`);
      log(`  首选: ${qr.urls[0].slice(0, 80)}...`);
    } catch (e) {
      log('  播放地址获取失败:', e.message);
    }
  }

  log('\n=== 3) 推荐引擎打分 + MMR 打散 ===');
  const engine = new RecommendEngine();
  const fakeFavs = tracks.slice(0, 3);
  engine.buildProfile(fakeFavs);
  log(`  画像就绪: ${engine.hasProfile()}`);
  const ranked = engine.rank(tracks, 8);
  log(`  推荐产出 ${ranked.length} 首:`);
  ranked.forEach((t, i) => log(`    ${i + 1}. [${t.recommendScore.toFixed(3)}] ${t.title} —— ${t.artist}`));

  log('\n=== 4) 搜索仓库 trending（并发 3 主题 + 跨页去重）===');
  const repo = new SearchRepository();
  const r = await repo.trending();
  log(`  trending 返回 ${r.tracks.length} 首, 错误 ${r.errors.length}`);
  r.tracks.slice(0, 5).forEach((t, i) => log(`    ${i + 1}. ${t.title} —— ${t.artist}`));

  log('\n全部核心测试完成 ✅');
}

main().catch((e) => { console.error('测试失败:', e); process.exit(1); });
