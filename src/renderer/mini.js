/** 迷你播放组件渲染逻辑 —— 状态由主窗口通过 IPC 推送 */
const $ = (id) => document.getElementById(id);
const api = window.miniApi;

api.onState((s) => {
  if (!s) return;
  $('m-title').textContent = s.title || '小点声';
  $('m-artist').textContent = s.artist || '点击放大';
  const label = $('m-cover');
  label.style.backgroundImage = s.cover ? `url("${s.cover}")` : '';
  $('m-disc').classList.toggle('spin', !!s.playing);
  $('m-toggle').classList.toggle('paused', !s.playing);
  const pct = s.dur > 0 ? (s.pos / s.dur * 100) : 0;
  $('m-fill').style.width = pct + '%';
});

$('m-toggle').onclick = () => api.command('toggle');
$('m-next').onclick = () => api.command('next');
$('m-open').onclick = () => api.openMain();
$('m-disc').onclick = () => api.openMain();
