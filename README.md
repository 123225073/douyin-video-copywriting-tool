# 风沙爆款复刻台

一个本地运行的抖音视频解析、文案提取、SRT 字幕生成和 AI 改写工具。适合短视频拆解、爆款文案复刻、素材整理，以及 CPA/OpenAI 兼容接口或 DeepSeek 官方接口接入。

## 核心能力

- 抖音链接解析：输入抖音分享链接，提取真实视频地址，支持在线播放和下载。
- 本地视频上传：不依赖抖音链接，也可以直接上传视频进行识别。
- 快速抽帧：通过后端抽帧，不需要等待视频完整播放。
- 抽帧模式：支持全帧抽取，也支持手动设置抽帧频率。
- 画面文案识别：适合无声视频、只有音效的视频、屏幕字幕视频。
- 本地语音文案识别：内置 `faster-whisper` 转写，适合有配音、有口播的视频。
- 本机配置推荐：检测 CPU、内存、显卡和 Python 依赖，推荐合适的本地语音识别模型。
- 水印过滤：尽量排除 Logo、水印、平台标识等无关区域，减少误识别。
- 文案整理：自动去重、合并、清洗识别结果。
- SRT 导出：生成带时间线的字幕文件。
- AI 改写：支持配置 CPA/OpenAI 兼容接口或 DeepSeek 官方接口，选择模型后改写整条文案。
- 原文校对：原文整理版会结合上下文修正常见同音、近音、OCR/ASR 识别错误，并尽量保持原意不变。
- 刷新保留：当前任务会保存在浏览器本地缓存，刷新页面不会丢失识别和改写结果。
- 一键重置：用户主动点击“重置”后，才会清空当前任务缓存。
- 进度面板：抖音解析和 OCR 识别提供可关闭、可重新打开的进度查看入口。

## 适用场景

- 提取抖音视频里的字幕、口播稿和屏幕文案。
- 把竞品视频文案整理成可复用素材。
- 批量拆解短视频内容结构。
- 用自己的模型接口完成文案改写、仿写、优化。

## 技术组成

- 前端：React + Vite
- 后端：Node.js + Express
- 视频处理：Python + OpenCV
- OCR：RapidOCR
- ASR：faster-whisper
- AI 接口：CPA/OpenAI 兼容接口、DeepSeek 官方接口

## 目录结构

```text
.
├── README.md
├── start-windows.bat
├── tools/
│   └── start-windows.ps1
├── docs/
│   ├── design-directions/
│   └── superpowers/
├── prototype/
│   ├── server.mjs
│   ├── package.json
│   ├── requirements.txt
│   ├── src/
│   └── scripts/
│       ├── extract_frames.py
│       ├── transcribe_media.py
│       └── video_ocr.py
└── .gitignore
```

## 环境要求

- Windows 10/11
- Chrome 或 Edge 浏览器
- 首次启动需要联网安装依赖
- 如果电脑没有 Node.js 或 Python 3，一键启动脚本会优先尝试自动安装；如果自动安装失败，会打开官方下载页面。

本地识别依赖会由一键启动脚本自动安装：

- Node.js 依赖
- Python 依赖：`opencv-python`、`rapidocr_onnxruntime`、`faster-whisper`、`yt-dlp`

首次运行本地语音识别时，`faster-whisper` 会下载模型；如果要打包给他人离线使用，需要提前准备模型缓存。

本地语音识别模型建议：

| 模型 | 适合电脑 | 说明 |
| --- | --- | --- |
| `tiny` | 低配电脑 | 速度最快，准确率最低 |
| `base` | 普通办公电脑 | 轻量稳定 |
| `small` | 大多数电脑 | 默认均衡方案 |
| `medium` | 高内存 / 高配 CPU / 6GB 以上 NVIDIA 显卡 | 准确率更好，速度更慢 |
| `large-v3` | 10GB 以上 NVIDIA 显卡或很高配电脑 | 准确率更高，资源消耗最大 |

工具的 AI 设置页里有“检测配置”按钮，可自动给出推荐模型。

## 一键安装和启动

推荐给普通用户使用这个方式。

1. 打开 GitHub 仓库页面。
2. 点击绿色 `Code` 按钮。
3. 点击 `Download ZIP`。
4. 解压 ZIP 文件。
5. 双击根目录里的 `start-windows.bat`。
6. 等待自动安装和启动，浏览器会自动打开：

```text
http://127.0.0.1:5176/
```

第一次启动会慢一些，因为要安装 Node 依赖、Python 识别依赖，并下载本地语音识别模型。后续再次双击启动会快很多。

使用时请保持启动窗口打开；关闭窗口或按回车停止后，本地服务会退出。

## 手动启动方式

如果你是开发者，也可以手动启动。

进入应用目录：

```bash
cd prototype
```

安装依赖：

```bash
npm install
pip install -r requirements.txt
```

构建前端：

```bash
npm run build
```

