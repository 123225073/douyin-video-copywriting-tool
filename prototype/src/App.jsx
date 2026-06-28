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

const SESSION_CACHE_KEY = "douyin-remake-lab-session-v2";
const DEFAULT_LOGS = ["等待输入抖音链接，或上传本地视频开始。"];
const DEFAULT_STEP_STATE = {
  source: "idle",
  download: "idle",
  asr: "idle",
  ocr: "idle",
  merge: "idle",
  rewrite: "idle",
};

const DEFAULT_SETTINGS = {
  activeAiProvider: "cpa",
  baseUrl: "",
  apiKey: "",
  apiKeySaved: false,
  deepseekBaseUrl: "https://api.deepseek.com",
  deepseekApiKey: "",
  deepseekApiKeySaved: false,
  deepseekModel: "",
  deepseekModels: [],
  asrSimplifiedOnly: false,
  douyinCookie: "",
  douyinCookieSaved: false,
  model: "",
  transcriptionModel: "Systran/faster-whisper-small",
  models: [],
};

const ASR_MODEL_OPTIONS = [
  { value: "Systran/faster-whisper-tiny", label: "faster-whisper-tiny", hint: "低配可用，速度最快" },
  { value: "Systran/faster-whisper-base", label: "faster-whisper-base", hint: "轻量，普通电脑更稳" },
  { value: "Systran/faster-whisper-small", label: "faster-whisper-small", hint: "默认均衡" },
  { value: "Systran/faster-whisper-medium", label: "faster-whisper-medium", hint: "更准，但更慢" },
  { value: "large-v3", label: "faster-whisper-large-v3", hint: "高配电脑/显卡优先" },
];

const OUTPUT_LANGUAGE_OPTIONS = [
  "简体中文",
  "繁体中文",
  "英文",
  "法文",
  "日文",
  "韩文",
  "德文",
  "西班牙文",
  "葡萄牙文",
  "意大利文",
  "越南文",
  "泰文",
  "印尼文",
];

const VIDEO_EXTENSION_PATTERN = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const AI_PROVIDERS = {
  cpa: { label: "CPA 反代", keyUrl: "" },
  deepseek: { label: "DeepSeek 官方", keyUrl: "https://platform.deepseek.com/api_keys" },
};

function readSessionCache() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessionCache(session) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(session));
  } catch {
    try {
      window.localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
        ...session,
        frames: [],
        logs: Array.isArray(session.logs) ? session.logs.slice(0, 6) : DEFAULT_LOGS,
        cacheNote: "关键帧预览因浏览器缓存空间不足未保存，核心文案和视频状态已保存。",
      }));
    } catch {
      // 浏览器缓存被禁用或空间已满时，不影响工具本身继续使用。
    }
  }
}

function clearSessionCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // 忽略浏览器缓存清理失败，页面状态仍会被重置。
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value, fallback = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function safeStepState(value) {
  return { ...DEFAULT_STEP_STATE, ...(safeObject(value, {}) || {}) };
}

function safeActiveTab(value) {
  return VIEW_TABS.some((tab) => tab.key === value) ? value : "timeline";
}

