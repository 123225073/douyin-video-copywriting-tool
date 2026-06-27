# 抖音视频文案提取工具验收记录

验收日期：2026-06-26

## 已完成检查

| 检查项 | 结果 |
| --- | --- |
| 页面不显示假热度、假文案、假模型结果 | 通过 |
| 抖音链接为空时点击解析 | 通过，显示真实错误提示 |
| 无视频时点击播放、识别、改写 | 通过，显示真实引导提示 |
| 手动上传真实 MP4 视频 | 通过 |
| 上传后在线播放 | 通过 |
| 上传后下载视频 | 通过 |
| 读取真实视频信息 | 通过，读取到 00:13、640x360、561.4KB |
| 抽取关键帧 | 通过，生成 6 张真实视频帧 |
| 时间轴显示真实抽帧位置 | 通过 |
| 读取视频总帧数 / FPS | 通过，测试视频读取到 980 帧、30 FPS |
| 用户勾选全帧抽取 | 通过，页面预计抽取 980 帧；后端 every-frame 测试 processed=400/400 |
| 用户填写抽帧频率 | 通过，设置 8 秒/帧后预计抽取 6 帧并生成 6 张真实画面 |
| 内置本地 OCR 能力 | 通过，参考 `video-subtitle-extractor` 的思路实现为工具内部能力，运行时不依赖个人 Skill 目录 |
| 后端快速抽帧 | 通过，8 秒/帧测试约 1.03 秒完成 6 张真实预览；全帧 980 帧预览约 10.29 秒完成并自动限量展示 |
| Logo / 水印过滤 | 通过，`BALNO / CERAMICS / 巴里诺` 等固定 Logo、品牌水印不进入主文案和 SRT |
| SRT 字幕输出 | 通过，界面只保留 SRT 字幕下载，不再展示 TXT / CSV / 候选记录 |
| 接口返回收窄 | 通过，OCR 接口不再返回 stdout、原始候选数组、TXT/CSV 链接等内部调试内容 |
| CPA 设置弹窗 | 通过，支持 Base URL、API Key、获取模型、保存 |
| 抖音解析增强设置 | 通过，支持可选抖音 Cookie，本地保存且接口不返回明文 |
| 自动获取抖音 Cookie | 通过，支持打开专用抖音登录窗口并自动读取 Cookie，避免读取当前 Chrome/Edge 时的数据库占用问题 |
| Cookie 可视化 | 通过，设置弹窗显示 Cookie 数量、登录态、名称和脱敏预览 |
| 抖音链接真实解析 | 通过，`https://www.douyin.com/video/7592431798023243194` 已通过专用浏览器抓取保存为本地 MP4 |
| 解析动态过程 | 通过，解析时显示候选链接、yt-dlp、浏览器 Cookie、网页源码、专用浏览器抓取等阶段 |
| 解析记录弹窗 | 通过，解析开始自动弹出，可隐藏，可通过按钮重新打开，不再撑开主页面 |
| 外部解析 API 接入 | 通过，设置里新增抖音解析 API URL 模板和 API Key，优先使用 API，不打开抖音网页 |
| Cookie 占用误报 | 通过，已取消读取系统 Chrome/Edge Cookie 数据库，不再走 `cookies-from-browser` 路径 |
| CPA 获取模型失败提示 | 通过，显示中文错误 |
| 移动端横向溢出 | 通过，无横向溢出 |
| 构建检查 | 通过，`npm run build` 成功；实际入口 JS 无浏览器 `currentTime / canvas / toDataURL` 抽帧残留 |
| 后端语法检查 | 通过，`node --check server.mjs` 成功 |
| 浏览器端到端检查 | 通过，上传真实视频后抽帧 6 张、OCR 输出 `肌理·光感·触感`、SRT 下载可见，无控制台错误 |

## 测试截图

