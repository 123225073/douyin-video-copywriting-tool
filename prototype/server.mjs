import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const dataDir = path.join(rootDir, "local-data");
const uploadDir = path.join(dataDir, "uploads");
const ocrRunDir = path.join(dataDir, "ocr-runs");
const douyinBrowserProfileDir = path.join(dataDir, "douyin-browser-profile");
const settingsPath = path.join(dataDir, "settings.json");
const manifestPath = path.join(dataDir, "media-manifest.json");
const distDir = path.join(rootDir, "dist");
const scriptsDir = path.join(rootDir, "scripts");
const frameExtractorScript = path.join(scriptsDir, "extract_frames.py");
const videoOcrScript = path.join(scriptsDir, "video_ocr.py");
const chromeUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const douyinHeaders = {
  "User-Agent": chromeUserAgent,
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: "https://www.douyin.com/",
};
await fsp.mkdir(uploadDir, { recursive: true });
await fsp.mkdir(ocrRunDir, { recursive: true });
await fsp.mkdir(douyinBrowserProfileDir, { recursive: true });

const app = express();
const port = Number(process.env.PORT || 5176);
let douyinCookieContext = null;

app.use(express.json({ limit: "40mb" }));
app.use("/media", express.static(uploadDir));
app.use("/ocr-output", express.static(ocrRunDir));