function App() {
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const resolveAutoCloseTimerRef = useRef(null);
  const ocrPollTimerRef = useRef(null);
  const cachedSession = useMemo(() => readSessionCache(), []);
  const [douyinUrl, setDouyinUrl] = useState(cachedSession.douyinUrl || "");
  const [media, setMedia] = useState(safeObject(cachedSession.media, null));
  const [metadata, setMetadata] = useState(safeObject(cachedSession.metadata, null));
  const [frameInfo, setFrameInfo] = useState(safeObject(cachedSession.frameInfo, null));
  const [frameMode, setFrameMode] = useState(cachedSession.frameMode === "every-frame" ? "every-frame" : "interval");
  const [sampleInterval, setSampleInterval] = useState(Number(cachedSession.sampleInterval || 0.25));
  const [stripWatermarks, setStripWatermarks] = useState(cachedSession.stripWatermarks !== false);
  const [frames, setFrames] = useState(safeArray(cachedSession.frames));
  const [transcript, setTranscript] = useState(cachedSession.transcript || "");
  const [asrArtifacts, setAsrArtifacts] = useState(safeObject(cachedSession.asrArtifacts, null));
  const [asrSubtitleCount, setAsrSubtitleCount] = useState(Number(cachedSession.asrSubtitleCount || 0));
  const [visualText, setVisualText] = useState(cachedSession.visualText || "");
  const [tags, setTags] = useState(safeArray(cachedSession.tags));
  const [ocrArtifacts, setOcrArtifacts] = useState(safeObject(cachedSession.ocrArtifacts, null));
  const [ocrSubtitleCount, setOcrSubtitleCount] = useState(Number(cachedSession.ocrSubtitleCount || 0));
  const [variants, setVariants] = useState(safeArray(cachedSession.variants));
  const [selectedVariant, setSelectedVariant] = useState(Number(cachedSession.selectedVariant || 0));
  const [lengthMode, setLengthMode] = useState(cachedSession.lengthMode || "标准");
  const [outputLanguage, setOutputLanguage] = useState(cachedSession.outputLanguage || "简体中文");
  const [creativity, setCreativity] = useState(Number(cachedSession.creativity ?? 0.62));
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [asrProfile, setAsrProfile] = useState(null);
  const [resolveSteps, setResolveSteps] = useState(safeArray(cachedSession.resolveSteps));
  const [resolvePanelOpen, setResolvePanelOpen] = useState(false);
  const [ocrPanelOpen, setOcrPanelOpen] = useState(false);
  const [ocrJob, setOcrJob] = useState(safeObject(cachedSession.ocrJob, null));
  const [diffVariant, setDiffVariant] = useState(null);
  const [diffPanelOpen, setDiffPanelOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNoticeState] = useState("");
  const [activeTab, setActiveTab] = useState(safeActiveTab(cachedSession.activeTab));
  const [logs, setLogs] = useState(safeArray(cachedSession.logs).length ? safeArray(cachedSession.logs) : DEFAULT_LOGS);
  const [stepState, setStepState] = useState(safeStepState(cachedSession.stepState));

  const sourceText = useMemo(() => [transcript, visualText].filter(Boolean).join("\n\n"), [transcript, visualText]);
  const selectedRewrite = variants[selectedVariant];
  const activeAi = getActiveAiConfig(settings);
  const canUseModel = activeAi.ready;
  const fileSize = metadata?.size || media?.size || 0;
  const effectiveFps = frameInfo?.fps || media?.fps || 0;
  const effectiveFrameCount = frameInfo?.frameCount || media?.frameCount || 0;
  const expectedFrameCount = estimateCaptureCount({ mode: frameMode, duration: metadata?.duration, fps: effectiveFps, frameCount: effectiveFrameCount, interval: sampleInterval });
  const asrSrtUrl = asrArtifacts?.srt;
  const ocrSrtUrl = ocrArtifacts?.srt;
  const ocrProgress = Math.max(0, Math.min(100, Math.round(Number(ocrJob?.progress || 0))));
  const ocrStatusText = ocrJob?.status === "done" ? "已完成" : ocrJob?.status === "error" ? "失败" : ocrJob ? "运行中" : "未开始";
  const diffParts = useMemo(() => buildTextDiff(sourceText, diffVariant?.text || ""), [sourceText, diffVariant]);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (cachedSession.media?.id) {
      loadMediaInfo(cachedSession.media.id);
    }
    if (cachedSession.ocrJob?.id && ["queued", "running"].includes(cachedSession.ocrJob.status)) {
      setBusy("ocr");
      setOcrPanelOpen(true);
      pollOcrStatus(cachedSession.ocrJob.id);
    }
  }, []);

  useEffect(() => {
    writeSessionCache({
      version: 2,
      updatedAt: Date.now(),
      douyinUrl,
      media,
      metadata,
      frameInfo,
      frameMode,
      sampleInterval,
      stripWatermarks,
      frames,
      transcript,
      asrArtifacts,
      asrSubtitleCount,
      visualText,
      tags,
      ocrArtifacts,
      ocrSubtitleCount,
      variants,
      selectedVariant,
      lengthMode,
      outputLanguage,
      creativity,
      resolveSteps,
      ocrJob,
      activeTab,
      logs,
      stepState,
    });
  }, [
    douyinUrl,
    media,
    metadata,
    frameInfo,
    frameMode,
    sampleInterval,
    stripWatermarks,
    frames,
    transcript,
    asrArtifacts,
    asrSubtitleCount,
    visualText,
    tags,
    ocrArtifacts,
    ocrSubtitleCount,
    variants,
    selectedVariant,
    lengthMode,
    outputLanguage,
    creativity,
    resolveSteps,
    ocrJob,
    activeTab,
    logs,
    stepState,
  ]);

  useEffect(() => {
    return () => {
      clearNoticeTimer();
      clearResolveAutoCloseTimer();
      clearOcrPollTimer();
    };
  }, []);

  function addLog(message) {
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogs((items) => [`${time} ${message}`, ...items].slice(0, 12));
  }

  function normalizeTranscriptionModel(model) {
    const value = String(model || "").trim();
    return !value || value === "whisper-1" ? DEFAULT_SETTINGS.transcriptionModel : value;
  }

  function clearNoticeTimer() {
    if (!noticeTimerRef.current) return;
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
  }

  function setNotice(message) {
    clearNoticeTimer();
    setNoticeState(message);
  }

  function showNotice(message, options = {}) {
    const { autoHide = false, delay = 3200 } = options;
    setNotice(message);
    if (message && autoHide) {
      noticeTimerRef.current = window.setTimeout(() => {
        setNoticeState("");
        noticeTimerRef.current = null;
      }, delay);
    }
  }

  function dismissNotice() {
    clearNoticeTimer();
    setNotice("");
  }

  function clearResolveAutoCloseTimer() {
    if (!resolveAutoCloseTimerRef.current) return;
    window.clearTimeout(resolveAutoCloseTimerRef.current);
    resolveAutoCloseTimerRef.current = null;
  }

  function scheduleResolvePanelClose(delay = 1500) {
    clearResolveAutoCloseTimer();
    resolveAutoCloseTimerRef.current = window.setTimeout(() => {
      setResolvePanelOpen(false);
      resolveAutoCloseTimerRef.current = null;
    }, delay);
  }

  function clearOcrPollTimer() {
    if (!ocrPollTimerRef.current) return;
    window.clearTimeout(ocrPollTimerRef.current);
    ocrPollTimerRef.current = null;
  }

  function updateStep(key, state) {
    setStepState((current) => ({ ...current, [key]: state }));
  }

  function resetResults() {
    setTranscript("");
    setAsrArtifacts(null);
    setAsrSubtitleCount(0);
    setVisualText("");
    setTags([]);
    setOcrArtifacts(null);
    setOcrSubtitleCount(0);
    setOcrJob(null);
    setOcrPanelOpen(false);
    clearOcrPollTimer();
    setVariants([]);
    setSelectedVariant(0);
    setFrames([]);
    setStepState({ ...DEFAULT_STEP_STATE });
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

  function handleResetWorkspace() {
    clearSessionCache();
    clearNoticeTimer();
    clearResolveAutoCloseTimer();
    clearOcrPollTimer();
    setDouyinUrl("");
    setMedia(null);
    setMetadata(null);
    setFrameInfo(null);
    setFrameMode("interval");
    setSampleInterval(0.25);
    setStripWatermarks(true);
    setTranscript("");
    setAsrArtifacts(null);
    setAsrSubtitleCount(0);
    setVisualText("");
    setTags([]);
    setOcrArtifacts(null);
    setOcrSubtitleCount(0);
    setOcrJob(null);
    setOcrPanelOpen(false);
    setResolveSteps([]);
    setResolvePanelOpen(false);
    setDiffVariant(null);
    setDiffPanelOpen(false);
    setVariants([]);
    setSelectedVariant(0);
    setFrames([]);
    setBusy("");
    setActiveTab("timeline");
    setLogs(DEFAULT_LOGS);
    setStepState({ ...DEFAULT_STEP_STATE });
    setNotice("已重置当前任务。刷新页面也会保持空白状态，直到重新解析或上传视频。");
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
      const next = { ...DEFAULT_SETTINGS, ...data, transcriptionModel: normalizeTranscriptionModel(data.transcriptionModel) };
      setSettings(next);
      setSettingsDraft({ ...next, apiKey: "", deepseekApiKey: "" });
    } catch (error) {
      addLog(`读取 AI 设置失败：${error.message}`);
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
    clearResolveAutoCloseTimer();
    setResolvePanelOpen(true);
    showNotice("正在真实解析抖音链接，下面会显示每一步尝试。");
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
      showNotice(`抖音视频解析成功，已保存到本地。策略：${data.strategy || "真实解析"}`, { autoHide: true });
      scheduleResolvePanelClose();
    } catch (error) {
      updateStep("source", "error");
      updateStep("download", "error");
      clearResolveAutoCloseTimer();
      setResolveSteps((items) => [...items.map((item) => ({ ...item, state: "done" })), { text: error.message, state: "error" }].slice(-10));
      showNotice(`${error.message} 可上传视频文件继续分析。`);
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
    link.download = getVideoDownloadName(media);
    document.body.appendChild(link);
    link.click();
    link.remove();
    addLog(`已触发视频下载：${link.download}`);
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
    setBusy("asr");
    updateStep("asr", "active");
    setNotice("");
    try {
      const data = await api("/api/transcribe-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId: media.id,
          model: normalizeTranscriptionModel(settings.transcriptionModel),
          simplifiedOnly: Boolean(settings.asrSimplifiedOnly),
        }),
      });
      setTranscript(data.text || "");
      setAsrArtifacts(data.artifacts || null);
      setAsrSubtitleCount(Number(data.segmentCount || 0));
      updateStep("asr", data.text ? "done" : "idle");
      updateStep("merge", data.text || visualText ? "done" : "idle");
      addLog(data.text ? `语音识别完成：${data.engine || "本地 ASR"}。` : "语音识别完成，但未识别到文字，可继续运行 OCR。");
      if (!data.text) showNotice("没有识别到语音文字。如果视频只有背景音乐或音效，请继续用 OCR 识别画面文字。");
    } catch (error) {
      updateStep("asr", "error");
      setNotice(error.message);
      addLog(`语音识别失败：${error.message}`);
    } finally {
      setBusy("");
    }
  }

  function applyOcrResult(data) {
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
  }

  async function pollOcrStatus(jobId) {
    clearOcrPollTimer();
    try {
      const status = await api(`/api/extract-subtitles/status/${jobId}`);
      setOcrJob(status);
      if (status.status === "done") {
        if (status.result) applyOcrResult(status.result);
        setBusy((current) => (current === "ocr" ? "" : current));
        return;
      }
      if (status.status === "error") {
        updateStep("ocr", "error");
        setNotice(status.error || "OCR 识别失败。");
        addLog(`OCR 识别失败：${status.error || "未知错误"}`);
        setBusy((current) => (current === "ocr" ? "" : current));
        return;
      }
      ocrPollTimerRef.current = window.setTimeout(() => pollOcrStatus(jobId), 850);
    } catch (error) {
      updateStep("ocr", "error");
      setNotice(error.message);
      addLog(`OCR 进度读取失败：${error.message}`);
      setBusy((current) => (current === "ocr" ? "" : current));
    }
  }

  async function handleOcr() {
    if (!media) {
      setNotice("请先上传或解析视频。");
      return;
    }
    clearOcrPollTimer();
    setBusy("ocr");
    updateStep("ocr", "active");
    setNotice("");
    setOcrPanelOpen(true);
    try {
      const mode = frameMode === "every-frame" ? "every-frame" : "interval";
      const interval = Math.max(0.05, Number(sampleInterval) || 0.25);
      const initialJob = {
        status: "queued",
        phase: mode === "every-frame" ? "准备全帧 OCR" : `准备按 ${interval.toFixed(2)} 秒/帧 OCR`,
        progress: 0,
        processed: 0,
        plannedTotal: expectedFrameCount || 0,
        detections: 0,
        finalEvents: 0,
        logs: ["OCR 任务已提交，正在启动本地识别引擎。"],
      };
      setOcrJob(initialJob);
      setNotice(mode === "every-frame" ? "OCR 已开始：后端正在快速逐帧读取，不需要等待视频播放完成。" : `OCR 已开始：后端每 ${interval.toFixed(2)} 秒读取 1 帧。`);
      const job = await api("/api/extract-subtitles/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId: media.id,
          mode,
          sampleInterval: interval,
          includeWatermark: !stripWatermarks,
        }),
      });
      setOcrJob(job);
      addLog("OCR 任务已启动，可关闭进度面板，识别会继续运行。");
      pollOcrStatus(job.id);
    } catch (error) {
      updateStep("ocr", "error");
      setNotice(error.message);
      addLog(`OCR 识别失败：${error.message}`);
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
      setNotice("请先配置 AI 改写模型。");
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
          provider: activeAi.provider,
          model: activeAi.model,
          lengthMode,
          outputLanguage,
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

  function openDiffPanel(variant) {
    if (!sourceText.trim() || !variant?.text?.trim()) {
      setNotice("没有可对比的原文或改写文案。");
      return;
    }
    setDiffVariant(variant);
    setDiffPanelOpen(true);
  }

  async function handleFetchModels(provider = settingsDraft.activeAiProvider || "cpa") {
    const isDeepSeek = provider === "deepseek";
    setBusy(isDeepSeek ? "models-deepseek" : "models-cpa");
    setNotice("");
    setSettingsNotice("");
    try {
      const data = await api("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          baseUrl: isDeepSeek ? settingsDraft.deepseekBaseUrl : settingsDraft.baseUrl,
          apiKey: isDeepSeek ? settingsDraft.deepseekApiKey : settingsDraft.apiKey,
        }),
      });
      const first = data.models[0] || "";
      setSettingsDraft((draft) => isDeepSeek
        ? { ...draft, deepseekModels: data.models, deepseekModel: draft.deepseekModel || first }
        : { ...draft, models: data.models, model: draft.model || first });
      setSettingsNotice(`已获取 ${AI_PROVIDERS[provider]?.label || "当前接入"} ${data.models.length} 个模型。`);
    } catch (error) {
      setSettingsNotice(`连接失败：${error.message || "请检查 Base URL、API Key 和网络连接。"}`);
    } finally {
      setBusy("");
    }
  }

  function handleEnableProvider(provider) {
    setSettingsDraft((draft) => ({ ...draft, activeAiProvider: provider }));
    setSettingsNotice(`已选择启用 ${AI_PROVIDERS[provider]?.label || provider}，点击保存后生效。`);
  }

  function openApiKeyPage(provider) {
    const url = AI_PROVIDERS[provider]?.keyUrl;
    if (!url) {
      setSettingsNotice("CPA 是自定义反代服务，请到你的 CPA 服务商或管理后台获取 API Key。");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleDetectAsrProfile() {
    setBusy("asr-profile");
    setSettingsNotice("");
    try {
      const data = await api("/api/asr-profile");
      setAsrProfile(data);
      setSettingsNotice(`本机配置检测完成，推荐本地语音模型：${data.recommended?.label || data.recommended?.model || "未识别"}`);
    } catch (error) {
      setSettingsNotice(`检测失败：${error.message}`);
    } finally {
      setBusy("");
    }
  }

  function useRecommendedAsrModel() {
    const model = asrProfile?.recommended?.model;
    if (!model) return;
    setSettingsDraft((draft) => ({ ...draft, transcriptionModel: model }));
    setSettingsNotice(`已选择推荐模型：${asrProfile.recommended?.label || model}。点击保存后生效。`);
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
      setSettingsDraft({ ...DEFAULT_SETTINGS, ...data, apiKey: "", deepseekApiKey: "" });
      setSettingsOpen(false);
      setNotice("AI 设置已保存。");
      addLog("AI 设置已保存。");
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
      setSettingsDraft((draft) => ({ ...draft, ...data, apiKey: "", deepseekApiKey: "", douyinCookie: "" }));
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
            <p>本地视频解析、真实识别、AI 改写</p>
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
          <button className="reset-command" type="button" onClick={handleResetWorkspace}>
            <IconRefresh size={17} />
            重置
          </button>
          <button className="settings-command" type="button" onClick={() => setSettingsOpen(true)}>
            <IconSettings size={18} />
            AI 设置
          </button>
        </section>
      </header>

      {notice && (
        <div className="notice-bar">
          <IconAlertTriangle size={17} />
          <span>{notice}</span>
          <button type="button" onClick={dismissNotice}>关闭</button>
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
          </div>
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
          <div className="operation-actions">
            <button type="button" onClick={handleCaptureFrames} disabled={busy === "frames"}>
              <IconPhotoScan size={17} />
              {busy === "frames" ? "抽帧中" : "抽帧预览"}
            </button>
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
          </section>
          <div className="progress-shortcuts">
            {!!resolveSteps.length && (
              <button className="resolve-toggle" type="button" onClick={() => setResolvePanelOpen(true)}>
                <IconClock size={16} />
                {busy === "douyin" ? "查看解析过程" : "解析记录"}
              </button>
            )}
            {!!ocrJob && (
              <button className="resolve-toggle" type="button" onClick={() => setOcrPanelOpen(true)}>
                <IconScan size={16} />
                查看 OCR 进度
              </button>
            )}
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
          <section className="timeline-panel">
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
                )) : <div className="soft-empty">还没有关键帧。点击“抽帧预览”后显示。</div>}
              </div>
            )}
            {activeTab === "logs" && (
              <div className="log-list">
                {logs.map((item) => <span key={item}>{item}</span>)}
              </div>
            )}
          </section>
        </section>

        <aside className="copy-zone panel">
          <div className="panel-title compact">
            <div>
              <h2>文案智能看板</h2>
              <p>{canUseModel ? `模型：${activeAi.label} / ${activeAi.model}` : "未配置 AI 模型"}</p>
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
            {asrSrtUrl && (
              <div className="artifact-row">
                <a href={asrSrtUrl} target="_blank" rel="noreferrer">下载语音 SRT 字幕</a>
                <span>{asrSubtitleCount ? `已生成 ${asrSubtitleCount} 条语音时间线` : "已生成语音时间线字幕文件"}</span>
              </div>
            )}
            {ocrSrtUrl && (
              <div className="artifact-row">
                <a href={ocrSrtUrl} target="_blank" rel="noreferrer">下载画面 SRT 字幕</a>
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
                <div className="variant-action-row">
                  <button type="button" onClick={() => copyText(selectedRewrite.text, "改写文案")}>
                    <IconCopy size={15} />
                    复制改写文案
                  </button>
                  <button type="button" onClick={() => openDiffPanel(selectedRewrite)}>
                    <IconFileText size={15} />
                    对比原文
                  </button>
                </div>
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
            <label className="select-line">
              <span>输出语言</span>
              <select value={outputLanguage} onChange={(event) => setOutputLanguage(event.target.value)}>
                {OUTPUT_LANGUAGE_OPTIONS.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="range-line">
              <span>创意强度 {creativity.toFixed(2)}</span>
              <input min="0" max="1" step="0.01" type="range" value={creativity} onChange={(event) => setCreativity(Number(event.target.value))} />
            </label>
          </section>
        </aside>

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

      {ocrPanelOpen && (
        <section className="modal-layer task-layer" role="dialog" aria-modal="true" aria-label="OCR 识别进度">
          <div className="task-modal panel">
            <div className="modal-head">
              <div>
                <h2>OCR 识别进度</h2>
                <p>{ocrJob?.phase || "等待开始识别"}</p>
              </div>
              <button type="button" onClick={() => setOcrPanelOpen(false)} aria-label="隐藏 OCR 进度">
                <IconX size={20} />
              </button>
            </div>
            <div className={`task-progress ${ocrJob?.status || "idle"}`}>
              <div className="task-progress-head">
                <strong>{ocrStatusText}</strong>
                <span>{ocrProgress}%</span>
              </div>
              <div className="task-meter" aria-label={`OCR 进度 ${ocrProgress}%`}>
                <i style={{ width: `${ocrProgress}%` }} />
              </div>
            </div>
            <div className="task-stats">
              <div>
                <span>已处理</span>
                <strong>{ocrJob?.processed || 0}<em> / {ocrJob?.plannedTotal || expectedFrameCount || "-"}</em></strong>
              </div>
              <div>
                <span>视频帧位</span>
                <strong>{ocrJob?.currentFrame || 0}<em> / {ocrJob?.frameCount || effectiveFrameCount || "-"}</em></strong>
              </div>
              <div>
                <span>文字候选</span>
                <strong>{ocrJob?.detections || 0}</strong>
              </div>
              <div>
                <span>SRT 字幕</span>
                <strong>{ocrJob?.finalEvents || ocrSubtitleCount || 0}</strong>
              </div>
            </div>
            {ocrJob?.error && (
              <div className="modal-notice danger">
                <IconAlertTriangle size={16} />
                <span>{ocrJob.error}</span>
              </div>
            )}
            <div className="task-body">
              <section className="task-copy-preview">
                <div className="copy-head">
                  <h3>识别内容预览 <span>完成后自动同步到右侧结果区</span></h3>
                  <button type="button" onClick={() => copyText(ocrJob?.result?.visualText || visualText, "OCR 文案")}>
                    <IconCopy size={15} />
                    复制
                  </button>
                </div>
                <div className="task-copy-scroll">
                  {ocrJob?.result?.visualText || visualText || (ocrJob?.status === "done" ? "本次 OCR 未识别到可用正文，已保留实时处理记录和 SRT 文件。" : "识别中，暂无可显示文本。")}
                </div>
                {ocrJob?.result?.artifacts?.srt && (
                  <div className="artifact-row">
                    <a href={ocrJob.result.artifacts.srt} target="_blank" rel="noreferrer">下载画面 SRT 字幕</a>
                    <span>{ocrJob.result.subtitleCount ? `已生成 ${ocrJob.result.subtitleCount} 条时间线字幕` : "已生成时间线字幕文件"}</span>
                  </div>
                )}
              </section>
              <section className="task-log-panel">
                <h3>实时处理记录</h3>
                <div className="task-log-list">
                  {(ocrJob?.logs?.length ? ocrJob.logs : ["暂无 OCR 运行记录。"]).slice().reverse().map((item, index) => (
                    <span key={`${item}-${index}`}>{item}</span>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </section>
      )}

      {diffPanelOpen && diffVariant && (
        <section className="modal-layer light-layer" role="dialog" aria-modal="true" aria-label="文案差异对比">
          <div className="diff-modal panel">
            <div className="modal-head">
              <div>
                <h2>文案差异对比</h2>
                <p>{diffVariant.name}：绿色为新增/变化，红色为原文被删除或替换。</p>
              </div>
              <button type="button" onClick={() => setDiffPanelOpen(false)} aria-label="关闭文案差异对比">
                <IconX size={20} />
              </button>
            </div>
            <div className="diff-legend">
              <span className="same">保留</span>
              <span className="insert">新增/变化</span>
              <span className="delete">删除/被替换</span>
            </div>
            <div className="diff-grid">
              <section>
                <h3>原文</h3>
                <div className="diff-text">
                  {diffParts.original.map((part, index) => (
                    <mark className={part.type} key={`${part.text}-${index}`}>{part.text}</mark>
                  ))}
                </div>
              </section>
              <section>
                <h3>{diffVariant.name}</h3>
                <div className="diff-text">
                  {diffParts.revised.map((part, index) => (
                    <mark className={part.type} key={`${part.text}-${index}`}>{part.text}</mark>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </section>
      )}

      {settingsOpen && (
        <section className="modal-layer" role="dialog" aria-modal="true" aria-label="AI 设置">
          <div className="settings-modal panel">
            <div className="modal-head">
              <div>
                <h2>AI 改写与本地识别设置</h2>
                <p>AI 改写可启用 CPA 反代或 DeepSeek 官方；本地语音识别无需 API Key。</p>
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
            <section className={`ai-provider-card ${settingsDraft.activeAiProvider === "cpa" ? "active" : ""}`}>
              <div className="ai-provider-head">
                <div>
                  <strong>CPA 反代接入</strong>
                  <span>使用你自己的 CPA Base URL 和 API Key</span>
                </div>
                <button type="button" onClick={() => handleEnableProvider("cpa")}>
                  <IconCheck size={15} />
                  {settingsDraft.activeAiProvider === "cpa" ? "已启用" : "启用"}
                </button>
              </div>
              <label>
                <span>CPA Base URL</span>
                <input value={settingsDraft.baseUrl} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, baseUrl: event.target.value }))} placeholder="例如：https://api.openai.com/v1" />
              </label>
              <label>
                <span>CPA API Key {settings.apiKeySaved ? "（已保存，可留空不改）" : ""}</span>
                <input type="password" value={settingsDraft.apiKey || ""} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, apiKey: event.target.value }))} placeholder="只保存在本地后端配置文件" />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => handleFetchModels("cpa")} disabled={busy === "models-cpa"}>
                  <IconRefresh size={16} />
                  {busy === "models-cpa" ? "获取中" : "获取模型"}
                </button>
                <button type="button" onClick={() => openApiKeyPage("cpa")}>
                  <IconKey size={16} />
                  API Key 来源
                </button>
              </div>
              <label>
                <span>CPA 改写模型</span>
                <select value={settingsDraft.model} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, model: event.target.value }))}>
                  <option value="">先获取模型列表</option>
                  {settingsDraft.models.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </section>

            <section className={`ai-provider-card ${settingsDraft.activeAiProvider === "deepseek" ? "active" : ""}`}>
              <div className="ai-provider-head">
                <div>
                  <strong>DeepSeek 官方接入</strong>
                  <span>适合直接使用 DeepSeek 官方 API Key</span>
                </div>
                <button type="button" onClick={() => handleEnableProvider("deepseek")}>
                  <IconCheck size={15} />
                  {settingsDraft.activeAiProvider === "deepseek" ? "已启用" : "启用"}
                </button>
              </div>
              <label>
                <span>DeepSeek Base URL</span>
                <input value={settingsDraft.deepseekBaseUrl} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, deepseekBaseUrl: event.target.value }))} placeholder="https://api.deepseek.com" />
              </label>
              <label>
                <span>DeepSeek API Key {settings.deepseekApiKeySaved ? "（已保存，可留空不改）" : ""}</span>
                <input type="password" value={settingsDraft.deepseekApiKey || ""} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, deepseekApiKey: event.target.value }))} placeholder="只保存在本地后端配置文件" />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => handleFetchModels("deepseek")} disabled={busy === "models-deepseek"}>
                  <IconRefresh size={16} />
                  {busy === "models-deepseek" ? "获取中" : "获取模型"}
                </button>
                <button type="button" onClick={() => openApiKeyPage("deepseek")}>
                  <IconKey size={16} />
                  申请 API Key
                </button>
              </div>
              <label>
                <span>DeepSeek 改写模型</span>
                <select value={settingsDraft.deepseekModel} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, deepseekModel: event.target.value }))}>
                  <option value="">先获取模型列表</option>
                  {settingsDraft.deepseekModels.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </section>

            <div className="modal-actions single-action">
              <button className="save" type="button" onClick={handleSaveSettings} disabled={busy === "save-settings"}>
                <IconShieldCheck size={16} />
                保存全部设置
              </button>
            </div>
            <label>
              <span>本地语音识别模型</span>
              <select value={settingsDraft.transcriptionModel} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, transcriptionModel: event.target.value }))}>
                {ASR_MODEL_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label} - {item.hint}</option>
                ))}
              </select>
            </label>
            <label className="check-line settings-check-line">
              <input type="checkbox" checked={Boolean(settingsDraft.asrSimplifiedOnly)} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, asrSimplifiedOnly: event.target.checked }))} />
              <span>语音识别结果强制输出简体中文</span>
            </label>
            <div className="asr-profile-card">
              <div className="asr-profile-head">
                <div>
                  <strong>本机模型推荐</strong>
                  <span>按 CPU、内存、显卡和本地依赖给出建议</span>
                </div>
                <button type="button" onClick={handleDetectAsrProfile} disabled={busy === "asr-profile"}>
                  <IconRefresh size={15} />
                  {busy === "asr-profile" ? "检测中" : "检测配置"}
                </button>
              </div>
              {asrProfile ? (
                <>
                  <div className="asr-system-grid">
                    <span>CPU：{asrProfile.system?.cpuCores || "-"} 核</span>
                    <span>内存：{asrProfile.system?.totalMemoryGb || "-"} GB</span>
                    <span>显卡：{asrProfile.gpus?.[0]?.name || "未检测到独立显卡"}</span>
                    <span>依赖：{asrProfile.recommended?.dependencyOk ? "已就绪" : "需安装 faster-whisper"}</span>
                  </div>
                  <div className="asr-recommend-line">
                    <p><b>推荐：</b>{asrProfile.recommended?.label || asrProfile.recommended?.model}</p>
                    <span>{asrProfile.recommended?.reason}</span>
                    <button type="button" onClick={useRecommendedAsrModel}>使用推荐模型</button>
                  </div>
                  <div className="asr-option-list">
                    {(asrProfile.recommended?.options || []).map((item) => (
                      <span className={item.selected ? "selected" : ""} key={item.model}>
                        {item.shortName} · {item.fit}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="asr-profile-empty">不同用户电脑配置不同，点击“检测配置”后会自动推荐 tiny、base、small、medium 或 large-v3。</p>
              )}
            </div>
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

function buildTextDiff(originalText, revisedText) {
  const maxChars = 2200;
  const original = Array.from(String(originalText || "").slice(0, maxChars));
  const revised = Array.from(String(revisedText || "").slice(0, maxChars));
  const rows = original.length + 1;
  const cols = revised.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));

  for (let i = original.length - 1; i >= 0; i -= 1) {
    for (let j = revised.length - 1; j >= 0; j -= 1) {
      dp[i][j] = original[i] === revised[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const originalParts = [];
  const revisedParts = [];
  let i = 0;
  let j = 0;
  while (i < original.length && j < revised.length) {
    if (original[i] === revised[j]) {
      originalParts.push({ type: "same", text: original[i] });
      revisedParts.push({ type: "same", text: revised[j] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      originalParts.push({ type: "delete", text: original[i] });
      i += 1;
    } else {
      revisedParts.push({ type: "insert", text: revised[j] });
      j += 1;
    }
  }
  while (i < original.length) {
    originalParts.push({ type: "delete", text: original[i] });
    i += 1;
  }
  while (j < revised.length) {
    revisedParts.push({ type: "insert", text: revised[j] });
    j += 1;
  }
  if (String(originalText || "").length > maxChars) originalParts.push({ type: "delete", text: "..." });
  if (String(revisedText || "").length > maxChars) revisedParts.push({ type: "insert", text: "..." });
  return {
    original: mergeDiffParts(originalParts),
    revised: mergeDiffParts(revisedParts),
  };
}

function mergeDiffParts(parts) {
  const merged = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (previous?.type === part.type) previous.text += part.text;
    else merged.push({ ...part });
  }
  return merged.filter((part) => part.text);
}

function getActiveAiConfig(settings) {
  const provider = settings?.activeAiProvider === "deepseek" ? "deepseek" : "cpa";
  if (provider === "deepseek") {
    return {
      provider,
      label: AI_PROVIDERS.deepseek.label,
      baseUrl: settings?.deepseekBaseUrl || DEFAULT_SETTINGS.deepseekBaseUrl,
      model: settings?.deepseekModel || "",
      ready: Boolean((settings?.deepseekBaseUrl || DEFAULT_SETTINGS.deepseekBaseUrl) && settings?.deepseekApiKeySaved && settings?.deepseekModel),
    };
  }
  return {
    provider,
    label: AI_PROVIDERS.cpa.label,
    baseUrl: settings?.baseUrl || "",
    model: settings?.model || "",
    ready: Boolean(settings?.baseUrl && settings?.apiKeySaved && settings?.model),
  };
}

function getVideoDownloadName(media) {
  const originalName = String(media?.originalName || "").trim();
  const storedName = String(media?.fileName || "").trim();
  const originalIsUrl = /^https?:\/\//i.test(originalName);
  const preferred = !originalIsUrl && VIDEO_EXTENSION_PATTERN.test(originalName)
    ? originalName
    : VIDEO_EXTENSION_PATTERN.test(storedName)
      ? storedName
      : !originalIsUrl && originalName
        ? originalName
        : media?.id
          ? `douyin-${media.id}`
          : "video";
  let safeName = preferred
    .split(/[?#]/)[0]
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  if (!safeName) safeName = "video";
  if (!VIDEO_EXTENSION_PATTERN.test(safeName)) {
    const ext = String(media?.mimeType || "").includes("webm") ? ".webm" : ".mp4";
    safeName = `${safeName}${ext}`;
  }
  return safeName;
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
