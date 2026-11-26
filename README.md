# 小点声 SoundHunt · Windows 桌面版

> 基于 B 站公开音源的沉浸式音乐播放器 —— Windows 桌面版（Electron）。
> 与 Android 版同源：同样的 B 站接口、wbi 签名、四信号推荐算法，界面针对桌面重做。

> 📱 **Android 版**见 [SoundHunt](https://github.com/SamislandHub/SoundHunt)（纯 Java、自绘 UI、上下滑切歌）。

## 下载安装

从 [Releases](https://github.com/SamislandHub/SoundHunt-Desktop/releases) 下载对应版本：

- **小点声 Setup 3.2.7.exe** —— 安装版，双击安装，自动创建桌面/开始菜单快捷方式
- **小点声 3.2.7.exe** —— 便携版，解压即用、免安装

> 首次运行如被 Windows Defender 拦截，选择「更多信息 → 仍要运行」即可（未购买代码签名证书）。

## 特性

- **发现页**：打开即加载推荐流，滚动到底自动续拉，跨页去重、风格打散
- **搜索**：B 站关键词搜索，热搜词快捷入口
- **播放页**：自绘黑胶唱片随节奏旋转 + 声波律动，进度条拖动、上下键/滚轮切歌
- **收藏**：收藏即队列，随机/顺序播放，迷你播放条常驻
- **音质切换**：64K / 132K / 无损 FLAC，切换后续播不中断
- **本地缓存**：收藏与设置持久化到 `%APPDATA%/soundhunt`
- **主题**：深/浅色切换
- **键盘快捷键**：`空格` 播放/暂停、`↑ / ↓` 切歌、`Esc` 收起播放页

## 技术架构

逻辑层从 Android 版逐行移植为纯 JS，Electron 主进程跑核心逻辑、渲染进程负责 UI：

```
src/
├── core/                    # 核心逻辑（纯 JS，无 Electron 依赖，可独立测试）
│   ├── Track.js             # 数据模型
│   ├── BiliClient.js        # B站接口 + wbi 签名 + 搜索 + 播放地址 + 合集展开
│   ├── RecommendEngine.js   # 四信号打分 + MMR 打散
│   ├── SearchRepository.js  # 推荐流编排 + 并发搜索
│   └── Store.js             # 收藏/设置持久化
├── main.js                  # 主进程：窗口 + IPC + 音频流代理
├── preload.js               # 安全桥接
└── renderer/                # UI 层
    ├── index.html / style.css
    ├── app.js               # 总控
    ├── Player.js            # 播放内核（多线路容错、音质续播）
    └── visual.js            # 自绘黑胶 + 波形
```

**为什么需要音频代理**：B 站音频流要求 `Referer` 请求头，浏览器 `<audio>` 无法自定义 header。主进程起一个本地 HTTP 服务（`127.0.0.1:随机端口`），转发音频/封面请求并补上防盗链头，页面指向代理地址即可播放。

## 构建与运行

环境：Node.js 18+（开发/打包机），Windows 10/11（运行）。

```bash
# 安装依赖
npm install

# 开发运行
npm start

# 核心逻辑冒烟测试（无需 Electron，验证 B站接口连通）
npm run test:core

# 打包 Windows 安装包（生成 dist/ 下的 NSIS 安装包 + 便携版 exe）
npm run build:win
```

产物：
- `dist/小点声 Setup 3.2.7.exe` —— 安装版
- `dist/小点声 3.2.7.exe` —— 便携版（解压即用）
- `dist/win-unpacked/` —— 绿色版目录（未打包 exe，免安装）

> **国内网络打包提示**：若在大陆环境打包慢或卡在下载，用镜像：
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
> ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
> npm run build:win
> ```
> 在 Linux/macOS 上交叉打 Windows 包需额外装 `wine` + `wine32:i386`，并在 `xvfb-run` 下执行。

已构建的成品见 `releases/` 目录（安装版 + 便携版，v3.2.7，x64）。

## 数据源说明

仅使用 B 站公开接口（`search/type`、`view`、`player/playurl`），音频流为平台公开 DASH 音轨，不下载/分发任何音频内容。本项目不含音乐文件，仅供个人学习与技术研究。

## 许可证

MIT
