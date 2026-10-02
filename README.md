# 从真空管到AI：计算机为什么突然变得这么强？

用 [Remotion](https://www.remotion.dev/) 制作的中文科普短片：1920×1080 · 30fps · 约 5.8 分钟。
所有画面都由代码绘制（SVG / Canvas 2D / 自制 2.5D 投影），配乐和音效由 numpy 合成，不依赖任何外部素材。

## 环境

- Node.js 18+（已在 Node 22 上测试）
- Python 3 + numpy（只在重新生成配乐时需要）
- 首次渲染时 Remotion 会自动下载 headless Chrome，无需另外安装浏览器或 ffmpeg

```bash
npm install
```

## 预览

```bash
npm start
```

这会打开 Remotion Studio：

- `Main` 是整部片子（带配乐）
- `Scenes/scene-<id>` 是单个场景，方便逐帧检查（不带配乐）

也可以只渲染几张静帧来检查画面。帧号相对于场景起点，默认半分辨率，加 `SCALE=1` 输出全分辨率：

```bash
node scripts/stills.mjs out/stills gpu:120,640 finale:700
node scripts/stills.mjs out/stills @5000
python scripts/contact_sheet.py out/sheet.jpg out/stills/gpu_120.jpg out/stills/gpu_640.jpg
```

- `@5000` 表示整片的第 5000 帧
- `contact_sheet.py` 把多张静帧拼成一张带标注的拼图

## 渲染成片

```bash
npx remotion render Main out/video.mp4
```

也可以用 `npm run build`。输出为 H.264、CRF 18（见 `remotion.config.ts`）。

## 修改内容时

| 改了什么 | 需要做什么 |
| --- | --- |
| 屏幕上的文字 | 运行 `npm run fonts`：字体按实际用到的字形从 Google Fonts 子集化下载到 `public/fonts/` |
| `src/timeline.json` 里的时长或 cue | 运行 `npm run soundtrack`（即 `python3 scripts/soundtrack.py`），重新生成 `public/soundtrack.wav`，保证音画同步 |
| 渐变文字（`GradientText`）里的字符 | 把字加进 `scripts/glyph-paths.py`，在 `npm run fonts` 之后运行 `python3 scripts/glyph-paths.py` |
| 任何代码 | 运行 `npm run typecheck` |

## 结构

```
src/timeline.json      唯一的时间轴：每个场景的时长、命名 cue、可选的 ticks（节奏事件帧）
src/scenes/*.tsx       18 个场景（场景内动画都是帧号的纯函数）
src/components/        字幕、章节卡、HUD、故障效果
src/lib/               画布与发光工具、2.5D 相机、数学/缓动/确定性噪声、字体
src/data.ts            核实过的历史数据（晶体管数、CPU 频率、ImageNet 错误率）
scripts/soundtrack.py  读取 timeline.json 合成配乐与音效
scripts/stills.mjs     批量渲染静帧
scripts/fetch-fonts.mjs  字体子集化
scripts/glyph-paths.py   导出渐变文字所需的字形轮廓
```

项目约定、分镜和已核实的数据见 `CLAUDE.md`。