const storage = multer.diskStorage({
  destination: uploadDir,
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".mp4";
    cb(null, `${Date.now()}-${randomId()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 800 },
  fileFilter(_req, file, cb) {
    if (file.mimetype?.startsWith("video/")) cb(null, true);
    else cb(new Error("只支持上传视频文件。"));
  },
});

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function publicMediaUrl(fileName) {
  return `/media/${encodeURIComponent(fileName)}`;
}

function publicOcrUrl(runName, fileName) {
  return `/ocr-output/${encodeURIComponent(runName)}/${encodeURIComponent(fileName)}`;
}

function cleanUploadName(name) {
  const raw = String(name || "video.mp4");
  if (!/[ÃÂæéèå]/.test(raw)) return raw;
  try {
    return Buffer.from(raw, "latin1").toString("utf8");
  } catch {
    return raw;
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function getSettings() {
  return readJson(settingsPath, {
    baseUrl: "",
    apiKey: "",
    douyinCookie: "",
    douyinCookieJar: [],
    parserApiTemplate: "",
    parserApiKey: "",
    model: "",
    transcriptionModel: "whisper-1",
    models: [],
  });
}

function redactSettings(settings) {
  const cookieInfo = describeCookie(settings.douyinCookie || "");
  return {
    baseUrl: settings.baseUrl || "",
    model: settings.model || "",
    transcriptionModel: settings.transcriptionModel || "whisper-1",
    models: Array.isArray(settings.models) ? settings.models : [],
    apiKeySaved: Boolean(settings.apiKey),
    douyinCookieSaved: Boolean(settings.douyinCookie),
    douyinCookieInfo: cookieInfo,
    parserApiTemplate: settings.parserApiTemplate || "",
    parserApiKeySaved: Boolean(settings.parserApiKey),
  };
}

function maskCookieValue(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 10) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function describeCookie(cookieHeader) {
  const parts = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      return index > 0 ? { name: part.slice(0, index), value: part.slice(index + 1) } : null;
    })
    .filter(Boolean);
  const names = parts.map((item) => item.name);
  return {
    count: parts.length,
    hasLoginCookie: names.some((name) => ["sessionid", "sid_guard", "sid_tt", "uid_tt"].includes(name)),
    hasVisitorCookie: names.some((name) => ["ttwid", "msToken", "odin_tt", "s_v_web_id"].includes(name)),
    names: names.slice(0, 24),
    preview: parts.slice(0, 12).map((item) => `${item.name}=${maskCookieValue(item.value)}`),
  };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function requireApiConfig(settings) {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!baseUrl) throw new Error("请先填写 CPA Base URL。");
  if (!settings.apiKey) throw new Error("请先填写 CPA API Key。");
  return baseUrl;
}

function apiPath(baseUrl, suffix) {
  return `${normalizeBaseUrl(baseUrl)}${suffix}`;
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findBrowserExecutable() {
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft\\Edge\\Application\\msedge.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate && await pathExists(candidate)) return candidate;
  }
  throw new Error("没有找到 Chrome 或 Edge 浏览器，无法自动获取抖音 Cookie。");
}

async function openDouyinCookieBrowser() {
  const { chromium } = await import("playwright-core");
  if (!douyinCookieContext) {
    const executablePath = await findBrowserExecutable();
    douyinCookieContext = await chromium.launchPersistentContext(douyinBrowserProfileDir, {
      executablePath,
      headless: false,
      viewport: null,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    douyinCookieContext.on("close", () => {
      douyinCookieContext = null;
    });
  }
  const pages = douyinCookieContext.pages();
  const page = pages[0] || await douyinCookieContext.newPage();
  await page.bringToFront().catch(() => {});
  await page.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  return { ok: true };
}

async function ensureDouyinBrowserContext() {
  await openDouyinCookieBrowser();
  return douyinCookieContext;
}

async function getCurrentDouyinBrowserCandidates() {
  if (!douyinCookieContext) return [];
  const candidates = [];
  for (const page of douyinCookieContext.pages()) {
    const url = page.url();
    if (extractAwemeId(url)) candidates.push(url);
    try {
      const hrefs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("a[href]"))
          .map((item) => item.href)
          .filter((href) => /douyin\.com\/(video|share\/video)\//i.test(href) || /[?&](modal_id|aweme_id)=\d{15,25}/i.test(href))
          .slice(0, 8);
      });
      candidates.push(...hrefs);
    } catch {
      // Ignore pages that are still navigating.
    }
  }
  return [...new Set(candidates)];
}

function buildCookieHeader(cookies) {
  const domains = ["douyin.com", "iesdouyin.com", "v.douyin.com", "amemv.com", "snssdk.com"];
  const filtered = cookies.filter((cookie) => domains.some((domain) => String(cookie.domain || "").includes(domain)));
  const priority = ["sessionid", "sid_guard", "sid_tt", "uid_tt", "passport_csrf_token", "ttwid", "msToken", "odin_tt"];
  filtered.sort((left, right) => {
    const leftIndex = priority.indexOf(left.name);
    const rightIndex = priority.indexOf(right.name);
    return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  });
  const unique = new Map();
  for (const cookie of filtered) {
    if (!cookie.name || !cookie.value) continue;
    unique.set(cookie.name, `${cookie.name}=${cookie.value}`);
  }
  return {
    cookieHeader: [...unique.values()].join("; "),
    cookieCount: unique.size,
    names: [...unique.keys()],
    cookies: filtered,
  };
}

async function writeYtDlpCookieFile(cookies, id) {
  const items = Array.isArray(cookies) ? cookies : [];
  if (!items.length) return "";
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Generated by local Douyin copy tool",
  ];
  for (const cookie of items) {
    if (!cookie?.name || !cookie?.value || !cookie?.domain) continue;
    const domain = String(cookie.domain);
    const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
    const pathValue = cookie.path || "/";
    const secure = cookie.secure ? "TRUE" : "FALSE";
    const expiry = Number.isFinite(cookie.expires) && cookie.expires > 0 ? Math.floor(cookie.expires) : 2147483647;
    lines.push([domain, includeSubdomains, pathValue, secure, expiry, cookie.name, cookie.value].join("\t"));
  }
  if (lines.length <= 2) return "";
  const filePath = path.join(dataDir, `douyin-cookies-${id}.txt`);
  await fsp.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

async function readAndSaveDouyinCookie() {
  if (!douyinCookieContext) {
    await openDouyinCookieBrowser();
    throw new Error("已打开抖音登录窗口。请先在窗口里登录抖音，然后再点击“自动读取 Cookie”。");
  }
  const cookies = await douyinCookieContext.cookies([
    "https://www.douyin.com/",
    "https://v.douyin.com/",
    "https://www.iesdouyin.com/",
    "https://www.amemv.com/",
  ]);
  const { cookieHeader, cookieCount, names, cookies: filteredCookies } = buildCookieHeader(cookies);
  const hasVisitorCookie = names.some((name) => ["ttwid", "msToken", "odin_tt"].includes(name));
  const hasLoginCookie = names.some((name) => ["sessionid", "sid_guard", "sid_tt", "uid_tt"].includes(name));
  if (!cookieHeader || !hasVisitorCookie) {
    throw new Error("还没有读取到可用的抖音 Cookie。请确认专用窗口已经打开抖音页面，必要时登录账号后再读取。");
  }
  const current = await getSettings();
  const next = { ...current, douyinCookie: cookieHeader, douyinCookieJar: filteredCookies };
  await writeJson(settingsPath, next);
  return {
    ...redactSettings(next),
    cookieCount,
    hasLoginCookie,
    hasVisitorCookie,
    douyinCookieInfo: describeCookie(cookieHeader),
  };
}

async function fetchJsonOrThrow(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("无法连接到 CPA Base URL，请检查地址、网络或代理。");
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || text || `请求失败：${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function readManifest() {
  const manifest = await readJson(manifestPath, []);
  return Array.isArray(manifest) ? manifest : [];
}

async function saveMediaRecord(record) {
  const manifest = await readManifest();
  const next = [record, ...manifest.filter((item) => item.id !== record.id)].slice(0, 100);
  await writeJson(manifestPath, next);
  return record;
}

async function findMediaRecord(id) {
  const manifest = await readManifest();
  return manifest.find((item) => item.id === id);
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 180000, windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function parseLastJsonObject(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning previous lines.
    }
  }
  return {};
}

function extractFirstHttpUrl(input) {
  const text = String(input || "").trim();
  const match = text.match(/https?:\/\/[^\s"'<>，。；、]+/i);
  if (!match) return "";
  return match[0].replace(/[)\]}.,;!?。），、]+$/u, "");
}

function parseSafeUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function extractAwemeId(url) {
  const parsed = parseSafeUrl(url);
  if (!parsed) return "";
  const queryKeys = ["modal_id", "aweme_id", "item_id", "item_ids", "video_id"];
  for (const key of queryKeys) {
    const value = parsed.searchParams.get(key);
    if (/^\d{15,25}$/.test(value || "")) return value;
  }
  const pathname = decodeURIComponent(parsed.pathname);
  const patterns = [
    /\/video\/(\d{15,25})/i,
    /\/note\/(\d{15,25})/i,
    /\/share\/video\/(\d{15,25})/i,
    /\/aweme\/(\d{15,25})/i,
  ];
  for (const pattern of patterns) {
    const match = pathname.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function rejectKnownNonVideoUrl(url) {
  const parsed = parseSafeUrl(url);
  if (!parsed) return;
  const host = parsed.hostname.toLowerCase();
  if (!host.includes("douyin.com")) return;
  if (extractAwemeId(url)) return;
  const pathName = decodeURIComponent(parsed.pathname).toLowerCase();
  const nonVideoMarkers = ["/search", "/jingxuan/search", "/user/", "/discover", "/channel", "/live"];
  if (nonVideoMarkers.some((marker) => pathName.includes(marker))) {
    throw new Error("这个链接是抖音搜索页、主页、直播页或合集页，不是单条视频链接。请打开具体视频，点击分享，复制视频链接后再解析。");
  }
}

function buildDouyinCandidates(rawInput, browserCandidates = []) {
  const extracted = extractFirstHttpUrl(rawInput);
  if (!extracted) {
    if (browserCandidates.length) return browserCandidates;
    throw new Error("没有识别到标准链接。请复制抖音分享里的 https://v.douyin.com 短链接；或在抖音登录窗口打开具体视频后，再点击解析。");
  }
  const parsed = parseSafeUrl(extracted);
  if (!parsed) throw new Error("请输入有效的抖音视频链接。");
  if (!/douyin\.com|iesdouyin\.com|amemv\.com|snssdk\.com/i.test(parsed.hostname)) {
    throw new Error("当前只支持抖音视频链接。");
  }
  rejectKnownNonVideoUrl(extracted);
  const candidates = [extracted];
  const awemeId = extractAwemeId(extracted);
  if (awemeId) {
    candidates.push(`https://www.douyin.com/video/${awemeId}`);
  }
  return [...new Set(candidates)];
}

async function expandUrl(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: douyinHeaders,
      signal: AbortSignal.timeout(18000),
    });
    return response.url || url;
  } catch {
    return url;
  }
}

async function runYtDlpDownload(url, id, extraArgs = [], cookieSource = {}) {
  const outputTemplate = path.join(uploadDir, `douyin-${id}.%(ext)s`);
  const cookieFile = cookieSource.cookieJar?.length ? await writeYtDlpCookieFile(cookieSource.cookieJar, id) : "";
  const cookieArgs = cookieFile
    ? ["--cookies", cookieFile]
    : cookieSource.cookieHeader
      ? ["--add-header", `Cookie:${cookieSource.cookieHeader}`]
      : [];
  const args = [
    "-m",
    "yt_dlp",
    "--no-playlist",
    "--restrict-filenames",
    "--no-check-certificate",
    "--force-ipv4",
    "--impersonate",
    "chrome:windows-10",
    "--referer",
    "https://www.douyin.com/",
    "--user-agent",
    chromeUserAgent,
    "-f",
    "best[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "-o",
    outputTemplate,
    "--print",
    "after_move:filepath",
    ...cookieArgs,
    ...extraArgs,
    url,
  ];
  const result = await execFilePromise("python", args, { cwd: rootDir });
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const downloadedPath = [...lines].reverse().find((line) => fs.existsSync(line));
  if (!downloadedPath) throw new Error("解析器没有返回可用视频文件。");
  return downloadedPath;
}

function normalizeEscapedUrl(value) {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\+/g, "");
}

