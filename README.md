# Resonance Archive

一个用于播放 **WAV** 音频、同步显示 **VTT** 字幕，支持 **文件夹播放列表** 与 **自定义 ASMR 封面** 的桌面播放器，界面采用 ark-ui 的 **Ex Astris（exa）** 家族、`complex` 深度视觉风格（午夜蓝黑 `#080914` / 纸白 `#f3f2ef` / 青绿 `#00fbec`，衬线对比 + 环形仪器）。

## 运行

直接双击解包版：

- `dist\win-unpacked\Resonance Archive.exe`

(需保留 `dist\win-unpacked` 目录内全部文件。)

## 使用

1. **载入整个文件夹**：点击顶栏 **载入文件夹**（或空态按钮），选择含音频的文件夹即可自动生成
   **播放列表**（支持子目录递归）。也可直接 **拖放** `.wav` 单个文件。
2. **自动搜索字幕（宽松匹配）**：同级同名 `.vtt/.srt`、子目录（`subtitle/subtitles/subs/lyrics/…`）中的同名字幕、
   大小写/分隔符不敏感匹配都会被自动关联；也支持把 `.vtt/.srt` 直接追加到 **完整音频文件名** 的命名
   （例如 `01.和我分手后悔了？.wav` 对应 `01.和我分手后悔了？.wav.vtt`）。
3. **自动搜索封面（适用于整个文件夹）**：同级同名图片、`cover/folder/front/album/back/art/封面` 等通用封面名、
   以及 `cover/covers/images/封面` 等子目录图片会被逐曲识别；若某曲无独立封面，会回退使用
   **文件夹根部的通用封面**（整个专辑共用一张封面）。
4. 列表左侧点击即可切歌；**全部播放** 从头顺序播放；上一曲/下一曲会延续当前播放状态。
5. 点击播放；随播放进度，字幕会同步高亮，右侧 **字幕** 列表同步定位。**封面** 可点击卡片更换，
   点右上角 ✕ 移除；自定义封面按音频记住。
6. **日文转中文**：加载音频后，点击播放条上的 **日→中**（或菜单 `文件 → 日文转中文…`），
   选择模型来源（默认为 HuggingFace 自动下载，或点“浏览…”选择本地模型目录）、设备（GPU/CPU）
   与精度，点击 **开始转译**，即可把当前音频转写为中文并自动生成、载入 `.wav.zh.vtt` 字幕。
   若尚未安装依赖，可用下方提示在 Python 3.11 环境执行 `pip install faster-whisper`。

## 快捷键

| 键 | 作用 |
| --- | --- |
| `空格` | 播放 / 暂停 |
| `←` / `→` | 后退 / 前进 5 秒 |
| `↑` / `↓` | 音量 + / − |
| `PageUp` / `PageDown` | 上一曲 / 下一曲 |
| `A` | 设置 / 取消 A—B 循环 |
| `L` | 单曲循环 |
| `M` | 静音 |
| `Home` / `End` | 跳到开头 / 结尾 |

## 功能

- 实时波形（Web Audio 解码生成的真实峰值），点击 / 拖动波形可定位。
- 文件夹扫描 + 播放列表：递归收集音频，自动关联字幕与封面，显示格式/大小与“字幕/封面”徽标。
- 播放列表侧栏宽度可拖动：拖动边界的青色手柄、或用 `←/→` / 双击重置，即可改变宽度，
  让不同长度的文件名完整显示；宽度按记忆保留。
- 自动搜索字幕：同级同名、常见字幕子目录、大小写不敏感匹配；兼容 SRT。
- 自动搜索封面：同级同名、通用封面名、封面子目录匹配。
- 字幕解析（WebVTT，兼容常用内联标签），与播放进度精确同步并自动滚动。
- 封面显示与自定义：方形封面卡片 + 舞台掩幕背景，支持更换 / 移除 / 自动识别 / 按音频持久化。
- 文件档案面板：格式、时长、采样率、声道、位深、大小、字幕条数。
- A—B 循环、单曲循环、速度、音量、跳转。
- **日文转中文字幕（本地推理）**：基于 Faster-Whisper（CTranslate2）+ 海南鸡 v2 日→中优化模型
  `chickenrice0721/whisper-large-v2-translate-zh-v0.2-st-ct2`，在本地 GPU（NVIDIA CUDA）或 CPU 上
  把日语音频转译为中文字幕，输出 WebVTT 并自动关联当前曲目。支持：
  - 选择本地模型目录，或由应用通过 HuggingFace 自动下载到 `models\` 目录（离线可复用，已下载则不再联网）。
  - 设备自动探测：检测到 CUDA 则默认 `cuda` + `int8_float16`（8GB 显存友好），否则回退 `cpu` + `int8`。
  - 转写进度、当前片段实时回显，可随时取消；完成后的中文字幕立即载入并按音频记住。
  - 生成的 `<音频名>.zh.vtt` 会自动被“自动搜索字幕”识别。
- 桌面 / 竖向重排，支持 `prefers-reduced-motion`。

> 需要：Python 3.11（或 3.10/3.12），并安装 `pip install faster-whisper`。GPU 推理依赖
> `nvidia-cudnn-cu12` + `nvidia-cublas-cu12`（应用会自动把其运行库目录加入搜索路径）。
> 首次使用中文音视频时，请先在转写弹窗里下载一次模型（约 3GB），之后转为本地目录即可离线使用。

## 开发

```bash
npm install
npm start          # 本地 Electron 运行
npm run pack       # 打包解包版 (dist\win-unpacked)
npm run pack:portable  # 打包便携 EXE (可选)
```

> 打包时需关闭 Windows 对可执行文件资源编辑的依赖（沙箱无法创建符号链接）。
> `package.json` 中 `win.signAndEditExecutable` 已设为 `false`，因此 `electron-builder` 不会自动嵌入图标；
> 如需给解包版 exe 加图标，可在本机安装 [rcedit](https://github.com/electron/rcedit) 后执行：
> `rcedit-x64.exe "dist\win-unpacked\Resonance Archive.exe" --set-icon "dist\.icon-ico\icon.ico" --set-version-string "ProductName" "Resonance Archive"`。
> **注意**：不要用 `rcedit` 处理便携版 exe——NSIS 便携 stub 会将内嵌数据剥离，导致文件被截断。
> 便携版运行时任务栏会显示窗口图标（已在 `main.js` 中设置）。

> 关于日文转中文字幕：模型不在安装包内（约 3GB）。首次在弹窗中选“自动下载”会下载到
> `models\`（开发时）或 `app.asar.unpacked\models\`（解包版）；也可在弹窗中“浏览…”选择已有模型目录
> （例如 `D:\项目\asmr\models\whisper-large-v2-translate-zh-v0.2-st-ct2`）后改为本地目录，离线使用。
> `transcribe.py`、`transcribe.js` 已在打包时通过 `asarUnpack` 落为真实文件，供 Python 子进程调用。