启动本地工具：

```bash
npm start
```

也可以一条命令完成构建和启动：

```bash
npm run serve
```

默认访问地址：

```text
http://127.0.0.1:5176/
```

## 使用流程

1. 打开本地页面。
2. 粘贴抖音分享链接，或上传本地视频。
3. 等待视频解析完成，确认视频可以在线播放。
4. 选择抽帧方式：全帧抽取或按频率抽帧。
5. 开始识别视频文案。
6. 查看整理后的文案结果。
7. 按需导出 SRT 字幕。
8. 在设置里选择 CPA 或 DeepSeek，填写 Base URL、API Key，获取模型并保存。
9. 选择模型后进行 AI 改写。
10. 如果需要重新开始，点击顶部“重置”清空当前任务。

## AI 模型配置

工具支持两类改写模型接入：

- CPA/OpenAI 兼容接口
- DeepSeek 官方接口

配置项包括：

- Base URL
- API Key
- 模型列表
- 当前使用模型

配置保存在本地，不会提交到 GitHub。

DeepSeek 设置区提供 API Key 申请入口，方便用户跳转到官方平台获取密钥。

## 线上部署建议

这个工具不是纯静态网页，它需要后端长期运行，并且会处理视频文件、OCR、语音识别、本地模型和后台进度任务。

不建议直接把完整功能部署到 Vercel 或 Cloudflare Workers：

- Vercel / Cloudflare 更适合前端页面、轻量 API、官网或演示页。
- 本工具的完整功能需要 Python、OpenCV、RapidOCR、faster-whisper、yt-dlp、临时视频文件和较长运行时间。
- 上传视频、OCR 全帧识别、语音模型加载、抖音解析等任务，放在 Serverless / Edge 环境里容易超时、丢文件或无法安装依赖。

如果要让别人直接在线使用完整功能，推荐部署到一台云服务器 / VPS / 容器服务器。

建议服务器配置：

| 用途 | 推荐配置 |
| --- | --- |
| 轻量测试 | 2 核 CPU / 4GB 内存 / 40GB 磁盘 |
| 正常商用体验 | 4 核 CPU / 8GB 内存 / 80GB 磁盘 |
| 更快语音识别 | NVIDIA 显卡服务器，或改接第三方语音识别 API |

继续部署线上版时，需要准备：

- 云服务器 IP
- SSH 登录用户和密钥，或临时密码
- 域名，如果需要绑定正式访问地址
- 是否允许服务器保存用户上传的视频和识别结果
- 是否要关闭本地 faster-whisper，改用第三方语音识别 API，降低服务器压力

## 本地数据说明

运行过程中会生成本地数据：

- 上传的视频
- 抖音解析缓存
- 浏览器 Cookie 和页面缓存
- OCR 中间结果
- AI 接口配置
- 字幕导出结果
- 浏览器本地任务缓存，包括当前视频信息、识别文案、AI 改写结果和页面状态

这些内容保存在：

```text
prototype/local-data/
```

该目录已加入 `.gitignore`，不会上传到 GitHub。

## 已排除的内容

为了避免泄露隐私或上传大文件，以下内容不会提交：

- `prototype/local-data/`
- `prototype/node_modules/`
- `prototype/.npm-cache/`
- `prototype/dist/`
- `prototype/qa-screenshots/`
- 日志文件
- 本地视频、音频文件
- API Key、Cookies、环境变量文件

## 当前已验证内容

- 本地构建通过。
- 抖音真实视频解析流程已测试。
- 后端快速抽帧已接入。
- 本地视频上传入口已接入。
- 本地语音识别、OCR 文案识别和 SRT 生成已接入。
- CPA/OpenAI 兼容模型和 DeepSeek 官方模型配置入口已接入。
- 页面刷新保留缓存、一键重置、下拉框对比色优化已验证。
- OCR 识别进度面板和识别结果回填已接入。

## 已知限制

- 抖音链接解析受平台风控影响，某些链接可能需要本机浏览器 Cookie 辅助。
- 语音转文字优先使用本地 `faster-whisper`；如果本地依赖或模型不可用，才会尝试 CPA 音频转写兜底。
- CPA 兜底要求接口明确支持音频转写；普通语言模型或生图模型通常不能识别音频。
- 新电脑首次使用本地语音识别，可能需要等待模型下载。
- 全帧抽取对长视频会消耗较多时间和算力。

## 仓库信息

| 项目 | 内容 |
| --- | --- |
| Repository | `123225073/douyin-video-copywriting-tool` |
| Visibility | Public |
| Description | 风沙爆款复刻台：本地运行的抖音视频解析、字幕/OCR 文案提取、SRT 生成与 CPA/DeepSeek AI 改写工具。 |
| Topics | `douyin`, `video-downloader`, `ocr`, `subtitle-extraction`, `srt`, `ai-copywriting`, `react`, `express`, `opencv`, `rapidocr`, `local-tool` |
