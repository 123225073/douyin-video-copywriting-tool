import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconBrandTiktok,
  IconUpload,
  IconDownload,
  IconPlayerPlay,
  IconRefresh,
  IconCopy,
  IconSettings,
  IconShieldCheck,
  IconLink,
  IconMicrophone,
  IconScan,
  IconSparkles,
  IconBrain,
  IconKey,
  IconMovie,
  IconClock,
  IconPhotoScan,
  IconX,
  IconAlertTriangle,
  IconCheck,
  IconFileText,
  IconChevronDown,
} from "@tabler/icons-react";

const STEPS = [
  { key: "source", icon: IconMovie, title: "视频来源", idle: "等待链接或上传", active: "正在读取视频", done: "视频已就绪" },
  { key: "download", icon: IconDownload, title: "本地文件", idle: "未生成文件", active: "正在保存文件", done: "可播放 / 可下载" },
  { key: "asr", icon: IconMicrophone, title: "语音识别", idle: "等待运行", active: "正在请求 ASR", done: "语音识别完成" },
  { key: "ocr", icon: IconScan, title: "画面识别", idle: "等待抽帧", active: "正在识别画面", done: "OCR 识别完成" },
  { key: "merge", icon: IconBrain, title: "文案合并", idle: "等待结果", active: "正在整理文案", done: "真实文案已整理" },
  { key: "rewrite", icon: IconSparkles, title: "AI 改写", idle: "等待文案", active: "正在改写", done: "改写完成" },
];

const VIEW_TABS = [
  { key: "timeline", label: "时间轴" },
  { key: "frames", label: "关键帧" },
  { key: "logs", label: "运行日志" },
];

const DEFAULT_SETTINGS = {
  baseUrl: "",
  apiKey: "",
  apiKeySaved: false,
  douyinCookie: "",
  douyinCookieSaved: false,
  parserApiTemplate: "",
  parserApiKey: "",
  parserApiKeySaved: false,
  model: "",
  transcriptionModel: "whisper-1",
  models: [],
};

