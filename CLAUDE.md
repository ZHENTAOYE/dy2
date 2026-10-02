# 从真空管到AI：计算机为什么突然变得这么强？— Remotion 科普视频

1920×1080 · 30fps · 全部画面用代码绘制（SVG / Canvas 2D / 自制 2.5D 投影），无外部素材。
目标：视觉冲击力持续升级，结尾震撼。无配音（云端无法访问 TTS），靠电影式字幕 + 合成音效/配乐。

## 本地运行

```bash
npm install
npm start                      # Remotion Studio，逐帧预览（推荐）
npm run typecheck
node scripts/stills.mjs out/stills tube:120,300 moore:600   # 批量渲染静帧（帧号相对于场景；SCALE=1 全分辨率）
python scripts/contact_sheet.py out/sheet.jpg out/stills/*.jpg  # 静帧拼图（≤8 张，2 列）
npm run soundtrack                                           # python3 scripts/soundtrack.py → public/soundtrack.wav
npx remotion render Main out/video.mp4                       # 成片
```

- 本地不需要 `REMOTION_CHROME`；Remotion 会自动下载 headless shell。（云端用的是 `/opt/pw-browsers/...`。）
- **改了任何屏幕文字后必须运行 `npm run fonts`**：字体按实际用到的字形从 Google Fonts 子集化下载到 `public/fonts/`，新字不在子集里就会回退成系统字体。
- **改了 `timeline.json`（时长、cue、ticks）后必须运行 `npm run soundtrack`**，否则音画不同步。
- 每个场景另有独立合成 `scene-<id>`（Studio 里的 Scenes 文件夹，无配乐）；`stills.mjs` 的 `场景:帧` 就是从它渲染的，
  与其他场景的时长无关。`@<帧>` 表示整片绝对帧。

## 代码约定

- `src/timeline.json` 是唯一的时间轴来源：每个场景的 `duration` 和命名 `cues`（场景内相对帧）。
  场景代码用 `cue("scene","name")` 读取；配乐脚本也要读同一份 cues，保证音画同步。
  有节奏的一串事件（数字砸下、逐字生成、翻倍格子……）放在该场景可选的 `"ticks": { "name": [帧…] }` 里，
  用 `ticks("scene","name")` 读取；配乐会给每个 tick 配音（映射表见 `scripts/soundtrack.py` 的 `TICK_SOUNDS`）。
- 新增 cue / ticks 时要在 `soundtrack.py` 的 `CUE_SOUNDS` / `TICK_SOUNDS` 里配上声音（脚本会对未映射的名字报 warning）。
  脚本里 `SYNC_*` 常量镜像了少数场景内部节奏（Tube 的 BITS/BIT_LEN、Moore 的 STEP=18 与 `yearAt`、Wall 每 20 帧一个核心、
  GPU 的 CPU_ROWS / ONE_LEN / ZOOM_LEN 等），改这些场景时要同步。
- 所有动画必须是帧号的纯函数：用 `hash / noise1 / rng`（`src/lib/math.ts`），**禁止 `Math.random()`**。
- Canvas 场景用 `src/lib/canvas.tsx` 的 `<Canvas draw={(ctx,w,h,frame)=>…}/>`；发光用 `glow()`（缓存的径向渐变精灵 + `lighter` 叠加），线条发光用 `glowStroke()`。
- 3D 用 `src/lib/three.ts` 的 `camera()/project()`（Y 轴向下）。
- 字幕 `<Captions items=[{from,to,text}]>`：`{{…}}` 为高亮关键词；单行不超过约 26 个汉字宽（拉丁字母/数字约 0.55），否则会折行。
  阅读时间：每条 `to - from ≥ max(75, 24 + 4 × 字数)` 帧，相邻两条至少隔 4 帧。`——` 会被画成一条连续横线。
