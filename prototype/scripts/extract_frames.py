#!/usr/bin/env python
import argparse
import json
import math
import sys
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


def frame_plan(duration, fps, frame_count, mode, interval):
    if mode == "every-frame":
        total = frame_count or int(duration * fps)
        return [index / max(fps, 1.0) for index in range(max(0, total))]
    step = max(0.05, float(interval or 0.25))
    times = []
    at = 0.0
    while at < duration:
        times.append(at)
        at += step
    if duration and (not times or times[-1] < duration - 0.2):
        times.append(max(0.0, duration - 0.001))
    return times


def mask_watermarks(frame):
    h, w = frame.shape[:2]
    color = (6, 10, 12)
    regions = [
        (0, 0, int(w * 0.34), int(h * 0.18)),
        (int(w * 0.66), 0, w, int(h * 0.14)),
        (int(w * 0.72), int(h * 0.82), w, h),
    ]
    for x1, y1, x2, y2 in regions:
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness=-1)
    return frame


def write_jpeg(path, frame, quality=76):
    ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        return False
    buffer.tofile(str(path))
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--mode", choices=["every-frame", "interval"], default="interval")
    parser.add_argument("--sample-interval", type=float, default=0.25)
    parser.add_argument("--max-preview", type=int, default=240)
    parser.add_argument("--strip-watermark", action="store_true")
    args = parser.parse_args()

    video_path = Path(args.video)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise SystemExit(f"ERROR: cannot open video: {video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration = frame_count / fps if frame_count and fps else 0.0
    planned = frame_plan(duration, fps, frame_count, args.mode, args.sample_interval)
    total_planned = len(planned)

    if total_planned > args.max_preview:
        step = math.ceil(total_planned / max(1, args.max_preview))
        preview_times = planned[::step][: args.max_preview]
    else:
        preview_times = planned

    frames = []
    for index, time_s in enumerate(preview_times):
        target_frame = max(0, min(frame_count - 1 if frame_count else 10**12, int(round(time_s * fps))))
        cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
        ok, frame = cap.read()
        if not ok:
            continue
        if args.strip_watermark:
            frame = mask_watermarks(frame)
        max_width = 720
        h, w = frame.shape[:2]
        if w > max_width:
            next_h = int(h * (max_width / w))
            frame = cv2.resize(frame, (max_width, next_h), interpolation=cv2.INTER_AREA)
        filename = f"frame_{index + 1:04d}.jpg"
        if write_jpeg(out_dir / filename, frame):
            frames.append({"time": target_frame / fps, "frame": target_frame, "fileName": filename})

    cap.release()
    result = {
        "mode": args.mode,
        "sampleInterval": args.sample_interval,
        "plannedCount": total_planned,
        "previewCount": len(frames),
        "previewLimited": total_planned > len(frames),
        "fps": fps,
        "frameCount": frame_count,
        "width": width,
        "height": height,
        "duration": duration,
        "frames": frames,
    }
    (out_dir / "frames.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
