# ASMR 播放器

**一个本地ASMR 播放器：同步 VTT 字幕，并支持日文 → 中文转写。**

`WAV Player` 者，乃基于 Electron 之桌面播放器，所以播放本地 ASMR 音频、同步显示 `.vtt` 字幕，且能于本地将日语 ASMR 音频转写为中文字幕者也。

<p>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-33-blue?logo=electron&logoColor=white" />
  <img alt="Python" src="https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-green" />
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows-lightgrey?logo=windows" />
</p>

---

## 图影 / Screenshots

<table>
  <tr>
    <td><img src="screenshots/desktop.png" alt="播放界面" /></td>
    <td><img src="screenshots/playlist.png" alt="文件夹播放列表" /></td>
  </tr>
  <tr>
    <td align="center">播放之器与字幕相随</td>
    <td align="center">文件夹之播放列表，侧栏可调其宽</td>
  </tr>
  <tr>
    <td><img src="screenshots/subtitle.png" alt="字幕索引" /></td>
    <td><img src="screenshots/transcribe.png" alt="日文转中文" /></td>
  </tr>
  <tr>
    <td align="center">字幕与轨迹索引之面板</td>
    <td align="center">日转中本地转写之窗</td>
  </tr>
  <tr>
    <td><img src="screenshots/record.png" alt="档案面板" /></td>
    <td><img src="screenshots/portrait.png" alt="竖向布局" /></td>
  </tr>
  <tr>
    <td align="center">文件档案之面板</td>
    <td align="center">竖向与窄屏重排</td>
  </tr>
</table>

## 特性 / Features

- **本地播放**：以 Web Audio 解码，生真实波形峰值；点之、拖之，皆可定位。
- **同步字幕 + 实时滚动**：解析 `.vtt`，兼容常见内联标签与 SRT。器内所显，为**上一句 / 当前句 / 下一句之滚动窗口**（当前句高亮 + 进度条）；右侧「轨迹」面板，自将当前句滚至中间；面板顶端可开关自动滚动，手动滚动则暂让，而浮出「回到当前」。
- **文件夹播放列表**：递归扫全文件夹，自生列表（支持子目录），一键“全部播放”。
- **自动关联字幕与封面（宽松匹配）**：
  - 同名 `.vtt` / `.srt`、子目录（`subtitle/subtitles/subs/lyrics/…`）。
  - 支持将字幕追加于完整音频文件名后（如 `01.xxx.wav` → `01.xxx.wav.vtt`）。
  - 封面：同名图片、`cover/folder/front/album/…` 通用名、封面子目录，整专辑回退至封面。
- **自定义封面**：点封面卡片可更换，点 ✕ 可移除，按音频记之；封面亦为舞台掩幕背景。
- **内嵌封面**：无外部封面图时，自音频文件读取内嵌封面（ID3v2 APIC / FLAC PICTURE / MP4 `covr` / OGG base64），列表与播放器皆显之。
- **专辑文件夹管理（批量导入）**：一次可**多选多个文件夹**导入专辑库；若所选父目录本身不含音频，则自将其子文件夹逐个作为专辑导入。点专辑卡片为预览（只读取曲目列表，点「载入并播放」方切换）；可设专辑封面（整张专辑共用）或从列表移除（不删文件）。
- **记住播放进度 + 上次队列**：每首曲目单独记其播放位置，重启后自复上次之文件夹、曲目与进度。
- **日文转中文字幕（本地推理）**：
  - 基于 Faster-Whisper（CTranslate2）+ 海南鸡 v2 日→中优化模型。
  - 于**本地 GPU（NVIDIA CUDA）**或 CPU 上转写，输出 `.wav.zh.vtt` 并自载入。
  - 设备自动探测（检测到 CUDA 则默认 `cuda` + `int8_float16`，否则 `cpu` + `int8`）。
  - **批量转写整个文件夹**：模型只加载一次，逐个转写并显队列进度；可勾选“跳过已有中文字幕”。
  - 可选**人声检测（VAD）**、输出格式（VTT / SRT），进度 / 当前片段实时回显，可随时取消。
  - 进度 / 当前片段实时回显，可随时取消；所生 `.zh.vtt` 自被自动字幕搜索识别。
- **播放控制**：A—B 循环、单曲循环、倍速、音量、跳转。
- **响应式**：桌面 / 竖向重排，遵循 `prefers-reduced-motion`。

## 技器 / Tech Stack

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Electron 33 |
| 前端 | 原生 HTML / CSS / JS（无框架） |
| 视觉 | ark-ui Ex Astris（exa）`complex` |
| 字幕 | 自定义 WebVTT 解析器 |
| 语音转写 | Faster-Whisper `1.x` + CTranslate2 `4.x` |
| 转写模型 | `chickenrice0721/whisper-large-v2-translate-zh-v0.2-st-ct2` |

## 环境要求 / Requirements