- `qa-screenshots/final-check-01-empty.png`
- `qa-screenshots/final-check-02-upload.png`
- `qa-screenshots/final-check-03-frames.png`
- `qa-screenshots/final-check-04-settings-error.png`
- `qa-screenshots/final-check-05-timeline-markers.png`
- `qa-screenshots/final-check-06-mobile.png`
- `qa-screenshots/frame-frequency-and-watermark-controls.png`
- `qa-screenshots/local-ocr-skill-result.png`
- `qa-screenshots/final-check-07-douyin-search-url-error.png`
- `qa-screenshots/final-check-08-douyin-cookie-setting.png`
- `qa-screenshots/final-check-09-auto-cookie-buttons.png`
- `qa-screenshots/final-check-10-cookie-preview.png`
- `qa-screenshots/final-check-11-resolve-progress.png`
- `qa-screenshots/final-check-12-douyin-success.png`
- `qa-screenshots/final-check-13-resolve-modal.png`

## 仍需真实配置后复测

以下功能已经完成真实接口接入，但如果没有用户的 CPA API Key，尚未做真实端到端调用：

- 获取真实模型列表
- AI 文案改写

OCR 画面文字识别现在是工具内置能力，不再依赖 CPA API Key，也不在运行时调用本机 `video-subtitle-extractor` Skill。工具只把识别内容写入页面对应位置，并额外提供带时间线的 SRT 字幕文件下载。

全帧 OCR 不需要等待视频播放完成，但它仍然要逐帧做文字识别，耗时取决于帧数和电脑性能。400 帧样本全帧 OCR 测试实际处理 400/400 帧，约 100 秒完成；长视频建议优先使用“抽帧频率”模式。

抖音链接解析已升级为多策略解析：外部解析 API 优先、链接清洗、搜索页/非视频页识别、短链展开、最新版 yt-dlp、Chrome 指纹、专用 Cookie 文件、网页视频地址兜底、专用浏览器响应体抓取。已验证单条视频链接可成功提取为本地 MP4。若输入的是没有 `https://` 的抖音口令，请配置可解析口令的外部 API，或复制 `https://v.douyin.com/...` 短链。

## 2026-06-26 黑屏视频修复复测

- 问题原因：部分抖音响应会返回不完整 MP4 片段，文件名和大小看起来像视频，但读取不到时长、宽高和帧数，前端因此出现“解析成功但播放器黑屏”。
- 修复结果：后端保存解析结果前必须确认视频可播放；浏览器抓取到的无效片段会被拒绝，不再写入新的成功记录。
- 前端保护：如果浏览器仍然遇到不可播放的视频文件，会自动清空播放器，并把“视频来源 / 本地文件”标为失败。
- 反向复测：`https://v.douyin.com/Deo-CTCLBl0/` 现在返回失败提示，不再显示解析成功。
- 正向复测：`https://www.douyin.com/video/7592431798023243194` 仍可解析成功，生成本地 MP4，读取到 37.33 秒、1058 帧、1080x1920。
- 浏览器端复测：真实点击页面“解析链接”后，弹出解析记录窗口，视频元素成功加载，截图：`qa-screenshots/douyin-success-after-fix.png`。
- 非黑屏帧复测：关闭弹窗并跳到第 2 秒，画布检测亮像素占比 71%、彩色像素占比 69%，截图：`qa-screenshots/douyin-visible-frame-after-fix.png`。

## 2026-06-27 2 秒误抓修复复测

- 测试链接：`https://v.douyin.com/72Pc3ZRebuE/`
- 问题原因：目标页面会同时加载 `uuu_265.mp4` 等约 2 秒播放器/页面动效素材；旧浏览器兜底把任意 `video/mp4` 响应都当候选，可能误抓非目标视频。
- 参考资料：B 站教程 `BV1Q2DCBqEo9` 的有效思路是“浏览器自动化 + 网络数据分析 + JSON 解析 + 批量保存”，本次采用其中的网络详情 JSON 解析思路。
- 修复结果：新增“隐藏浏览器详情接口”链路，读取目标 `aweme/detail` JSON 后只下载目标视频地址，不再优先依赖可见浏览器播放抓包。
- 静态素材过滤：`douyin-pc-web`、`uuu_*.mp4`、播放动效、下载引导动效等页面素材不再进入视频候选。
- 下载结果：成功下载 234.6 秒、7038 帧、1920x1080 的目标视频。
- 解析耗时：本次约 26.09 秒，主要耗时来自 26.1 MB 视频文件下载。
- OCR 说明：该视频是人声讲解 + 屏幕录制，纯全屏 OCR 会识别到浏览器、网页按钮、代码界面等屏幕文字；口播文案应优先走语音识别，OCR 只作为字幕/屏幕文字补充。