- HUD 组件：`YearStamp`、`ChapterCard`、`Callout`、`Flash`、`FilmLook`（`src/components/Hud.tsx`），`Glitch`。
- **渐变文字只能用 `GradientText`（`src/components/GradientText.tsx`）**：它用字形轮廓（`src/lib/glyphPaths.ts`）裁剪渐变矩形。
  不要用 CSS `background-clip: text`，也不要给 SVG `<text>` 填渐变：长时间整片渲染时 Chrome 会把大号渐变文字画成色块、
  错位或直接丢失（单帧静帧却是好的）。要给新字符做渐变，先把字加进 `scripts/glyph-paths.py` 的 `GLYPH_SETS`，
  `npm run fonts` 后再运行 `python3 scripts/glyph-paths.py`。纯色文字不受影响。
- 历史数据集中在 `src/data.ts`（晶体管数、CPU 频率、ImageNet 错误率），只用核实过的数字。

## 进度

全部 18 个场景已实现，并经过逐帧静帧审查（实现 → 独立审查 → 修复）。全片 10,460 帧 ≈ 5.8 分钟（`timeline.json`）。
配乐 `scripts/soundtrack.py` 已完成；成片 `npx remotion render Main out/video.mp4`。

## 后半段分镜（已实现，按冲击力逐级升级；实现细节以代码为准）

**Neural（第6章「沉睡的大脑」，紫色）**
- 1958 感知机：单个神经元，4 个输入，权重=线宽，求和→输出。字幕：“神经网络的想法很老——1958年就有了第一台{{感知机}}。”
- “但它沉睡了几十年：{{算力不够，数据也不够}}。” 画面变暗、边缘结霜（AI 寒冬）。
- 数据洪流：图片缩略图色块 + 文字 token 从四周涌入、加速。“直到互联网带来了{{海量数据}}——”；“仅 ImageNet 一个数据集，就有{{1400万张}}人工标注的图片。”

**AlexNet**
- “2012年，AlexNet 用{{两块游戏显卡}}训练——” 错误率柱状图（`IMAGENET`）：28.2→25.8→**15.3**（AlexNet，第二名 26.2）→11.7→6.7→3.6，人类 5.1 水平线。
- “把图像识别错误率从26%一口气降到{{15%}}。”“几年后，机器识图甚至{{超过了人类}}。”（ResNet 3.6% < 人类约 5.1%）

**Converge（第7章「大爆发」）**
- 三条发光粒子流：算力（青）、数据（品红）、算法（金）从三方向汇聚到中心（cue `impact`），中心点燃 → 数千节点的神经网络爆炸式展开（加色混合）。
- “算力、数据、算法——{{三条曲线}}终于在同一时刻交汇。”“一场真正的爆发开始了。”

**Transformer**
- 一行 token：“计 算 机 为 什 么 突 然 变 得 这 么 强 ？”，token 之间画注意力弧线；随后逐字生成续写（光标）。背景：透视层叠的网络层，信号流动。
- “2017年，{{Transformer}}出现：它让AI同时‘注意’一句话里的所有词。”“它天生适合并行——GPU越多，学得越多。”“2022年，ChatGPT问世，{{两个月用户破亿}}。”

**ZoomOut（全片视觉高潮之一）**
- 连续对数缩放拉远：晶体管阵列 → GPU 芯片（“2080亿个晶体管”）→ 封装+HBM → 8 卡服务器 → 72 卡机柜（NVL72）→ 机房（成百上千机柜，LED 闪烁）→ 园区 → 城市夜景 → 夜晚地球 + 网络光弧。底部算力计数器从 10¹⁵ 飙到 10²⁰ FLOP/s。
- 字幕：“支撑这一切的，是规模惊人的算力。”“一块顶级AI芯片：{{2000多亿}}个晶体管。”“一台服务器8块，一个机柜72块。”“一座AI数据中心：{{十万块}}芯片，耗电堪比一座城市。”“训练顶尖AI的算力，十年间增长了{{上千万倍}}。”（AlexNet≈4.7e17 FLOP → GPT-4 估算≈2e25 FLOP）