function findVideoUrlsInHtml(html) {
  const expanded = normalizeEscapedUrl(String(html || ""));
  const candidates = new Set();
  const urlRegex = /https?:\/\/[^"'<>\\\s]+/gi;
  for (const match of expanded.matchAll(urlRegex)) {
    const value = normalizeEscapedUrl(decodeURIComponentSafe(match[0]));
    if (!/(douyinvod|bytecdn|douyinpic|amemv|snssdk)/i.test(value)) continue;
    if (!/(play_addr|playwm|\.mp4|mime_type=video|video\/tos)/i.test(value)) continue;
    candidates.add(value.replace(/[),;]+$/g, ""));
  }
  return [...candidates];
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function fetchHtmlCandidates(url, douyinCookie = "") {
  const response = await fetch(url, {
    redirect: "follow",
    headers: douyinCookie ? { ...douyinHeaders, Cookie: douyinCookie } : douyinHeaders,
    signal: AbortSignal.timeout(22000),
  });
  if (!response.ok) throw new Error(`网页读取失败：${response.status}`);
  const html = await response.text();
  return findVideoUrlsInHtml(html);
}

async function downloadDirectVideo(videoUrl, id, douyinCookie = "") {
  const fileName = `douyin-${id}-direct.mp4`;
  const targetPath = path.join(uploadDir, fileName);
  const response = await fetch(videoUrl, {
    redirect: "follow",
    headers: {
      ...douyinHeaders,
      ...(douyinCookie ? { Cookie: douyinCookie } : {}),
      Accept: "video/webm,video/mp4,video/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`视频地址下载失败：${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(targetPath));
  const stats = await fsp.stat(targetPath);
  if (stats.size < 1024 * 16) {
    await fsp.unlink(targetPath).catch(() => {});
    throw new Error("下载到的文件太小，不像真实视频。");
  }
  await requirePlayableVideo(targetPath);
  return targetPath;
}

function collectUrlsFromJson(value, found = []) {
  if (!value) return found;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /(douyinvod|bytecdn|video\/tos|\.mp4|play|download|watermark|aweme|douyin)/i.test(value)) {
      found.push(value);
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrlsFromJson(item, found));
    return found;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      const important = /(url|play|download|video|addr|wm|watermark|nwm|nowatermark)/i.test(key);
      const before = found.length;
      collectUrlsFromJson(item, found);
      if (!important && found.length > before) {
        found.splice(before, found.length - before);
      }
    });
  }
  return found;
}

async function tryExternalParserApi(rawInput, settings, id) {
  const template = String(settings.parserApiTemplate || "").trim();
  if (!template) throw new Error("未配置外部解析 API。");
  const url = extractFirstHttpUrl(rawInput) || String(rawInput || "").trim();
  if (!url) throw new Error("外部解析 API 需要抖音链接或口令输入。");
  const requestUrl = template.includes("{url}")
    ? template.replaceAll("{url}", encodeURIComponent(url))
    : `${template}${template.includes("?") ? "&" : "?"}url=${encodeURIComponent(url)}`;
  const headers = {
    "User-Agent": chromeUserAgent,
    Accept: "application/json, video/mp4, */*",
  };
  if (settings.parserApiKey) headers.Authorization = `Bearer ${settings.parserApiKey}`;
  const response = await fetch(requestUrl, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(120000),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`外部解析 API 返回失败：${response.status}`);
  if (/video|octet-stream/i.test(contentType)) {
    const filePath = path.join(uploadDir, `douyin-${id}-api.mp4`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath));
    const stats = await fsp.stat(filePath);
    if (stats.size < 1024 * 16) throw new Error("外部解析 API 返回的视频文件过小。");
    return filePath;
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const urls = findVideoUrlsInHtml(text);
    for (const item of urls.slice(0, 8)) {
      try {
        return await downloadDirectVideo(item, id);
      } catch {
        // Try next URL.
      }
    }
    throw new Error("外部解析 API 未返回标准 JSON 或视频地址。");
  }
  const urls = collectUrlsFromJson(parsed)
    .map((item) => normalizeEscapedUrl(item))
    .filter((item, index, array) => array.indexOf(item) === index);
  const preferred = urls.sort((left, right) => {
    const score = (item) => (/watermark|playwm/i.test(item) ? 0 : 2) + (/\.mp4|video\/tos|douyinvod/i.test(item) ? 1 : 0);
    return score(right) - score(left);
  });
  for (const item of preferred.slice(0, 12)) {
    try {
      return await downloadDirectVideo(item, id);
    } catch {
      // Try next URL.
    }
  }
  throw new Error("外部解析 API 返回了数据，但没有可下载的视频地址。");
}

function isDouyinStaticVideoAsset(url) {
  const text = String(url || "");
  return /douyin-pc-web\/.*\.mp4|\/uuu_\d+\.mp4|play_effect|playing_effect|download-guide/i.test(text);
}

function isRealDouyinVideoUrl(url) {
  const text = normalizeEscapedUrl(String(url || ""));
  if (!/^https?:\/\//i.test(text) || isDouyinStaticVideoAsset(text)) return false;
  return /(douyinvod\.com|video\/tos|\/aweme\/v1\/play\/|v\d+-web|bytevideo)/i.test(text);
}

function looksLikeVideoResource(url, contentType = "") {
  if (isDouyinStaticVideoAsset(url)) return false;
  return (/video/i.test(contentType) && isRealDouyinVideoUrl(url))
    || isRealDouyinVideoUrl(url);
}

function findAwemeObject(value, expectedAwemeId, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (expectedAwemeId && String(value.aweme_id || "") === String(expectedAwemeId)) return value;
  if (!expectedAwemeId && value.video && value.aweme_id) return value;
  if (value.aweme_detail) {
    const found = findAwemeObject(value.aweme_detail, expectedAwemeId, seen);
    if (found) return found;
  }
  for (const item of Object.values(value)) {
    if (!item || typeof item !== "object") continue;
    const found = findAwemeObject(item, expectedAwemeId, seen);
    if (found) return found;
  }
  return null;
}

function extractUrlList(address, score, items) {
  for (const url of address?.url_list || []) {
    const normalized = normalizeEscapedUrl(url);
    if (isRealDouyinVideoUrl(normalized)) items.push({ url: normalized, score });
  }
}

function extractVideoUrlsFromAwemeDetail(data, expectedAwemeId = "") {
  const aweme = findAwemeObject(data, expectedAwemeId);
  const video = aweme?.video || {};
  const items = [];
  for (const rate of video.bit_rate || []) {
    extractUrlList(rate.play_addr, 1000000 + Number(rate.bit_rate || 0), items);
  }
  extractUrlList(video.play_addr_h264, 900000, items);
  extractUrlList(video.play_addr, 800000, items);
  extractUrlList(video.download_addr, 700000, items);
  const seen = new Set();
  const urls = items
    .sort((left, right) => right.score - left.score)
    .map((item) => item.url)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  return {
    awemeId: aweme?.aweme_id || "",
    desc: aweme?.desc || "",
    expectedDuration: Number(video.duration || 0) / 1000,
    urls,
  };
}

function makeCapturedVideoCollector(id) {
  const savedPaths = [];
  const tasks = [];
  let index = 0;
  const collect = async (response) => {
    const url = response.url();
    const headers = response.headers();
    if (!looksLikeVideoResource(url, headers["content-type"] || "")) return;
    const task = (async () => {
      try {
        const buffer = await response.body();
        if (!buffer || buffer.length < 1024 * 64) return;
        const filePath = path.join(uploadDir, `douyin-${id}-browser-${index++}.mp4`);
        await fsp.writeFile(filePath, buffer);
        savedPaths.push(filePath);
      } catch {
        // Streaming media responses may not expose a complete body; URL fallback handles those.
      }
    })();
    tasks.push(task);
  };
  return { collect, tasks, savedPaths };
}

async function finishCapturedVideoCollector(collector) {
  await Promise.allSettled(collector.tasks);
  const paths = [...collector.savedPaths].sort((left, right) => {
    const leftSize = fs.existsSync(left) ? fs.statSync(left).size : 0;
    const rightSize = fs.existsSync(right) ? fs.statSync(right).size : 0;
    return rightSize - leftSize;
  });
  for (const filePath of paths) {
    try {
      const stats = await fsp.stat(filePath);
      if (stats.size >= 1024 * 64) {
        await requirePlayableVideo(filePath);
        return filePath;
      }
    } catch {
      await fsp.unlink(filePath).catch(() => {});
    }
  }
  return "";
}

async function addCookieJarToContext(context, cookieJar = []) {
  const cookies = [];
  for (const cookie of cookieJar || []) {
    if (!cookie?.name || !cookie?.value || !cookie?.domain) continue;
    const next = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || "/",
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
    };
    const expires = Number(cookie.expires || cookie.expirationDate || 0);
    if (expires > 0) next.expires = expires;
    if (["Strict", "Lax", "None"].includes(cookie.sameSite)) next.sameSite = cookie.sameSite;
    cookies.push(next);
  }
  if (cookies.length) await context.addCookies(cookies).catch(() => {});
}

