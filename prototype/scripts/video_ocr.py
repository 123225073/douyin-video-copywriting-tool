#!/usr/bin/env python
import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    import cv2
except Exception as exc:
    print(f"ERROR: missing opencv-python: {exc}", file=sys.stderr)
    sys.exit(1)

try:
    from rapidocr_onnxruntime import RapidOCR
except Exception as exc:
    print(f"ERROR: missing rapidocr_onnxruntime: {exc}", file=sys.stderr)
    sys.exit(1)


def normalize_text(text):
    text = str(text or "").strip()
    text = text.replace("．", "·").replace("•", "·").replace("・", "·")
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"(?<=\d)[xX×](?=\d)", "X", text)
    return text.upper() if re.fullmatch(r"[A-Za-z0-9X_.\-]+", text) else text


def has_cjk(text):
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def meaningful_text(text):
    if has_cjk(text):
        return True
    return re.search(r"[A-Z]{2,}\d|\d{3,4}X\d{3,4}|[A-Z]{3,}", text or "") is not None


def plain_time(seconds):
    minutes = int(seconds // 60)
    rest = seconds - minutes * 60
    return f"{minutes:02d}:{rest:05.2f}"


def srt_time(seconds):
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def frame_plan(duration, fps, frame_count, mode, interval):
    if mode == "every-frame":
        total = frame_count or int(duration * fps)
        return list(range(max(0, total)))
    step = max(0.05, float(interval or 0.25))
    frames = []
    at = 0.0
    while at < duration:
        frames.append(max(0, min(frame_count - 1 if frame_count else 10**12, int(round(at * fps)))))
        at += step
    if duration:
        frames.append(max(0, min(frame_count - 1 if frame_count else 10**12, int(round((duration - 0.001) * fps)))))
    return sorted(set(frames))


def in_watermark_region(record):
    x = record["cx"] / max(1, record["w"])
    y = record["cy"] / max(1, record["h"])
    return (
        (x <= 0.46 and y <= 0.20)
        or (x >= 0.54 and y <= 0.18)
        or (x <= 0.46 and y >= 0.80)
        or (x >= 0.54 and y >= 0.78)
        or y <= 0.08
        or y >= 0.92
    )


def watermark_match(norm, watermark_norms):
    text = str(norm or "")
    for watermark in watermark_norms:
        mark = str(watermark or "")
        if len(mark) < 3:
            continue
        if text == mark or mark in text or text in mark:
            return True
    return False


def detect_watermarks(records, processed_samples, duration):
    by_norm = defaultdict(list)
    for record in records:
        if in_watermark_region(record):
            by_norm[record["norm"]].append(record)

    watermarks = set()
    min_count = max(2, int(processed_samples * 0.08))
    min_span = max(3.0, duration * 0.16)
    platform = re.compile(r"^(DOUYIN|TIKTOK|抖音|快手|小红书|视频号|西瓜视频)$", re.I)
    for norm, items in by_norm.items():
        times = [item["time"] for item in items]
        span = max(times) - min(times) if times else 0
        avg_x = sum(item["cx"] / max(1, item["w"]) for item in items) / len(items)
        avg_y = sum(item["cy"] / max(1, item["h"]) for item in items) / len(items)
        stable = all(
            abs(item["cx"] / max(1, item["w"]) - avg_x) <= 0.08
            and abs(item["cy"] / max(1, item["h"]) - avg_y) <= 0.06
            for item in items
        )
        logo_like = re.fullmatch(r"[A-Z0-9._-]{2,20}", norm or "") is not None
        if platform.fullmatch(norm or "") or (stable and len(items) >= min_count and span >= min_span) or (stable and logo_like and len(items) >= 2):
            watermarks.add(norm)
    return watermarks


@dataclass
class Run:
    norm: str
    start: float
    end: float
    count: int
    conf_sum: float
    texts: Counter = field(default_factory=Counter)
    cx_sum: float = 0.0
    cy_sum: float = 0.0
    w_sum: float = 0.0
    h_sum: float = 0.0
    partial: bool = False

    @property
    def conf(self):
        return self.conf_sum / max(1, self.count)

    @property
    def cx(self):
        return self.cx_sum / max(1, self.count)

    @property
    def cy(self):
        return self.cy_sum / max(1, self.count)

    @property
    def w(self):
        return self.w_sum / max(1, self.count)

    @property
    def h(self):
        return self.h_sum / max(1, self.count)

    @property
    def text(self):
        return self.texts.most_common(1)[0][0] if self.texts else self.norm

    def add(self, record):
        self.end = max(self.end, record["time"])
        self.count += 1
        self.conf_sum += record["conf"]
        self.texts[record["text"]] += 1
        self.cx_sum += record["cx"]
        self.cy_sum += record["cy"]
        self.w_sum += record["w"]
        self.h_sum += record["h"]


def build_runs(records, fps, mode, interval):
    max_gap = max(0.45, interval * 1.5 if mode == "interval" else 0, 1.5 / max(fps, 1.0))
    runs = []
    active = {}
    for record in sorted(records, key=lambda item: (item["time"], item["cy"], item["cx"])):
        previous = active.get(record["norm"])
        if previous and record["time"] - previous.end <= max_gap:
            previous.add(record)
        else:
            run = Run(
                norm=record["norm"],
                start=record["time"],
                end=record["time"],
                count=1,
                conf_sum=record["conf"],
                texts=Counter({record["text"]: 1}),
                cx_sum=record["cx"],
                cy_sum=record["cy"],
                w_sum=record["w"],
                h_sum=record["h"],
            )
            runs.append(run)
            active[record["norm"]] = run
    return runs


def absorb_partials(runs):
    for small in sorted(runs, key=lambda item: (len(item.norm), item.start)):
        if len(small.norm) < 2:
            continue
        for large in runs:
            if small is large or len(large.norm) <= len(small.norm):
                continue
            if small.norm not in large.norm:
                continue
            near_time = small.end <= large.start + 0.35 and 0.03 <= large.start - small.start <= 0.70
            near_pos = abs(small.cx - large.cx) <= 160 and abs(small.cy - large.cy) <= 80
            if near_time and near_pos:
                large.start = min(large.start, small.start)
                large.count += small.count
                large.conf_sum += small.conf_sum
                large.texts.update(small.texts)
                large.cx_sum += small.cx_sum
                large.cy_sum += small.cy_sum
                large.w_sum += small.w_sum
                large.h_sum += small.h_sum
                small.partial = True
                break


def run_in_watermark_region(run):
    return in_watermark_region({"cx": run.cx, "cy": run.cy, "w": run.w, "h": run.h})


def edge_logo_like(run, watermark_norms):
    if not run_in_watermark_region(run):
        return False
    norm = run.norm or ""
    if watermark_match(norm, watermark_norms):
        return True
    latin_logo = re.fullmatch(r"[A-Z0-9X_.\-·]{3,24}", norm) is not None
    mixed_brand = bool(re.search(r"[A-Z]{2,}", norm)) and has_cjk(norm) and len(norm) <= 18
    brand_words = re.search(r"(CERAMIC|CERAMICS|TIKTOK|DOUYIN|BALNO|瓷砖|品牌|官方)", norm, re.I) is not None
    return latin_logo or mixed_brand or brand_words


def dedupe(events):
    drop = set()
    for i, a in enumerate(events):
        for j, b in enumerate(events):
            if i >= j or i in drop or j in drop:
                continue
            contains = a.norm in b.norm or b.norm in a.norm
            similar = SequenceMatcher(None, a.norm, b.norm).ratio() >= 0.72
            if not contains and not similar:
                continue
            if abs(a.cx - b.cx) > (180 if contains else 70) or abs(a.cy - b.cy) > (100 if contains else 80):
                continue
            overlap = max(0.0, min(a.end, b.end) - max(a.start, b.start))
            shorter = max(0.001, min(a.end - a.start, b.end - b.start))
            interval_distance = max(0.0, max(a.start, b.start) - min(a.end, b.end))
            if overlap / shorter < 0.50 and interval_distance > 1.0:
                continue
            score_a = a.conf + min(a.count, 50) / 100.0 + min(len(a.norm), 20) / 1000.0
            score_b = b.conf + min(b.count, 50) / 100.0 + min(len(b.norm), 20) / 1000.0
            drop.add(i if score_a < score_b else j)
    return [event for index, event in enumerate(events) if index not in drop]


def final_events(runs, min_conf, min_occurrences, min_duration, watermark_norms):
    events = []
    for run in runs:
        if run.partial or run.conf < min_conf or not meaningful_text(run.norm):
            continue
        if edge_logo_like(run, watermark_norms):
            continue
        duration = run.end - run.start
        strong_single_cjk = has_cjk(run.norm) and len(run.norm) >= 4 and run.conf >= 0.95
        if run.count < min_occurrences and duration < min_duration and not strong_single_cjk:
            continue
        events.append(run)
    events.sort(key=lambda item: (item.start, item.cy, item.cx, item.text))
    return dedupe(events)


def write_srt(path, events):
    with path.open("w", encoding="utf-8") as handle:
        for index, event in enumerate(events, 1):
            end = max(event.end, event.start + 0.25)
            handle.write(f"{index}\n{srt_time(event.start)} --> {srt_time(end)}\n{event.text}\n\n")


def enumerate_seeked_frames(cap, frame_numbers):
    for frame_no in frame_numbers:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_no))
        ok, frame = cap.read()
        if ok:
            yield int(frame_no), frame