**Compare（终极对比）**
- 左：ENIAC 的一点琥珀色微光“每秒 5,000 次”；右：AI 超算“每秒 100,000,000,000,000,000,000 次”，0 一个个砸出来（加速的 tick），每个 0 一道冲击波，数字撑满屏幕。
- 大字砸下：“差距：约 {{2亿亿}} 倍”（1e20 / 5e3 = 2×10¹⁶）+ 闪白 + 震屏。
- “从5000次，到{{一万亿亿次}}。”“78年，翻了约{{54番}}——差不多每一年半翻一倍。”（2^54 ≈ 1.8×10¹⁶）

**Finale（第8章「指数的真相」）**
- 镜头沿指数曲线飞行：平坦段暗琥珀色，越往上颜色 琥珀→青→品红→白；沿线标注 1946 真空管 / 1947 晶体管 / 1958 集成电路 / 1971 微处理器 / 2005 多核 / 2012 深度学习 / 2022 大模型，“我们在这里”在最陡处。
- “所以，计算机并不是‘突然’变强的。”“它是在80年里，一次又一次地翻倍。”“指数曲线的前半段平淡得让人忽略，后半段陡峭得让人震撼。”“而我们，正站在这条曲线{{最陡峭的地方}}。”
- cue `flash`：全屏白闪 → 最终标题“从真空管到AI” + “下一次翻倍，会带来什么？” → 黑场，余音。

## 配乐 `scripts/soundtrack.py`

numpy 合成 48kHz 16-bit 立体声 WAV（确定性随机种子），读取 `src/timeline.json` 计算各 cue / tick 的绝对时间：
- 底层：随章节演进的 pad/drone（能量逐章升高），从 Moore 起加入琶音脉冲，Converge 起加入鼓点，Finale 全面爆发后收为单音余韵。
- 事件音：`boom`（标题、功耗墙、汇聚、终极对比）、`riser`（大时刻之前）、`glitch`、`spark`/`powerdown`（ENIAC 烧管与断电）、`tick`（计数器/翻倍，Moore 场景按 `yearAt()` 每两年一个 tick，逐渐加速）、`whoosh`（章节卡）。
- 结尾 tanh 软限幅 + 归一化到 -1 dBFS；全片最响的两处是 `compare.gap` 和 `finale.flash`。

## 已核实的数字

ENIAC：1946 年公开、17,468 根真空管、约 30 吨、150 kW、约 167 m²、每秒 5,000 次加法。
晶体管 1947（贝尔实验室）；集成电路 1958（Kilby）/1959（Noyce）；摩尔 1965 年提出（1975 年修正为约两年翻倍）。
Intel 4004（1971）：2,300 个晶体管、10 µm 工艺、740 kHz；NVIDIA B200（2024）：2080 亿。
频率约 2004–2005 年停在 3.8 GHz 左右（Dennard 缩放失效）；Gelsinger 2001 年 ISSCC 警告发热密度将达核反应堆水平。
AlexNet 2012：两块 GTX 580，top-5 错误率 15.3%（第二名 26.2%）；ImageNet 约 1400 万张图；ResNet 2015 为 3.57%。
H100 BF16 稠密约 1e15 FLOP/s；10 万卡集群约 1e20；手机 NPU 约 35 TOPS（比 ENIAC 快几十亿倍）。
由以上推出、画面上用到的：8 卡服务器约 8×10¹⁵、72 卡机柜约 7.2×10¹⁶；1e20 / 5e3 = 2×10¹⁶（约 2 亿亿倍）；2^54 ≈ 1.8×10¹⁶，
78 年翻约 54 番（约每 1.44 年一倍）；训练算力 AlexNet ≈ 4.7×10¹⁷ FLOP → GPT-4 估算 ≈ 2×10²⁵ FLOP（上千万倍）。
其他：感知机 1958（罗森布拉特）；Transformer 2017（《Attention Is All You Need》）；ChatGPT 2022 年问世，约两个月用户破亿。
Nano 场景沿用的尺度（常见量级的约数，前一阶段写入）：头发约 80 µm、红细胞约 7.5 µm、细菌约 2 µm、病毒约 100 nm、先进工艺栅极间距约 48 nm、鳍宽约 6 nm（约 25 个硅原子，Si–Si 键长 0.235 nm）。