async function resolveWithHeadlessAwemeDetail(candidate, id, cookieSource = {}) {
  const { chromium } = await import("playwright-core");
  const executablePath = await findBrowserExecutable();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    locale: "zh-CN",
    userAgent: chromeUserAgent,
    viewport: { width: 1365, height: 900 },
  });
  await addCookieJarToContext(context, cookieSource.cookieJar || []);
  const page = await context.newPage();
  const expectedAwemeId = extractAwemeId(candidate);
  let detailData = null;
  const detailResponses = [];
  const collectDetail = async (response) => {
    const url = response.url();
    if (!/\/aweme\/v1\/web\/aweme\/detail\//i.test(url)) return;
    if (expectedAwemeId && !url.includes(expectedAwemeId)) return;
    try {
      const data = await response.json();
      const parsed = extractVideoUrlsFromAwemeDetail(data, expectedAwemeId);
      detailResponses.push({ url, parsed });
      if (parsed.urls.length) detailData = data;
    } catch {
      // Ignore non-JSON or blocked responses.
    }
  };
  page.on("response", collectDetail);
  try {
    await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 60000 });
    for (let attempt = 0; attempt < 24 && !detailData; attempt += 1) {
      await page.waitForTimeout(250);
    }
    if (!detailData) {
      throw new Error("隐藏浏览器未拿到目标视频详情接口。");
    }
    const parsed = extractVideoUrlsFromAwemeDetail(detailData, expectedAwemeId);
    if (expectedAwemeId && parsed.awemeId && parsed.awemeId !== expectedAwemeId) {
      throw new Error(`详情接口返回了非目标视频：${parsed.awemeId}`);
    }
    const minDuration = parsed.expectedDuration >= 8 ? Math.max(3, parsed.expectedDuration * 0.45) : 0;
    for (const videoUrl of parsed.urls.slice(0, 16)) {
      try {
        const downloadedPath = await downloadDirectVideo(videoUrl, id, cookieSource.cookieHeader || "");
        await requirePlayableVideo(downloadedPath, { minDuration });
        return downloadedPath;
      } catch {
        // Try the next address from the same target aweme detail.
      }
    }
    throw new Error(`目标视频详情已读取，但 ${parsed.urls.length} 个真实视频地址均下载失败。`);
  } finally {
    page.off("response", collectDetail);
    await browser.close().catch(() => {});
  }
}

async function resolveWithBrowser(candidate, id, douyinCookie = "") {
  const context = await ensureDouyinBrowserContext();
  const page = context.pages()[0] || await context.newPage();
  const videoUrls = new Set();
  const captured = makeCapturedVideoCollector(id);
  const collectResponse = async (response) => {
    const url = response.url();
    const headers = response.headers();
    if (looksLikeVideoResource(url, headers["content-type"] || "")) {
      videoUrls.add(url);
      captured.collect(response);
    }
  };
  page.on("response", collectResponse);
  try {
    await page.goto(candidate, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const closeButtons = Array.from(document.querySelectorAll("button, [role=button]"))
        .filter((item) => /关闭|稍后|知道了|跳过|取消/.test(item.textContent || ""));
      closeButtons.slice(0, 3).forEach((item) => item.click());
      const video = document.querySelector("video");
      if (video) {
        video.muted = true;
        video.play?.().catch(() => {});
      }
      document.querySelector("button[aria-label*=播放], .xgplayer-start, .xgplayer-play")?.click?.();
    }).catch(() => {});
    await page.waitForTimeout(8500);
    const pageUrls = await page.evaluate(() => {
      const urls = new Set();
      Array.from(document.querySelectorAll("video, source")).forEach((item) => {
        const src = item.currentSrc || item.src;
        if (src) urls.add(src);
      });
      performance.getEntriesByType("resource").forEach((entry) => urls.add(entry.name));
      urls.add(document.documentElement.innerHTML);
      return [...urls];
    }).catch(() => []);
    for (const item of pageUrls) {
      if (String(item).startsWith("http") && looksLikeVideoResource(item)) videoUrls.add(item);
      if (String(item).length > 1000) {
        for (const videoUrl of findVideoUrlsInHtml(String(item))) videoUrls.add(videoUrl);
      }
    }
    for (const videoUrl of [...videoUrls].filter((url) => !String(url).startsWith("blob:")).slice(0, 12)) {
      try {
        const downloadedPath = await downloadDirectVideo(videoUrl, id, douyinCookie);
        return downloadedPath;
      } catch {
        // Try the next captured media resource.
      }
    }
    const capturedPath = await finishCapturedVideoCollector(captured);
    if (capturedPath) return capturedPath;
    throw new Error(`浏览器已打开页面，但没有抓到可下载视频资源。当前页面：${page.url()}`);
  } finally {
    page.off("response", collectResponse);
  }
}