def enumerate_sequential_frames(cap, frame_numbers):
    wanted = set(int(item) for item in frame_numbers)
    if not wanted:
        return
    max_frame = max(wanted)
    current = 0
    while current <= max_frame:
        ok, frame = cap.read()
        if not ok:
            break
        if current in wanted:
            yield current, frame
        current += 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--mode", choices=["every-frame", "interval"], default="interval")
    parser.add_argument("--sample-interval", type=float, default=0.25)
    parser.add_argument("--include-watermark", action="store_true")
    parser.add_argument("--min-conf", type=float, default=0.60)
    parser.add_argument("--progress-every", type=int, default=200)
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(Path(args.video)))
    if not cap.isOpened():
        raise SystemExit(f"ERROR: cannot open video: {args.video}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration = frame_count / fps if frame_count and fps else 0.0
    planned_frames = frame_plan(duration, fps, frame_count, args.mode, args.sample_interval)
    planned_total = len(planned_frames)
    progress_every = max(1, min(max(1, args.progress_every), max(1, planned_total // 50 or 1)))
    ocr = RapidOCR()
    records = []
    processed = 0
    print(f"video={args.video} frames={frame_count} planned={planned_total} fps={fps:.3f} size={width}x{height} mode={args.mode}", flush=True)
    frame_iter = enumerate_sequential_frames(cap, planned_frames) if args.mode == "every-frame" else enumerate_seeked_frames(cap, planned_frames)
    for frame_no, frame in frame_iter:
        result, _ = ocr(frame)
        time_s = frame_no / max(fps, 1.0)
        if result:
            h, w = frame.shape[:2]
            for line in result:
                box, text, conf = line[0], str(line[1] or "").strip(), float(line[2])
                norm = normalize_text(text)
                if not norm:
                    continue
                xs = [point[0] for point in box]
                ys = [point[1] for point in box]
                records.append(
                    {
                        "time": round(time_s, 3),
                        "frame": int(frame_no),
                        "text": text,
                        "norm": norm,
                        "conf": conf,
                        "cx": round(sum(xs) / 4, 1),
                        "cy": round(sum(ys) / 4, 1),
                        "w": w,
                        "h": h,
                    }
                )
        processed += 1
        if processed % progress_every == 0 or processed == planned_total:
            print(f"processed={processed} planned={planned_total} frame={frame_no}/{frame_count} detections={len(records)}", flush=True)
    cap.release()

    filtered = [record for record in records if record["conf"] >= args.min_conf]
    watermark_norms = set() if args.include_watermark else detect_watermarks(filtered, processed, duration)
    if not args.include_watermark:
        filtered = [record for record in filtered if not watermark_match(record["norm"], watermark_norms)]

    runs = build_runs(filtered, fps, args.mode, max(0.05, args.sample_interval))
    absorb_partials(runs)
    events = final_events(runs, args.min_conf, min_occurrences=2, min_duration=0.03, watermark_norms=watermark_norms)
    srt_name = "subtitles.srt"
    write_srt(out_dir / srt_name, events)
    text_lines = []
    seen = set()
    for event in events:
        norm = normalize_text(event.text)
        if norm in seen:
            continue
        seen.add(norm)
        text_lines.append(event.text)
    output = {
        "text": "\n".join(text_lines),
        "subtitles": [
            {
                "start": round(event.start, 3),
                "end": round(max(event.end, event.start + 0.25), 3),
                "text": event.text,
                "confidence": round(event.conf, 4),
                "framesSeen": event.count,
            }
            for event in events
        ],
        "filteredWatermarks": sorted(watermark_norms),
        "processed": processed,
        "plannedTotal": planned_total,
        "detections": len(records),
        "finalEvents": len(events),
        "info": {
            "fps": fps,
            "frameCount": frame_count,
            "width": width,
            "height": height,
            "duration": duration,
        },
        "srtFile": srt_name,
    }
    (out_dir / "result.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"done processed={processed} planned={planned_total} detections={len(records)} final_events={len(events)}", flush=True)
    print(json.dumps(output, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