- **Node.js 18+** 与 npm。
- **Python 3.11**（推荐；转写所需）。其他 3.10 / 3.12 亦可，须自确认轮子可用。
- **（可选）NVIDIA 显卡 + CUDA**，以供 GPU 推理。

## 快速开始 / Quick Start

```bash
npm install
npm start        # 本地运行 Electron
```

打开后：

1. 点顶栏 **载入文件夹**（或空态按钮），择含 `.wav` 之文件夹 → 自生播放列表，并自关联字幕 / 封面。
2. 亦可用 **拖放**，直将 `.wav` / `.vtt` / `.srt` / 封面图片拖入窗中。
3. 点击播放，字幕随进度同步高亮；右侧 **字幕** 面板同步定位。

## 日文转中文字幕 / JP → ZH Transcription

将日语音频于 **本地** 转写为中文字幕也。

### 一、装 Python 依赖

```bash
py -3.11 -m pip install faster-whisper
```

若须 GPU 推理，则更装 CUDA 运行库（应用自将其 DLL 目录加入搜索路径）：

```bash
py -3.11 -m pip install nvidia-cudnn-cu12 nvidia-cublas-cu12
```

> 若缺依赖，转写之窗自有提示。

### 二、下载模型（约 3 GB）

播放音频后，点播放条之 **日→中**（或菜单 `文件 → 日文转中文…`，快捷键 `Ctrl+Shift+T`）：

- 默认“自动下载（HuggingFace）”会下载至 `models\`。
- 或点 **浏览…** 择已有之模型目录，例如 `models\whisper-large-v2-translate-zh-v0.2-st-ct2`。

之后切换为“本地模型目录”，即可离线复用（已下载则不再联网）。

### 三、参数说明

| 参数 | 说明 |
| --- | --- |
| 范围 | **当前曲目** 或 **整个文件夹**（批量，模型只加载一次） |
| 设备 | 自动（优先显卡）/ GPU (CUDA) / CPU |
| 精度 | 自动 / `int8_float16`/ `float16` / `int8` |
| 格式 | `VTT` 或 `SRT` |
| 人声检测 | VAD，静音较多之 ASMR 时间轴更准 |
| 跳过已有中文字幕 | 批量时只转尚无 `.zh.vtt` 之曲目 |

批量之时，逐曲队列与状态皆显（等待 / 百分比 / 完成 / 跳过 / 失败），总进度实时更新。既成，自生 `<音频名>.wav.zh.vtt` 而载入；自动字幕搜索亦识 `.zh.vtt` 所对应之中文字幕。

## 快捷键 / Shortcuts

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
| `Ctrl+Shift+T` | 打开日→中 转写 |

## 打包 / Packaging

```bash
npm run pack          # 生成解包版: dist\win-unpacked\WAV Player.exe
npm run pack:portable # (可选) 便携版
```

> `win.signAndEditExecutable` 已设 `false`，故 `electron-builder` 不自嵌图标；若欲为解包版 exe 加图标，可于本机装 [rcedit](https://github.com/electron/rcedit) 后行之：
>
> ```bash
> rcedit-x64.exe "dist\win-unpacked\WAV Player.exe" --set-icon "dist\.icon-ico\icon.ico" --set-version-string "ProductName" "WAV Player"
> ```
>
> 勿对便携版 exe 用 `rcedit`（NSIS 便携 stub 将剥其内嵌数据）。

## 项目结构 / Structure

```text
.
├── main.js            # Electron 主进程（IPC / 媒体协议 / 菜单）
├── preload.js         # contextBridge API
├── library.js         # 文件夹扫描 / 字幕 / 封面匹配
├── embedded-cover.js  # 读取音频内嵌封面（ID3 / FLAC / MP4 / OGG）
├── transcribe.js      # 转写任务：Python 探测、子进程、进度转发
├── transcribe.py      # 日→中 转写桥接（Faster-Whisper / CTranslate2）
├── renderer/          # 前端（index.html / app.js / styles.css / vtt.js）
├── build/             # 打包图标
├── screenshots/       # README 截图
├── samples/           # 示例音频 / 字幕 / 封面
├── test/              # QA 截图与端到端脚本
└── package.json
```

## 专辑 / 进度记忆 / 内嵌封面

- **专辑库**：左侧 **专辑** 视图，总汇诸文件夹。右上 **＋ 导入**，可一次多选数文件夹（所选目录若不含音频，则改导入其子文件夹）；点卡片为 **预览**（展开曲目列表），预览中 **载入并播放** 方切至该专辑。卡片之右，可 **设封面**（整张专辑共用）或 **从列表移除**（不删文件）。
- **播放进度与队列**：闭而再开，自复上次之文件夹、曲目与播放位置（每曲单独记之）。切歌之时，亦各记其位。
- **内嵌封面**：若目录下无 `cover.*` 等图，则自音频标签提取内嵌封面，缓存于用户目录，列表缩略图与播放器封面皆用之。


## 许可证 / License

依 [MIT](./LICENSE) 许可。

呜呼，此文尽于此。诸君若觉可用，便取去；若觉不足，自行 fork 可也。