async function captureCurrentBrowserVideo(id, douyinCookie = "") {
  if (!douyinCookieContext) {
    throw new Error("专用抖音窗口尚未打开。请先在 CPA 设置里打开抖音登录窗口，并点开目标视频。");
  }
  const pages = douyinCookieContext.pages();
  const errors = [];
  for (const page of pages) {
    const videoUrls = new Set();
    const captured = makeCapturedVideoCollector(id);
    const collectResponse = async (response) => {
      const url = response.url();
      const headers = response.headers();
      if (looksLikeVideoResource(url, headers["content-type"] || "")) {
        videoUrls.add(url);
        captured.collect(response);
      }
    };
    page.on("response", collectResponse);
    try {
      await page.bringToFront().catch(() => {});
      await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll("video"));
        const target = videos.find((video) => video.offsetWidth > 200 && video.offsetHeight > 120) || videos[0];
        if (target) {
          target.muted = true;
          target.scrollIntoView?.({ block: "center", inline: "center" });
          target.play?.().catch(() => {});
          target.click?.();
        }
        document.querySelector("button[aria-label*=播放], .xgplayer-start, .xgplayer-play")?.click?.();
      }).catch(() => {});
      await page.waitForTimeout(7000);
      const pageUrls = await page.evaluate(() => {
        const urls = new Set();
        Array.from(document.querySelectorAll("video, source")).forEach((item) => {
          const src = item.currentSrc || item.src;
          if (src) urls.add(src);
        });
        performance.getEntriesByType("resource").forEach((entry) => urls.add(entry.name));
        urls.add(document.documentElement.innerHTML);
        return [...urls];
      }).catch(() => []);
      for (const item of pageUrls) {
        if (String(item).startsWith("http") && looksLikeVideoResource(item)) videoUrls.add(item);
        if (String(item).length > 1000) {
          for (const videoUrl of findVideoUrlsInHtml(String(item))) videoUrls.add(videoUrl);
        }
      }
      for (const videoUrl of [...videoUrls].filter((url) => !String(url).startsWith("blob:")).slice(0, 16)) {
        try {
          const downloadedPath = await downloadDirectVideo(videoUrl, id, douyinCookie);
          return { downloadedPath, sourceUrl: page.url() };
        } catch (error) {
          errors.push(`当前页直连下载：${error.message}`);
        }
      }
      const capturedPath = await finishCapturedVideoCollector(captured);
      if (capturedPath) return { downloadedPath: capturedPath, sourceUrl: page.url() };
      errors.push(`当前页没有抓到可下载视频资源：${page.url()}`);
    } finally {
      page.off("response", collectResponse);
    }
  }
  throw new Error(errors.join("\n") || "没有从专用抖音窗口抓到视频资源。");
}

function summarizeDouyinError(errors) {
  const text = errors.join("\n");
  if (/Fresh cookies|cookies/i.test(text)) {
    return "抖音要求新鲜 Cookie。请打开 CPA 设置，点击“打开抖音登录窗口”，登录后点击“自动读取 Cookie”，再重新解析。";
  }
  if (/Could not copy Chrome cookie database|cookie database/i.test(text)) {
    return "系统浏览器 Cookie 数据库不可读。工具已取消读取系统浏览器，建议使用“打开抖音登录窗口 + 自动读取 Cookie”或配置外部解析 API。";
  }
  if (/SSL|EOF|TLS|Connection was reset|Recv failure/i.test(text)) {
    return "网络或抖音风控中断了连接。已尝试浏览器指纹方式，仍失败；可换一个单条视频分享链接、关闭代理后重试，或直接上传视频。";
  }
  return text.slice(0, 900) || "抖音链接解析失败。请确认这是单条公开视频链接，或直接上传视频文件继续分析。";
}

async function resolveDouyinVideo(rawInput, cookieSource = {}, settings = {}) {
  const browserCandidates = await getCurrentDouyinBrowserCandidates();
  let candidates = [];
  const id = randomId();
  const attempts = [];
  if (settings.parserApiTemplate) {
    try {
      attempts.push("尝试外部解析 API（不打开抖音网页）");
      const downloadedPath = await tryExternalParserApi(rawInput, settings, id);
      return { downloadedPath, strategy: "外部解析 API", sourceUrl: extractFirstHttpUrl(rawInput) || "API 输入内容", attempts };
    } catch (error) {
      attempts.push(`外部解析 API 未成功：${error.message}`);
    }
  }
  try {
    candidates = buildDouyinCandidates(rawInput, browserCandidates);
  } catch (error) {
    if (!extractFirstHttpUrl(rawInput) && douyinCookieContext) {
      attempts.push("没有标准链接，尝试从专用抖音窗口当前页面抓取视频资源");
      const result = await captureCurrentBrowserVideo(id, cookieSource.cookieHeader || "");
      return { downloadedPath: result.downloadedPath, strategy: "专用浏览器当前页面抓取", sourceUrl: result.sourceUrl, attempts };
    }
    throw error;
  }
  const expandedCandidates = [];
  for (const candidate of candidates) {
    attempts.push(`识别候选链接：${candidate}`);
    const expanded = await expandUrl(candidate);
    if (expanded !== candidate) attempts.push(`短链展开：${expanded}`);
    rejectKnownNonVideoUrl(expanded);
    expandedCandidates.push(candidate, expanded);
    const awemeId = extractAwemeId(expanded);
    if (awemeId) expandedCandidates.push(`https://www.douyin.com/video/${awemeId}`);
  }
  const uniqueCandidates = [...new Set(expandedCandidates)];
  const errors = [];

  for (const candidate of uniqueCandidates) {
    try {
      attempts.push(`尝试隐藏浏览器读取目标视频详情：${candidate}`);
      const downloadedPath = await resolveWithHeadlessAwemeDetail(candidate, id, cookieSource);
      return { downloadedPath, strategy: "隐藏浏览器详情接口", sourceUrl: candidate, attempts };
    } catch (error) {
      errors.push(`隐藏详情接口：${error.message}`);
    }
  }

  for (const candidate of uniqueCandidates) {
    try {
      attempts.push(`尝试 yt-dlp 解析：${candidate}`);
      const downloadedPath = await runYtDlpDownload(candidate, id, [], cookieSource);
      return { downloadedPath, strategy: cookieSource.cookieHeader ? "yt-dlp + 自动 Cookie 文件" : "yt-dlp", sourceUrl: candidate, attempts };
    } catch (error) {
      errors.push(`yt-dlp：${error.stderr || error.stdout || error.message}`);
    }
  }

  for (const candidate of uniqueCandidates) {
    try {
      attempts.push(`尝试网页源码解析：${candidate}`);
      const videoUrls = await fetchHtmlCandidates(candidate, cookieSource.cookieHeader || "");
      for (const videoUrl of videoUrls.slice(0, 8)) {
        try {
          const downloadedPath = await downloadDirectVideo(videoUrl, id, cookieSource.cookieHeader || "");
          return { downloadedPath, strategy: "网页视频地址", sourceUrl: candidate, attempts };
        } catch (error) {
          errors.push(`直连下载：${error.message}`);
        }
      }
      if (!videoUrls.length) errors.push(`网页解析：没有找到视频地址 ${candidate}`);
    } catch (error) {
      errors.push(`网页解析：${error.message}`);
    }
  }

  for (const candidate of uniqueCandidates) {
    try {
      attempts.push(`尝试专用浏览器抓取真实视频资源：${candidate}`);
      const downloadedPath = await resolveWithBrowser(candidate, id, cookieSource.cookieHeader || "");
      return { downloadedPath, strategy: "专用浏览器抓取", sourceUrl: candidate, attempts };
    } catch (error) {
      errors.push(`浏览器抓取：${error.message}`);
    }
  }

  if (douyinCookieContext) {
    try {
      attempts.push("尝试从专用抖音窗口当前页面直接抓取视频资源");
      const result = await captureCurrentBrowserVideo(id, cookieSource.cookieHeader || "");
      return { downloadedPath: result.downloadedPath, strategy: "专用浏览器当前页面抓取", sourceUrl: result.sourceUrl, attempts };
    } catch (error) {
      errors.push(`当前窗口抓取：${error.message}`);
    }
  }

  const finalError = new Error(summarizeDouyinError(errors));
  finalError.attempts = attempts;
  throw finalError;
}