function App() {
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const [douyinUrl, setDouyinUrl] = useState("");
  const [media, setMedia] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [frameInfo, setFrameInfo] = useState(null);
  const [frameMode, setFrameMode] = useState("interval");
  const [sampleInterval, setSampleInterval] = useState(0.25);
  const [stripWatermarks, setStripWatermarks] = useState(true);
  const [frames, setFrames] = useState([]);
  const [transcript, setTranscript] = useState("");
  const [visualText, setVisualText] = useState("");
  const [tags, setTags] = useState([]);
  const [ocrArtifacts, setOcrArtifacts] = useState(null);
  const [ocrSubtitleCount, setOcrSubtitleCount] = useState(0);
  const [variants, setVariants] = useState([]);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [lengthMode, setLengthMode] = useState("标准");
  const [creativity, setCreativity] = useState(0.62);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [resolveSteps, setResolveSteps] = useState([]);
  const [resolvePanelOpen, setResolvePanelOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState("timeline");
  const [logs, setLogs] = useState(["等待输入抖音链接，或上传本地视频开始。"]);
  const [stepState, setStepState] = useState({
    source: "idle",
    download: "idle",
    asr: "idle",
    ocr: "idle",
    merge: "idle",
    rewrite: "idle",
  });

  const sourceText = useMemo(() => [transcript, visualText].filter(Boolean).join("\n\n"), [transcript, visualText]);
  const selectedRewrite = variants[selectedVariant];
  const canUseModel = Boolean(settings.model && settings.apiKeySaved && settings.baseUrl);
  const fileSize = metadata?.size || media?.size || 0;
  const effectiveFps = frameInfo?.fps || media?.fps || 0;
  const effectiveFrameCount = frameInfo?.frameCount || media?.frameCount || 0;
  const expectedFrameCount = estimateCaptureCount({ mode: frameMode, duration: metadata?.duration, fps: effectiveFps, frameCount: effectiveFrameCount, interval: sampleInterval });
  const ocrSrtUrl = ocrArtifacts?.srt;

  useEffect(() => {
    loadSettings();
  }, []);

  function addLog(message) {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogs((items) => [`${time} ${message}`, ...items].slice(0, 12));
  }

  function updateStep(key, state) {
    setStepState((current) => ({ ...current, [key]: state }));
  }

  function resetResults() {
    setTranscript("");
    setVisualText("");
    setTags([]);
    setOcrArtifacts(null);
    setOcrSubtitleCount(0);
    setVariants([]);
    setSelectedVariant(0);
    setFrames([]);
    setStepState({
      source: "idle",
      download: "idle",
      asr: "idle",
      ocr: "idle",
      merge: "idle",
      rewrite: "idle",
    });
  }

  function clearCurrentMedia(message) {
    setMedia(null);
    setMetadata(null);
    setFrameInfo(null);
    setFrames([]);
    updateStep("source", "error");
    updateStep("download", "error");
    if (message) setNotice(message);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      throw new Error(data.error || data.message || text || "请求失败");
    }
    return data;
  }

  async function loadSettings() {
    try {
      const data = await api("/api/settings");
      setSettings({ ...DEFAULT_SETTINGS, ...data });
      setSettingsDraft({ ...DEFAULT_SETTINGS, ...data, apiKey: "" });
    } catch (error) {
      addLog(`读取 CPA 设置失败：${error.message}`);
    }
  }

  function setMediaReady(nextMedia) {
    resetResults();
    setMedia(nextMedia);
    setFrameInfo({
      fps: nextMedia.fps || 0,
      frameCount: nextMedia.frameCount || 0,
      duration: nextMedia.duration || 0,
      width: nextMedia.width || 0,
      height: nextMedia.height || 0,
    });
    setMetadata({
      name: nextMedia.originalName || nextMedia.fileName || "本地视频",
      size: nextMedia.size || 0,
      type: nextMedia.mimeType || "video/*",
      duration: nextMedia.duration || 0,
      width: nextMedia.width || 0,
      height: nextMedia.height || 0,
    });
    updateStep("source", "done");
    updateStep("download", "done");
    addLog(`视频已就绪：${nextMedia.originalName || nextMedia.fileName}`);
    loadMediaInfo(nextMedia.id);
  }

  async function loadMediaInfo(mediaId) {
    if (!mediaId) return;
    try {
      const data = await api("/api/media-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId }),
      });
      setFrameInfo(data.info || null);
      setMedia((current) => (current?.id === mediaId ? { ...current, ...(data.media || {}) } : current));
      setMetadata((current) => ({
        ...current,
        duration: data.info?.duration || current?.duration || 0,
        width: data.info?.width || current?.width || 0,
        height: data.info?.height || current?.height || 0,
      }));
      addLog(`读取到帧信息：${data.info?.frameCount || 0} 帧，${formatFps(data.info?.fps)} FPS。`);
    } catch (error) {
      addLog(`读取帧信息失败：${error.message}`);
    }
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setNotice("请选择视频文件。");
      return;
    }
    setBusy("upload");
    updateStep("source", "active");
    updateStep("download", "active");
    setNotice("");
    try {
      const form = new FormData();
      form.append("video", file);
      const data = await api("/api/upload", { method: "POST", body: form });
      setMediaReady(data.media);
      setNotice("视频上传成功，可以播放、下载、抽帧和识别。");
    } catch (error) {
      updateStep("source", "error");
      updateStep("download", "error");
      setNotice(error.message);
      addLog(`上传失败：${error.message}`);
    } finally {
      setBusy("");
      event.target.value = "";
    }
  }

  async function handleDouyinExtract() {
    if (!douyinUrl.trim()) {
      setNotice("请先输入抖音链接。");
      return;
    }
    setBusy("douyin");
    resetResults();
    setMedia(null);
    setMetadata(null);
    setFrameInfo(null);
    updateStep("source", "active");
    updateStep("download", "active");
    const liveSteps = ["识别输入内容", "展开短链/读取当前抖音窗口", "尝试 yt-dlp", "尝试网页源码", "尝试专用浏览器抓取视频资源"];
    setResolveSteps([{ text: "开始解析抖音输入内容", state: "active" }]);
    setResolvePanelOpen(true);
    setNotice("正在真实解析抖音链接，下面会显示每一步尝试。");
    let stepIndex = 0;
    const timer = window.setInterval(() => {
      stepIndex = Math.min(stepIndex + 1, liveSteps.length - 1);
      setResolveSteps((items) => {
        const next = [...items];
        const text = liveSteps[stepIndex];
        if (!next.some((item) => item.text === text)) next.push({ text, state: "active" });
        return next.slice(-8);
      });
    }, 1600);
    try {
      const data = await api("/api/douyin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: douyinUrl.trim() }),
      });
      setMediaReady(data.media);
      setResolveSteps([...(data.attempts || []).map((text) => ({ text, state: "done" })), { text: `解析成功：${data.strategy || "未知策略"}`, state: "done" }].slice(-10));
      setNotice(`抖音视频解析成功，已保存到本地。策略：${data.strategy || "真实解析"}`);
    } catch (error) {
      updateStep("source", "error");
      updateStep("download", "error");
      setResolveSteps((items) => [...items.map((item) => ({ ...item, state: "done" })), { text: error.message, state: "error" }].slice(-10));
      setNotice(`${error.message} 可上传视频文件继续分析。`);
      addLog(`抖音解析失败：${error.message}`);
    } finally {
      window.clearInterval(timer);
      setBusy("");
    }
  }

  function handleMetadata() {
    const element = videoRef.current;
    if (!element || !media) return;
    const next = {
      name: media.originalName || media.fileName,
      size: media.size || 0,
      type: media.mimeType || "video/*",
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      width: element.videoWidth || 0,
      height: element.videoHeight || 0,
    };
    setMetadata(next);
    if (!frameInfo?.frameCount && media?.id) loadMediaInfo(media.id);
    addLog(`读取到视频元数据：${formatDuration(next.duration)}，${next.width || "-"}x${next.height || "-"}`);
  }

  async function handlePlay() {
    if (!videoRef.current) {
      setNotice("请先上传或解析视频。");
      return;
    }
    try {
      if (videoRef.current.paused) {
        await videoRef.current.play();
        addLog("视频开始播放。");
      } else {
        videoRef.current.pause();
        addLog("视频已暂停。");
      }
    } catch (error) {
      setNotice(`播放失败：${error.message}`);
    }
  }

  function handleDownload() {
    if (!media?.url) {
      setNotice("没有可下载的视频文件。");
      return;
    }
    const link = document.createElement("a");
    link.href = media.url;
    link.download = media.originalName || media.fileName || "video.mp4";
    document.body.appendChild(link);
    link.click();
    link.remove();
    addLog("已触发视频下载。");
  }

  async function handleCaptureFrames() {
    if (!media) {
      setNotice("请先上传或解析视频。");
      return;
    }
    setBusy("frames");
    setNotice("");
    try {
      const mode = frameMode === "every-frame" ? "every-frame" : "interval";
      const interval = Math.max(0.05, Number(sampleInterval) || 0.25);
      const data = await api("/api/extract-frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId: media.id,
          mode,
          sampleInterval: interval,
          stripWatermark: stripWatermarks,
          maxPreview: 240,
        }),
      });
      const captures = Array.isArray(data.frames) ? data.frames : [];
      setFrames(captures);
      if (data.frameCount || data.fps) {
        setFrameInfo({
          fps: data.fps || effectiveFps,
          frameCount: data.frameCount || effectiveFrameCount,
          duration: data.duration || metadata?.duration || 0,
          width: data.width || metadata?.width || 0,
          height: data.height || metadata?.height || 0,
        });
      }
      const modeLabel = mode === "every-frame" ? `全帧 ${data.plannedCount || expectedFrameCount} 帧` : `每 ${interval.toFixed(2)} 秒 1 帧`;
      addLog(`后端快速抽帧完成：${modeLabel}，展示 ${captures.length} 张预览${data.previewLimited ? "（已自动压缩预览数量）" : ""}。`);
      setNotice(`抽帧完成：实际计划 ${data.plannedCount || captures.length} 帧，当前展示 ${captures.length} 张预览。`);
      setActiveTab("frames");
    } catch (error) {
      setNotice(error.message);
      addLog(`抽帧失败：${error.message}`);
    } finally {
      setBusy("");
    }
  }

  async function handleTranscribe() {
    if (!media) {
      setNotice("请先上传或解析视频。");
      return;
    }
    if (!settings.apiKeySaved || !settings.baseUrl) {
      setSettingsOpen(true);
      setNotice("请先在 CPA 设置中填写 Base URL 和 API Key。");
      return;
    }
    setBusy("asr");
    updateStep("asr", "active");
    setNotice("");
    try {
      const data = await api("/api/transcribe-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: media.id, model: settings.transcriptionModel }),
      });
      setTranscript(data.text || "");
      updateStep("asr", data.text ? "done" : "idle");
      updateStep("merge", data.text || visualText ? "done" : "idle");
      addLog(data.text ? "语音识别完成。" : "语音识别完成，但未识别到文字。");
    } catch (error) {
      updateStep("asr", "error");
      setNotice(error.message);
      addLog(`语音识别失败：${error.message}`);
    } finally {
      setBusy("");
    }
  }

  async function handleOcr() {
    if (!media) {
      setNotice("请先上传或解析视频。");
      return;
    }
    setBusy("ocr");
    updateStep("ocr", "active");
    setNotice("");
    try {
      const mode = frameMode === "every-frame" ? "every-frame" : "interval";
      const interval = Math.max(0.05, Number(sampleInterval) || 0.25);
      setNotice(mode === "every-frame" ? "后端正在快速抽帧并逐帧 OCR，不需要等待视频播放完成。" : `后端正在快速抽帧并 OCR，每 ${interval.toFixed(2)} 秒读取 1 帧。`);
      const data = await api("/api/extract-subtitles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId: media.id,
          mode,
          sampleInterval: interval,
          includeWatermark: !stripWatermarks,
        }),
      });
      setVisualText(data.visualText || "");
      setTags(data.tags || []);
      setOcrArtifacts(data.artifacts || null);
      setOcrSubtitleCount(Number(data.subtitleCount || 0));
      if (data.info) setFrameInfo(data.info);
      updateStep("ocr", data.visualText || data.tags?.length ? "done" : "idle");
      updateStep("merge", transcript || data.visualText ? "done" : "idle");
      const filteredCount = Number(data.filteredWatermarkCount || 0);
      addLog(data.visualText ? `后端 OCR 完成：${data.mode === "every-frame" ? "全帧" : `每 ${data.sampleInterval}s`}，已去重并过滤 ${filteredCount} 个固定 Logo/水印项。` : `后端 OCR 完成，过滤 ${filteredCount} 个固定 Logo/水印项，但未读取到可用文字。`);
      setNotice(data.visualText ? `OCR 识别完成，已合并去重并过滤固定 Logo/水印（${filteredCount} 项）。` : `OCR 已完成，已过滤固定 Logo/水印（${filteredCount} 项），但没有识别到可用文字。`);
    } catch (error) {
      updateStep("ocr", "error");
      setNotice(error.message);
      addLog(`OCR 识别失败：${error.message}`);
    } finally {
      setBusy("");
    }
  }

  async function handleRewrite() {
    if (!sourceText.trim()) {
      setNotice("没有真实识别文案，不能改写。请先运行语音识别或 OCR。");
      return;
    }
    if (!canUseModel) {
      setSettingsOpen(true);
      setNotice("请先配置 CPA 模型。");
      return;
    }
    setBusy("rewrite");
    updateStep("rewrite", "active");
    setNotice("");
    try {
      const data = await api("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sourceText,
          model: settings.model,
          lengthMode,
          creativity,
        }),
      });
      setVariants(data.variants || []);
      setSelectedVariant(0);
      updateStep("rewrite", "done");
      addLog("AI 改写完成。");
    } catch (error) {
      updateStep("rewrite", "error");
      setNotice(error.message);
      addLog(`AI 改写失败：${error.message}`);
    } finally {
      setBusy("");
    }
  }

  async function copyText(text, label) {
    if (!text?.trim()) {
      setNotice(`没有可复制的${label}。`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label}已复制。`);
      addLog(`${label}已复制到剪贴板。`);
    } catch {
      setNotice("浏览器禁止直接复制，请手动选中文案复制。");
    }
  }

  async function handleFetchModels() {
    setBusy("models");
    setNotice("");
    setSettingsNotice("");
    try {
      const data = await api("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: settingsDraft.baseUrl,
          apiKey: settingsDraft.apiKey,
        }),
      });
      const first = data.models[0] || "";
      setSettingsDraft((draft) => ({ ...draft, models: data.models, model: draft.model || first }));
      setSettingsNotice(`已获取 ${data.models.length} 个模型。`);
    } catch (error) {
      setSettingsNotice(`连接失败：${error.message || "请检查 Base URL、API Key 和网络连接。"}`);
    } finally {
      setBusy("");
    }
  }

  async function handleSaveSettings() {
    setBusy("save-settings");
    setNotice("");
    setSettingsNotice("");
    try {
      const data = await api("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsDraft),
      });
      setSettings({ ...DEFAULT_SETTINGS, ...data });
      setSettingsDraft({ ...DEFAULT_SETTINGS, ...data, apiKey: "" });
      setSettingsOpen(false);
      setNotice("CPA 设置已保存。");
      addLog("CPA 设置已保存。");
    } catch (error) {
      setSettingsNotice(`保存失败：${error.message}`);
    } finally {
      setBusy("");
    }
  }

  async function handleOpenDouyinCookieBrowser() {
    setBusy("cookie-open");
    setSettingsNotice("");
    try {
      const data = await api("/api/douyin-cookie/open", { method: "POST" });
      setSettingsNotice(data.message || "已打开抖音登录窗口。登录完成后点击“自动读取 Cookie”。");
    } catch (error) {
      setSettingsNotice(`打开失败：${error.message}`);
    } finally {
      setBusy("");
    }
  }

  async function handleReadDouyinCookie() {
    setBusy("cookie-read");
    setSettingsNotice("");
    try {
      const data = await api("/api/douyin-cookie/read", { method: "POST" });
      setSettings({ ...DEFAULT_SETTINGS, ...data });
      setSettingsDraft((draft) => ({ ...draft, ...data, apiKey: "", douyinCookie: "" }));
      const cookieInfo = data.douyinCookieInfo || {};
      const loginText = cookieInfo.hasLoginCookie || data.hasLoginCookie ? "已读取登录 Cookie" : "已读取游客 Cookie";
      setSettingsNotice(`${loginText}，共 ${cookieInfo.count || data.cookieCount || 0} 项，已保存到本地。下方会显示脱敏明细。`);
      addLog("抖音 Cookie 已自动读取并保存。");
    } catch (error) {
      setSettingsNotice(`读取失败：${error.message}`);
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="app-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="topbar compact-topbar">
        <section className="brand-block" aria-label="产品名称">
          <div className="brand-mark">
            <IconBrandTiktok size={23} stroke={2.4} />
          </div>
          <div>
            <h1>抖音爆款视频复刻实验室</h1>
            <p>本地视频解析、真实识别、CPA 改写</p>
          </div>
          <span className="edition">真实工具版</span>
        </section>

        <section className="command-bar" aria-label="视频输入">
          <div className="url-box">
            <IconBrandTiktok size={19} />
            <input
              aria-label="抖音链接"
              value={douyinUrl}
              onChange={(event) => setDouyinUrl(event.target.value)}
              placeholder="粘贴抖音链接；解析失败时可改用上传视频"
            />
          </div>
          <button className="primary-action" type="button" onClick={handleDouyinExtract} disabled={busy === "douyin"}>
            <IconLink size={17} />
            {busy === "douyin" ? "解析中" : "解析链接"}
          </button>
          <button className="secondary-command" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy === "upload"}>
            <IconUpload size={17} />
            {busy === "upload" ? "上传中" : "上传视频"}
          </button>
          <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={handleUpload} />
          <button className="settings-command" type="button" onClick={() => setSettingsOpen(true)}>
            <IconSettings size={18} />
            CPA 设置
          </button>
        </section>
      </header>

      {notice && (
        <div className="notice-bar">
          <IconAlertTriangle size={17} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>关闭</button>
        </div>
      )}

      <section className="workbench">
        <aside className="video-zone panel">
          <div className="source-summary">
            <Metric label="来源" value={media ? (media.source === "douyin" ? "抖音解析" : "本地上传") : "未载入"} />
            <Metric label="时长" value={metadata?.duration ? formatDuration(metadata.duration) : "-"} />
            <Metric label="总帧数" value={effectiveFrameCount ? `${effectiveFrameCount}` : "-"} />
            <Metric label="FPS" value={effectiveFps ? formatFps(effectiveFps) : "-"} />
            <Metric label="分辨率" value={metadata?.width ? `${metadata.width}x${metadata.height}` : "-"} />
            <Metric label="大小" value={fileSize ? formatBytes(fileSize) : "-"} />
          </div>

          <div className={`video-frame ${media ? "has-video" : "empty-video"}`}>
            {media ? (
              <>
                <video
                  ref={videoRef}
                  src={media.url}
                  controls
                  preload="metadata"
                  onLoadedMetadata={handleMetadata}
                  onError={() => {
                    clearCurrentMedia("当前解析到的视频文件无法播放，已拦截为失败结果。请重新解析链接，或直接上传视频。");
                    addLog("视频文件无法播放，已清空当前播放器。");
                  }}
                />
                <div className="recognition-badge">
                  <span>REAL SOURCE</span>
                  <strong>{media.originalName || media.fileName}</strong>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <IconMovie size={46} />
                <strong>还没有视频</strong>
                <p>请上传本地视频，或尝试解析抖音链接。页面不会显示任何假识别结果。</p>
                <button type="button" onClick={() => fileInputRef.current?.click()}>
                  <IconUpload size={18} />
                  选择视频
                </button>
              </div>
            )}
          </div>

          <div className="video-actions">
            <button className="play-button" type="button" onClick={handlePlay}>
              <IconPlayerPlay size={18} />
              播放 / 暂停
            </button>
            <button className="secondary-button" type="button" onClick={handleDownload}>
              <IconDownload size={18} />
              下载视频
            </button>
            <button className="secondary-button" type="button" onClick={handleCaptureFrames} disabled={busy === "frames"}>
              <IconPhotoScan size={18} />
              {busy === "frames" ? "抽帧中" : "按设置抽帧"}
            </button>
          </div>
          <section className="frame-settings" aria-label="抽帧设置">
            <label className="check-line">
              <input type="checkbox" checked={frameMode === "every-frame"} onChange={(event) => setFrameMode(event.target.checked ? "every-frame" : "interval")} />
              <span>全帧抽取</span>
            </label>
            <label className="number-line">
              <span>抽帧频率</span>
              <input
                type="number"
                min="0.05"
                max="30"
                step="0.05"
                value={sampleInterval}
                disabled={frameMode === "every-frame"}
                onChange={(event) => setSampleInterval(event.target.value)}
              />
              <em>秒/帧</em>
            </label>
            <label className="check-line">
              <input type="checkbox" checked={stripWatermarks} onChange={(event) => setStripWatermarks(event.target.checked)} />
              <span>忽略 Logo / 水印区域</span>
            </label>
            <div className="frame-estimate">
              预计抽取 <strong>{expectedFrameCount || "-"}</strong> 帧
            </div>
            <p className="frame-help">后端直接读取视频帧，不需要等待视频播放完成；全帧预览会自动限量展示。</p>
          </section>
        </aside>

        <section className="pipeline-zone panel">
          <div className="panel-title">
            <div>
              <h2>复刻链路</h2>
              <p>每一步只显示真实运行状态</p>
            </div>
            <span className={busy ? "live-pill running" : "live-pill"}>
              {busy ? "运行中" : "待命"}
            </span>
          </div>
          <div className="pipeline-list">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const state = stepState[step.key] || "idle";
              return (
                <article className={`pipeline-step ${state}`} key={step.key}>
                  <div className="step-index">{index + 1}</div>
                  <div className="step-icon">
                    <Icon size={22} />
                  </div>
                  <div className="step-copy">
                    <h3>{step.title}</h3>
                    <p>{state === "done" ? step.done : state === "active" ? step.active : state === "error" ? "失败，查看提示" : step.idle}</p>
                  </div>
                  <strong>{stateLabel(state)}</strong>
                </article>
              );
            })}
          </div>
          <div className="pipeline-actions">
            <button type="button" onClick={handleTranscribe} disabled={busy === "asr"}>
              <IconMicrophone size={17} />
              语音识别
            </button>
            <button type="button" onClick={handleOcr} disabled={busy === "ocr"}>
              <IconScan size={17} />
              OCR识别
            </button>
            <button className="accent" type="button" onClick={handleRewrite} disabled={busy === "rewrite"}>
              <IconSparkles size={17} />
              AI改写
            </button>
          </div>
          {!!resolveSteps.length && (
            <button className="resolve-toggle" type="button" onClick={() => setResolvePanelOpen(true)}>
              {busy === "douyin" ? "查看解析过程" : "查看最近解析记录"}
            </button>
          )}
        </section>

        <aside className="copy-zone panel">
          <div className="panel-title compact">
            <div>
              <h2>文案智能看板</h2>
              <p>{canUseModel ? `模型：${settings.model}` : "未配置 CPA 模型"}</p>
            </div>
            <button className="tiny-action" type="button" onClick={() => copyText(composeAllText(sourceText, variants), "全部内容")}>
              <IconCopy size={16} />
              一键复制
            </button>
          </div>

          <section className="copy-card original-copy">
            <div className="copy-head">
              <h3>真实识别文案 <span>语音 + 画面</span></h3>
              <button type="button" onClick={() => copyText(sourceText, "识别文案")}>
                <IconCopy size={15} />
                复制
              </button>
            </div>
            {sourceText ? (
              <div className="copy-scroll">
                {transcript && <p><strong>语音：</strong>{transcript}</p>}
                {visualText && <p><strong>画面：</strong>{visualText}</p>}
              </div>
            ) : (
              <div className="soft-empty">还没有真实识别结果。请先上传/解析视频，然后运行语音识别或 OCR。</div>
            )}
            {!!tags.length && (
              <div className="tag-row">
                {tags.map((chip) => <span key={chip}>{chip}</span>)}
              </div>
            )}
            {ocrSrtUrl && (
              <div className="artifact-row">
                <a href={ocrSrtUrl} target="_blank" rel="noreferrer">下载 SRT 字幕</a>
                <span>{ocrSubtitleCount ? `已生成 ${ocrSubtitleCount} 条时间线字幕` : "已生成时间线字幕文件"}</span>
              </div>
            )}
          </section>

          <section className="copy-card rewrite-card">
            <div className="copy-head">
              <h3>AI 改写 <span>基于真实识别文案</span></h3>
              <button type="button" onClick={handleRewrite} disabled={busy === "rewrite"}>
                <IconRefresh size={15} />
                换一批
              </button>
            </div>
            <div className="variant-tabs">
              {variants.length ? variants.map((item, index) => (
                <button
                  className={selectedVariant === index ? "active" : ""}
                  key={`${item.name}-${index}`}
                  type="button"
                  onClick={() => setSelectedVariant(index)}
                >
                  {item.name}
                </button>
              )) : <span className="soft-empty compact-empty">等待 AI 改写结果</span>}
            </div>
            {selectedRewrite ? (
              <div className="variant-output">
                <strong>{selectedRewrite.tone}</strong>
                <p>{selectedRewrite.text}</p>
                <button type="button" onClick={() => copyText(selectedRewrite.text, "改写文案")}>
                  <IconCopy size={15} />
                  复制改写文案
                </button>
              </div>
            ) : (
              <div className="soft-empty">没有真实改写结果。请先完成识别，再点击 AI改写。</div>
            )}
          </section>

          <section className="copy-card controls-card">
            <div className="control-row">
              <span>输出长度</span>
              <div className="segmented">
                {["简洁", "标准", "详细"].map((item) => (
                  <button className={lengthMode === item ? "active" : ""} type="button" key={item} onClick={() => setLengthMode(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <label className="range-line">
              <span>创意强度 {creativity.toFixed(2)}</span>
              <input min="0" max="1" step="0.01" type="range" value={creativity} onChange={(event) => setCreativity(Number(event.target.value))} />
            </label>
          </section>
        </aside>

        <section className="timeline-panel panel">
          <nav className="timeline-tabs" aria-label="分析视图">
            {VIEW_TABS.map((tab) => (
              <button className={activeTab === tab.key ? "active" : ""} key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}>
                {tab.label}
              </button>
            ))}
          </nav>
          {activeTab === "timeline" && (
            <TimelineView duration={metadata?.duration || 0} frames={frames} transcript={transcript} visualText={visualText} />
          )}
          {activeTab === "frames" && (
            <div className="frame-strip">
              {frames.length ? frames.map((frame, index) => (
                <div className="frame-chip" key={`${frame.time}-${index}`}>
                  <img src={frame.image} alt={`关键帧 ${index + 1}`} />
                  <span>{formatDuration(frame.time)}</span>
                  <strong>真实抽帧</strong>
                </div>
              )) : <div className="soft-empty">还没有关键帧。点击“抽取关键帧”后显示。</div>}
            </div>
          )}
          {activeTab === "logs" && (
            <div className="log-list">
              {logs.map((item) => <span key={item}>{item}</span>)}
            </div>
          )}
        </section>
      </section>

      {resolvePanelOpen && (
        <section className="modal-layer light-layer" role="dialog" aria-modal="true" aria-label="抖音解析记录">
          <div className="resolve-modal panel">
            <div className="modal-head">
              <div>
                <h2>抖音解析记录</h2>
                <p>{busy === "douyin" ? "正在运行，下面显示真实尝试步骤。" : "最近一次解析过程。"}</p>
              </div>
              <button type="button" onClick={() => setResolvePanelOpen(false)} aria-label="隐藏解析记录">
                <IconX size={20} />
              </button>
            </div>
            <div className={`resolve-progress ${busy === "douyin" ? "running" : ""}`}>
              {(resolveSteps.length ? resolveSteps : [{ text: "暂无解析记录", state: "idle" }]).map((item, index) => (
                <span className={item.state} key={`${item.text}-${index}`}>
                  {item.text}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {settingsOpen && (
        <section className="modal-layer" role="dialog" aria-modal="true" aria-label="CPA 设置">
          <div className="settings-modal panel">
            <div className="modal-head">
              <div>
                <h2>CPA 接入设置</h2>
                <p>填写兼容 OpenAI /v1 的 Base URL 和 API Key，获取模型后保存使用。</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭设置">
                <IconX size={20} />
              </button>
            </div>
            {settingsNotice && (
              <div className="modal-notice">
                <IconAlertTriangle size={16} />
                <span>{settingsNotice}</span>
              </div>
            )}
            <label>
              <span>Base URL</span>
              <input value={settingsDraft.baseUrl} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, baseUrl: event.target.value }))} placeholder="例如：https://api.openai.com/v1" />
            </label>
            <label>
              <span>抖音解析 API（可选，优先使用，不打开抖音网页）</span>
              <input
                value={settingsDraft.parserApiTemplate || ""}
                onChange={(event) => setSettingsDraft((draft) => ({ ...draft, parserApiTemplate: event.target.value }))}
                placeholder="例如：https://你的解析服务/api/download?url={url}"
              />
            </label>
            <label>
              <span>解析 API Key {settings.parserApiKeySaved ? "（已保存，可留空不改）" : "（可选）"}</span>
              <input
                type="password"
                value={settingsDraft.parserApiKey || ""}
                onChange={(event) => setSettingsDraft((draft) => ({ ...draft, parserApiKey: event.target.value }))}
                placeholder="付费解析 API 或 Coze Webhook 需要鉴权时填写"
              />
            </label>
            <label>
              <span>API Key {settings.apiKeySaved ? "（已保存，可留空不改）" : ""}</span>
              <input type="password" value={settingsDraft.apiKey || ""} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, apiKey: event.target.value }))} placeholder="只保存在本地后端配置文件" />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={handleFetchModels} disabled={busy === "models"}>
                <IconRefresh size={16} />
                {busy === "models" ? "获取中" : "获取模型"}
              </button>
              <button className="save" type="button" onClick={handleSaveSettings} disabled={busy === "save-settings"}>
                <IconShieldCheck size={16} />
                保存
              </button>
            </div>
            <label>
              <span>默认改写模型</span>
              <select value={settingsDraft.model} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, model: event.target.value }))}>
                <option value="">先获取模型列表</option>
                {settingsDraft.models.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span>语音识别模型</span>
              <input value={settingsDraft.transcriptionModel} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, transcriptionModel: event.target.value }))} />
            </label>
            <label>
              <span>抖音 Cookie（可选，{settings.douyinCookieSaved ? "已保存，可留空不改" : "提高链接解析成功率"}）</span>
              <div className="cookie-actions">
                <button type="button" onClick={handleOpenDouyinCookieBrowser} disabled={busy === "cookie-open"}>
                  <IconBrandTiktok size={16} />
                  {busy === "cookie-open" ? "打开中" : "打开抖音登录窗口"}
                </button>
                <button type="button" onClick={handleReadDouyinCookie} disabled={busy === "cookie-read"}>
                  <IconShieldCheck size={16} />
                  {busy === "cookie-read" ? "读取中" : "自动读取 Cookie"}
                </button>
              </div>
              <textarea
                value={settingsDraft.douyinCookie || ""}
                onChange={(event) => setSettingsDraft((draft) => ({ ...draft, douyinCookie: event.target.value }))}
                placeholder="一般不用手动填写。优先点击上方按钮自动获取；这里仅作为高级备用输入。"
                rows={3}
              />
              {settings.douyinCookieSaved && (
                <div className="cookie-preview">
                  <div>
                    <strong>{settings.douyinCookieInfo?.hasLoginCookie ? "登录 Cookie 已保存" : "Cookie 已保存"}</strong>
                    <span>{settings.douyinCookieInfo?.count || 0} 项，本地保存，下面为脱敏预览</span>
                  </div>
                  <code>{(settings.douyinCookieInfo?.preview || []).join("; ") || "已保存，但暂无可展示明细"}</code>
                </div>
              )}
            </label>
          </div>
        </section>
      )}
    </main>
  );
}

function TimelineView({ duration, frames, transcript, visualText }) {
  const hasVideoDuration = Boolean(duration && Number.isFinite(duration));
  const markerStep = frames.length > 80 ? Math.ceil(frames.length / 80) : 1;
  const visibleMarkers = frames.filter((_, index) => index % markerStep === 0);
  return (
    <div className="timeline-body">
      <div className="timeline-real">
        {hasVideoDuration ? (
          <div className="timeline-ruler">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index}>{formatDuration((duration * index) / 6)}</span>
            ))}
          </div>
        ) : (
          <div className="soft-empty">还没有真实视频时长。上传或解析视频后显示时间轴。</div>
        )}
        {hasVideoDuration && frames.length ? (
          <div className="marker-line">
            {visibleMarkers.map((frame, index) => (
              <mark key={`${frame.time}-${index}`} style={{ left: `${Math.min(96, Math.max(1, (frame.time / duration) * 100))}%` }}>
                {formatDuration(frame.time)}
              </mark>
            ))}
          </div>
        ) : hasVideoDuration ? (
          <div className="soft-empty">视频时长已读取。点击“抽取关键帧”后，这里会显示真实帧位置。</div>
        ) : null}
        <div className="subtitle-track">
          <span>{transcript ? `语音：${transcript}` : "语音识别未运行或无文字"}</span>
          <span>{visualText ? `画面：${visualText}` : "OCR 未运行或无可见文字"}</span>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function stateLabel(state) {
  if (state === "done") return "完成";
  if (state === "active") return "运行";
  if (state === "error") return "失败";
  return "待命";
}

function formatBytes(bytes) {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)}${units[unit]}`;
}

function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatFps(fps) {
  if (!fps || !Number.isFinite(Number(fps))) return "-";
  return Number(fps).toFixed(Number(fps) % 1 ? 2 : 0);
}

function estimateCaptureCount({ mode, duration, fps, frameCount, interval }) {
  if (!duration && !frameCount) return 0;
  if (mode === "every-frame") {
    return frameCount || Math.max(1, Math.round((duration || 0) * (fps || 30)));
  }
  const seconds = Number(interval) || 0.25;
  return Math.max(1, Math.ceil((duration || 0) / Math.max(0.05, seconds)) + 1);
}

function composeAllText(sourceText, variants) {
  const rewritten = variants.map((item) => `${item.name} ${item.tone}\n${item.text}`).join("\n\n");
  return [sourceText, rewritten].filter(Boolean).join("\n\n");
}

export { App };
