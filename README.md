# 宇宙膨胀 · 科普动画（Remotion）

一部约 4 分钟（247 秒，1920×1080，30fps）的“宇宙膨胀”科普视频。
**全部画面由代码程序化绘制**（Canvas 2D + DOM，没有任何图片/视频素材）；
**配乐由 `scripts/make_soundtrack.py` 用 numpy/scipy 从零合成**，所有打击点与画面共用 `src/timeline.json`，音画锁定。

## 环境

- Node 18+（开发时用 22）、npm
- Python 3.10+：`pip install numpy scipy fonttools brotli`
- ffmpeg（编码 mp3、生成静帧拼图）

首次渲染时 Remotion 会自动下载 Chrome Headless Shell
（`remotion.config.ts` 只在云端沙箱的 `/opt/pw-browsers` 存在时才改用本地浏览器）。

## 常用命令

```bash
npm install
npm run studio            # Remotion Studio 预览（Scenes 文件夹里有单场景合成）
npm run render            # 横屏完整版 → out/cosmic-expansion.mp4
npm run render:vertical   # 竖屏 1080×1920（布局已做自适应，但尚未逐帧检查）
npm run audio             # 重新合成配乐 → public/audio/soundtrack.mp3
python3 scripts/subset_fonts.py                       # 改了屏幕文字后重新裁剪字体
node scripts/stills.mjs Scene-observable 0,300,600 out/stills 0.5   # 批量静帧 + 拼图
```

## 结构

| 路径 | 内容 |
| --- | --- |
| `src/timeline.json` | 各场景时长 + 音效打点（视频与配乐共用） |
| `src/scenes/S01…S10` | 10 个场景 |
| `src/lib/` | 噪声、bloom/色差、星系精灵、3D 星场、宇宙网、点云渲染器 |
| `src/components/` | 字幕、大标题、章节标、HUD 读数、胶片颗粒 |
| `scripts/make_soundtrack.py` | 配乐合成（pads、琶音、braam、riser、定音鼓、混响、母带） |

## 场景

| # | id | 起点 | 时长 | 内容 |
| --- | --- | --- | --- | --- |
| 1 | hook | 0s | 16s | 银河 → 星系远离 → 曲速 → 标题“宇宙膨胀” |
| 2 | hubble | 16s | 26s | 1929 哈勃：红移光谱、光波拉长、哈勃定律 |
| 3 | space | 42s | 24s | 空间本身在膨胀：网格、换观测者、气球类比 |
| 4 | rewind | 66s | 15s | 时光倒流：年龄/温度计数，坍缩成一点 |
| 5 | bigbang | 81s | 28s | 大爆炸、暴胀 ×10²⁶、质子→日地距离、量子涨落 |
| 6 | cmb | 109s | 26s | 等离子体中光子随机游走 → 宇宙变透明 → CMB 球 |
| 7 | web | 135s | 24s | 黑暗时代 → 第一代恒星点燃 → 3D 宇宙网穿越 |
| 8 | darkenergy | 159s | 24s | Ia 超新星、加速膨胀曲线、暗能量 68/27/5 |
| 9 | observable | 183s | 32s | 从地球一路缩放到 930 亿光年的可观测宇宙 |
| 10 | finale | 215s | 32s | 哈勃半径与超光速退行、遥远未来、终章与萨根名言 |

## 约定

- **字幕竖屏断行**：字幕文本里的 `|` 只在竖屏换行、横屏忽略。竖屏每行最多约 16 个汉字，两行的字幕都要在词组之间放一个 `|`；
  `【强调】`、数字、标点会自动保持不断开。
- **场景转场**：大多数章节之间是约 1 秒的过黑（各场景自己的 `<Fade>`）。space→rewind 是配合反向音效的硬切黑；
  bigbang→cmb 是 `Main.tsx` 里 `XFADE_IN` 的 0.6 秒叠化（前一场景在下层多跑 0.6 秒，打点不变）。
- **编码**：胶片颗粒是逐帧随机噪声，决定码率。颗粒 0.06 + crf 16 约 11–19 Mbps；现用 0.04 + crf 18，约为一半，肉眼无差别。
- `scripts/stills.mjs` 的拼图需要系统 ffmpeg（带 drawtext/xstack）；Remotion 自带的 ffmpeg 是精简版，没有这些滤镜。
- 有独显的机器加 `--gl=angle`（例：`npx remotion render CosmicExpansion out/cosmic-expansion.mp4 --gl=angle --concurrency=12`），
  画面与默认的软件渲染 `swangle` 一致（PSNR≈50 dB），速度快很多。同一台机器上有别的 Remotion 渲染时，加 `--port=<空闲端口>`。
- 透明背景的 `CanvasLayer` 如果某些帧只清空不绘制，整片渲染时偶尔会残留上一次的画面（静帧看不出来）——不可见时请直接卸载该图层。

## 进度

- [x] 10 个场景全部完成，并逐场景检查过静帧
- [x] 配乐合成完成：−15.6 LUFS，峰值 −1.1 dBFS，打点与画面同步
- [x] 字体子集重新裁剪（之前只覆盖了约 67 个早期用字，其余回退成系统字体）
- [x] 完整渲染；场景衔接、字幕遮挡（横竖屏）逐帧检查并修复
- [x] 编码取舍：颗粒 0.04、crf 18
- [ ] 通看一遍、听配乐（还没人实际听过）
- [ ] 竖屏版完整渲染后通看