async function getVideoInfo(filePath) {
  const probe = [
    "import cv2, json, sys",
    "path=sys.argv[1]",
    "cap=cv2.VideoCapture(path)",
    "ok=cap.isOpened()",
    "fps=float(cap.get(cv2.CAP_PROP_FPS) or 0)",
    "frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)",
    "width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)",
    "height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)",
    "duration=(frames/fps) if frames and fps else 0",
    "cap.release()",
    "print(json.dumps({'ok':ok,'fps':fps,'frameCount':frames,'width':width,'height':height,'duration':duration}, ensure_ascii=False))",
  ].join("; ");
  const result = await execFilePromise("python", ["-c", probe, filePath], { timeout: 30000, windowsHide: true });
  const jsonLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .at(-1);
  const info = JSON.parse(jsonLine || "{}");
  if (!info.ok) throw new Error("无法读取视频帧信息。");
  return info;
}

async function requirePlayableVideo(filePath, options = {}) {
  const info = await getVideoInfo(filePath);
  if (!info.duration || !info.width || !info.height || !info.frameCount) {
    throw new Error("抓到的文件不是完整可播放视频。");
  }
  const minDuration = Number(options.minDuration || 0);
  if (minDuration && info.duration < minDuration) {
    throw new Error(`抓到的视频时长只有 ${info.duration.toFixed(2)} 秒，不符合目标视频。`);
  }
  return info;
}

function parseExtractedText(text) {
  const marker = "Clean text:";
  const rangeMarker = "With time ranges:";
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const end = text.indexOf(rangeMarker, start);
  const block = text.slice(start + marker.length, end > start ? end : undefined);
  return block
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\d+\.\s*/, ""))
    .filter(Boolean)
    .join("\n");
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function parseExtractedCsv(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const text = String(cells[3] || "").trim();
    if (text) rows.push(text);
  }
  return rows.join("\n");
}

function detectCandidateWatermarkNorms(csvText, info) {
  const lines = String(csvText || "").split(/\r?\n/).filter(Boolean);
  const watermarkNorms = new Set();
  const width = Math.max(1, Number(info?.width || 0));
  const height = Math.max(1, Number(info?.height || 0));
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const x = Number(cells[4] || 0) / width;
    const y = Number(cells[5] || 0) / height;
    const text = String(cells[6] || "").trim();
    const norm = normalizeOcrText(text);
    const corner = (x <= 0.34 && y <= 0.22) || (x >= 0.66 && y <= 0.18) || (x <= 0.34 && y >= 0.78) || (x >= 0.66 && y >= 0.78);
    const logoLike = /^[A-Z0-9._-]{3,20}$/.test(norm) || /BALNO|CERAMIC|DOUYIN|TIKTOK|抖音|快手|小红书/i.test(norm);
    if (corner && logoLike) watermarkNorms.add(norm);
  }
  return watermarkNorms;
}

function normalizeOcrText(text) {
  return String(text || "")
    .trim()
    .replace(/[．•・]/g, "·")
    .replace(/\s+/g, "")
    .replace(/(?<=\d)[xX×](?=\d)/g, "X")
    .toUpperCase();
}

function watermarkRegion(record) {
  const x = Number(record.cx || 0) / Math.max(1, Number(record.w || 1));
  const y = Number(record.cy || 0) / Math.max(1, Number(record.h || 1));
  if (y <= 0.20 && x <= 0.46) return "top-left";
  if (y <= 0.18 && x >= 0.54) return "top-right";
  if (y >= 0.80 && x <= 0.46) return "bottom-left";
  if (y >= 0.78 && x >= 0.54) return "bottom-right";
  if (y <= 0.10) return "top-band";
  if (y >= 0.90) return "bottom-band";
  return "";
}

function detectWatermarkNorms(records, info) {
  const grouped = new Map();
  const sampleTimes = new Set();
  for (const record of records || []) {
    sampleTimes.add(Number(record.time || 0).toFixed(3));
    const norm = normalizeOcrText(record.norm || record.text);
    if (!norm) continue;
    const region = watermarkRegion(record);
    if (!region) continue;
    const key = `${region}:${norm}`;
    const items = grouped.get(key) || [];
    items.push(record);
    grouped.set(key, items);
  }

  const processedSamples = Math.max(1, sampleTimes.size);
  const duration = Number(info?.duration || 0);
  const minCount = Math.max(2, Math.ceil(processedSamples * 0.08));
  const minSpan = Math.max(3, duration * 0.16);
  const watermarkNorms = new Set();
  const fixedPlatformWords = /^(DOUYIN|TIKTOK|抖音|快手|小红书|视频号|西瓜视频)$/i;

  for (const [key, items] of grouped.entries()) {
    const norm = key.split(":").slice(1).join(":");
    const times = items.map((item) => Number(item.time || 0));
    const span = Math.max(...times) - Math.min(...times);
    const avgX = items.reduce((sum, item) => sum + Number(item.cx || 0) / Math.max(1, Number(item.w || 1)), 0) / items.length;
    const avgY = items.reduce((sum, item) => sum + Number(item.cy || 0) / Math.max(1, Number(item.h || 1)), 0) / items.length;
    const stablePosition = items.every((item) => {
      const x = Number(item.cx || 0) / Math.max(1, Number(item.w || 1));
      const y = Number(item.cy || 0) / Math.max(1, Number(item.h || 1));
      return Math.abs(x - avgX) <= 0.08 && Math.abs(y - avgY) <= 0.06;
    });
    const logoFragment = /^[A-Z0-9._-]{2,16}$/.test(norm) && items.length >= 2;
    if (fixedPlatformWords.test(norm) || (stablePosition && items.length >= minCount && span >= minSpan) || (stablePosition && logoFragment)) {
      watermarkNorms.add(norm);
    }
  }
  return watermarkNorms;
}

function sanitizeLineByWatermarks(line, watermarkNorms) {
  let result = String(line || "").trim();
  for (const norm of [...watermarkNorms].sort((a, b) => b.length - a.length)) {
    if (!norm || norm.length < 2) continue;
    const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), "");
  }
  return trimNoisePunctuation(result.replace(/\s{2,}/g, " "));
}

function trimNoisePunctuation(text) {
  const noise = new Set(["·", ",", "，", "。", ":", "：", ";", "；", "|", "｜", "/", "\\", "-", " "]);
  const chars = [...String(text || "")];
  let start = 0;
  let end = chars.length;
  while (start < end && noise.has(chars[start])) start += 1;
  while (end > start && noise.has(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join("").trim();
}

function filterTextByWatermarks(text, watermarkNorms) {
  const seen = new Set();
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const raw = line.trim();
      const norm = normalizeOcrText(raw);
      if (!raw || watermarkNorms.has(norm)) return "";
      return sanitizeLineByWatermarks(raw, watermarkNorms);
    })
    .filter((line) => {
      const norm = normalizeOcrText(line);
      if (!line || !norm || seen.has(norm)) return false;
      seen.add(norm);
      return true;
    })
    .join("\n");
}

async function writeFilteredText(outDir, text, watermarkNorms) {
  const fileName = "extracted_subtitles_clean.txt";
  const filePath = path.join(outDir, fileName);
  const lines = text ? text.split(/\r?\n/).filter(Boolean) : [];
  const content = [
    "Clean OCR text",
    "",
    "已过滤固定 Logo / 水印文字。",
    watermarkNorms.size ? `过滤项：${[...watermarkNorms].join("、")}` : "过滤项：无",
    "",
    ...lines.map((line, index) => `${index + 1}. ${line}`),
    "",
  ].join("\n");
  await fsp.writeFile(filePath, content, "utf8");
  return fileName;
}

async function waitForStableFile(filePath) {
  let previousSize = -1;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const stats = await fsp.stat(filePath);
      if (stats.size > 2 && stats.size === previousSize) return true;
      previousSize = stats.size;
    } catch {
      previousSize = -1;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return previousSize > 2;
}

async function readJsonArrayFile(filePath) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const start = raw.indexOf("[");
      const end = raw.lastIndexOf("]");
      const jsonText = start >= 0 && end >= start ? raw.slice(start, end + 1) : raw;
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  return [];
}

async function fileIfExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/settings", async (_req, res) => {
  res.json(redactSettings(await getSettings()));
});

app.post("/api/settings", async (req, res) => {
  try {
    const current = await getSettings();
    const next = {
      ...current,
      baseUrl: String(req.body.baseUrl || "").trim(),
      parserApiTemplate: String(req.body.parserApiTemplate || current.parserApiTemplate || "").trim(),
      model: String(req.body.model || "").trim(),
      transcriptionModel: String(req.body.transcriptionModel || current.transcriptionModel || "whisper-1").trim(),
      models: Array.isArray(req.body.models) ? req.body.models : current.models || [],
    };
    if (typeof req.body.apiKey === "string" && req.body.apiKey.trim()) {
      next.apiKey = req.body.apiKey.trim();
    }
    if (typeof req.body.douyinCookie === "string" && req.body.douyinCookie.trim()) {
      next.douyinCookie = req.body.douyinCookie.trim();
    }
    if (typeof req.body.parserApiKey === "string" && req.body.parserApiKey.trim()) {
      next.parserApiKey = req.body.parserApiKey.trim();
    }
    await writeJson(settingsPath, next);
    res.json(redactSettings(next));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/models", async (req, res) => {
  try {
    const current = await getSettings();
    const baseUrl = normalizeBaseUrl(req.body.baseUrl || current.baseUrl);
    const apiKey = String(req.body.apiKey || current.apiKey || "").trim();
    if (!baseUrl) throw new Error("请先填写 CPA Base URL。");
    if (!apiKey) throw new Error("请先填写 CPA API Key。");
    const data = await fetchJsonOrThrow(apiPath(baseUrl, "/models"), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const models = Array.isArray(data.data)
      ? data.data.map((item) => item.id || item.name).filter(Boolean)
      : [];
    if (!models.length) throw new Error("模型接口返回为空，请检查 Base URL 是否兼容 OpenAI /v1。");
    res.json({ models });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/douyin-cookie/open", async (_req, res) => {
  try {
    await openDouyinCookieBrowser();
    res.json({ ok: true, message: "已打开抖音专用登录窗口。请在该窗口登录后，回到本工具点击“自动读取 Cookie”。" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/douyin-cookie/read", async (_req, res) => {
  try {
    res.json(await readAndSaveDouyinCookie());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/douyin-cookie/close", async (_req, res) => {
  try {
    if (douyinCookieContext) {
      await douyinCookieContext.close();
      douyinCookieContext = null;
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) throw new Error("没有收到视频文件。");
    const info = await getVideoInfo(req.file.path).catch(() => null);
    const record = await saveMediaRecord({
      id: randomId(),
      source: "upload",
      originalName: cleanUploadName(req.file.originalname),
      fileName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      url: publicMediaUrl(req.file.filename),
      fps: info?.fps || 0,
      frameCount: info?.frameCount || 0,
      duration: info?.duration || 0,
      width: info?.width || 0,
      height: info?.height || 0,
      createdAt: new Date().toISOString(),
    });
    res.json({ media: record });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/douyin", async (req, res) => {
  try {
    const settings = await getSettings();
    const { downloadedPath, strategy, sourceUrl, attempts = [] } = await resolveDouyinVideo(req.body.url || "", {
      cookieHeader: settings.douyinCookie || "",
      cookieJar: settings.douyinCookieJar || [],
    }, settings);
    const stats = await fsp.stat(downloadedPath);
    const info = await requirePlayableVideo(downloadedPath);
    const fileName = path.basename(downloadedPath);
    const record = await saveMediaRecord({
      id: randomId(),
      source: "douyin",
      originalName: sourceUrl,
      fileName,
      mimeType: "video/mp4",
      size: stats.size,
      url: publicMediaUrl(fileName),
      extractor: strategy,
      fps: info?.fps || 0,
      frameCount: info?.frameCount || 0,
      duration: info?.duration || 0,
      width: info?.width || 0,
      height: info?.height || 0,
      createdAt: new Date().toISOString(),
    });
    res.json({ media: record, strategy, attempts });
  } catch (error) {
    res.status(400).json({ error: error.message, attempts: error.attempts || [] });
  }
});

app.post("/api/media-info", async (req, res) => {
  try {
    const record = await findMediaRecord(String(req.body.mediaId || ""));
    if (!record) throw new Error("找不到已上传或已解析的视频。");
    const filePath = path.join(uploadDir, record.fileName);
    const info = await requirePlayableVideo(filePath);
    const next = { ...record, ...info };
    await saveMediaRecord(next);
    res.json({ media: next, info });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/extract-frames", async (req, res) => {
  try {
    const record = await findMediaRecord(String(req.body.mediaId || ""));
    if (!record) throw new Error("找不到已上传或已解析的视频。");
    if (!(await fileIfExists(frameExtractorScript))) {
      throw new Error("工具内置抽帧脚本缺失。");
    }
    const mode = req.body.mode === "every-frame" ? "every-frame" : "interval";
    const sampleInterval = Math.max(0.05, Math.min(30, Number(req.body.sampleInterval) || 0.25));
    const stripWatermark = Boolean(req.body.stripWatermark);
    const maxPreview = Math.max(24, Math.min(360, Number(req.body.maxPreview) || 240));
    const runName = `${Date.now()}-${record.id}-frames`;
    const outDir = path.join(ocrRunDir, runName);
    const filePath = path.join(uploadDir, record.fileName);
    const args = [
      frameExtractorScript,
      filePath,
      "--output-dir",
      outDir,
      "--mode",
      mode,
      "--sample-interval",
      String(sampleInterval),
      "--max-preview",
      String(maxPreview),
    ];
    if (stripWatermark) args.push("--strip-watermark");
    const result = await execFilePromise("python", args, {
      cwd: rootDir,
      timeout: 1000 * 60 * 20,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20,
    });
    const data = parseLastJsonObject(result.stdout);
    const frames = Array.isArray(data.frames)
      ? data.frames.map((frame) => ({
          ...frame,
          image: publicOcrUrl(runName, frame.fileName),
        }))
      : [];
    res.json({
      ...data,
      runName,
      frames,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/extract-subtitles", async (req, res) => {
  try {
    const record = await findMediaRecord(String(req.body.mediaId || ""));
    if (!record) throw new Error("找不到已上传或已解析的视频。");
    if (!(await fileIfExists(videoOcrScript))) {
      throw new Error("工具内置 OCR 脚本缺失。");
    }

    const mode = req.body.mode === "every-frame" ? "every-frame" : "interval";
    const sampleInterval = Math.max(0.05, Math.min(30, Number(req.body.sampleInterval) || 0.25));
    const includeWatermark = Boolean(req.body.includeWatermark);
    const runName = `${Date.now()}-${record.id}-ocr`;
    const outDir = path.join(ocrRunDir, runName);
    const filePath = path.join(uploadDir, record.fileName);
    const args = [
      videoOcrScript,
      filePath,
      "--output-dir",
      outDir,
      "--mode",
      mode,
      "--sample-interval",
      String(sampleInterval),
      "--progress-every",
      "200",
    ];
    if (includeWatermark) args.push("--include-watermark");

    const result = await execFilePromise("python", args, {
      cwd: rootDir,
      timeout: 1000 * 60 * 45,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20,
    });
    const output = parseLastJsonObject(result.stdout);
    const resultPath = path.join(outDir, "result.json");
    const fileOutput = await readJson(resultPath, output);
    const finalOutput = Object.keys(fileOutput || {}).length ? fileOutput : output;
    const info = finalOutput.info || await getVideoInfo(filePath).catch(() => null);
    const visualText = String(finalOutput.text || "").trim();
    const subtitleCount = Array.isArray(finalOutput.subtitles) ? finalOutput.subtitles.length : 0;
    const filteredWatermarkCount = Array.isArray(finalOutput.filteredWatermarks) ? finalOutput.filteredWatermarks.length : 0;

    res.json({
      visualText,
      tags: [],
      mode,
      sampleInterval,
      includeWatermark,
      subtitleCount,
      filteredWatermarkCount,
      info,
      artifacts: {
        srt: publicOcrUrl(runName, finalOutput.srtFile || "subtitles.srt"),
      },
      fileStatus: {
        srt: await fileIfExists(path.join(outDir, finalOutput.srtFile || "subtitles.srt")),
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/analyze-frames", async (req, res) => {
  try {
    const settings = await getSettings();
    const baseUrl = requireApiConfig(settings);
    const model = String(req.body.model || settings.model || "").trim();
    if (!model) throw new Error("请先获取并选择 CPA 模型。");
    const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 8) : [];
    if (!images.length) throw new Error("没有可分析的视频画面。");
    const content = [
      {
        type: "text",
        text: [
          "请只根据这些视频帧做真实识别。",
          "任务：提取画面中可见的字幕、标题、贴纸文字、商品/场景关键词。",
          "不要输出固定 Logo、水印、平台标识、账号名、头像角标等非内容文字。",
          "禁止编造口播内容；看不到就写空。",
          "请返回 JSON：{\"visualText\":\"按出现顺序合并的可见文字\",\"tags\":[\"标签\"],\"notes\":\"无法识别或需要人工补充的说明\"}",
        ].join("\n"),
      },
      ...images.map((image) => ({ type: "image_url", image_url: { url: image } })),
    ];
    const data = await fetchJsonOrThrow(apiPath(baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [{ role: "user", content }],
      }),
    });
    const text = data?.choices?.[0]?.message?.content || "";
    let parsed = null;
    try {
      parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      parsed = { visualText: text, tags: [], notes: "模型未返回标准 JSON，已保留原始识别结果。" };
    }
    res.json({
      visualText: String(parsed.visualText || "").trim(),
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter(Boolean).slice(0, 10) : [],
      notes: String(parsed.notes || "").trim(),
      raw: text,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/transcribe-media", async (req, res) => {
  try {
    const settings = await getSettings();
    const baseUrl = requireApiConfig(settings);
    const record = await findMediaRecord(String(req.body.mediaId || ""));
    if (!record) throw new Error("找不到已上传或已解析的视频。");
    const filePath = path.join(uploadDir, record.fileName);
    const buffer = await fsp.readFile(filePath);
    const form = new FormData();
    form.append(
      "file",
      new File([buffer], record.originalName || record.fileName, { type: record.mimeType || "video/mp4" }),
    );
    form.append("model", String(req.body.model || settings.transcriptionModel || "whisper-1"));
    form.append("response_format", "json");
    let response;
    try {
      response = await fetch(apiPath(baseUrl, "/audio/transcriptions"), {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        body: form,
      });
    } catch {
      throw new Error("无法连接到 CPA Base URL，请检查地址、网络或代理。");
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { text };
    }
    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || text || "语音识别请求失败。");
    }
    res.json({ text: String(data.text || "").trim(), raw: data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/rewrite", async (req, res) => {
  try {
    const settings = await getSettings();
    const baseUrl = requireApiConfig(settings);
    const model = String(req.body.model || settings.model || "").trim();
    if (!model) throw new Error("请先获取并选择 CPA 模型。");
    const sourceText = String(req.body.text || "").trim();
    if (!sourceText) throw new Error("没有可改写的真实文案。请先完成语音识别或 OCR 识别。");
    const lengthMode = String(req.body.lengthMode || "标准");
    const data = await fetchJsonOrThrow(apiPath(baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: Number(req.body.creativity ?? 0.6),
        messages: [
          {
            role: "system",
            content: "你是短视频爆款文案改写专家。只基于用户提供的原文改写，不添加不存在的事实、收入承诺或虚假案例。",
          },
          {
            role: "user",
            content: [
              `输出长度：${lengthMode}`,
              "请输出 JSON 数组，固定 3 项，每项包含 name、tone、text。",
              "三版分别是：原文整理版、爆款口播版、强转化版。",
              `原文：${sourceText}`,
            ].join("\n"),
          },
        ],
      }),
    });
    const text = data?.choices?.[0]?.message?.content || "";
    let variants = [];
    try {
      const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
      variants = Array.isArray(parsed) ? parsed : parsed.variants || [];
    } catch {
      variants = [{ name: "模型返回", tone: "原始结果", text }];
    }
    variants = variants
      .map((item, index) => ({
        name: String(item.name || `版本 ${index + 1}`),
        tone: String(item.tone || "改写结果"),
        text: String(item.text || "").trim(),
      }))
      .filter((item) => item.text)
      .slice(0, 3);
    if (!variants.length) throw new Error("模型没有返回可用改写文案。");
    res.json({ variants, raw: text });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Douyin copy tool running at http://127.0.0.1:${port}/`);
});
