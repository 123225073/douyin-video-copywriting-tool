#!/usr/bin/env python
import argparse
import json
import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    from faster_whisper import WhisperModel
except Exception as exc:
    print(f"ERROR: missing faster-whisper: {exc}", file=sys.stderr)
    sys.exit(2)


MODEL_ALIASES = {
    "": "Systran/faster-whisper-small",
    "local": "Systran/faster-whisper-small",
    "whisper-1": "Systran/faster-whisper-small",
    "tiny": "Systran/faster-whisper-tiny",
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
}


def normalize_model(name):
    raw = str(name or "").strip()
    return MODEL_ALIASES.get(raw.lower(), raw)


def clean_text(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def srt_time(seconds):
    ms = int(round(float(seconds or 0) * 1000))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(path, segments):
    lines = []
    for index, segment in enumerate(segments, start=1):
        text = clean_text(segment.get("text", ""))
        if not text:
            continue
        lines.extend([
            str(index),
            f"{srt_time(segment.get('start', 0))} --> {srt_time(segment.get('end', 0))}",
            text,
            "",
        ])
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("media")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", default="Systran/faster-whisper-small")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--no-vad", action="store_true")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()

    media_path = Path(args.media)
    if not media_path.exists():
        raise SystemExit(f"ERROR: media file not found: {media_path}")

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model_name = normalize_model(args.model)

    model = WhisperModel(
        model_name,
        device=args.device,
        compute_type=args.compute_type,
        local_files_only=args.offline,
    )
    segments_iter, info = model.transcribe(
        str(media_path),
        language=args.language or None,
        beam_size=max(1, args.beam_size),
        vad_filter=not args.no_vad,
        vad_parameters={"min_silence_duration_ms": 500},
    )

    segments = []
    for segment in segments_iter:
        text = clean_text(segment.text)
        if not text:
            continue
        segments.append({
            "start": float(segment.start or 0),
            "end": float(segment.end or 0),
            "text": text,
        })

    transcript = "\n".join(item["text"] for item in segments).strip()
    (out_dir / "transcript.txt").write_text(transcript, encoding="utf-8")
    write_srt(out_dir / "subtitles.srt", segments)

    result = {
        "text": transcript,
        "segments": segments,
        "segmentCount": len(segments),
        "model": model_name,
        "language": getattr(info, "language", None),
        "languageProbability": getattr(info, "language_probability", None),
        "duration": getattr(info, "duration", None),
        "srtFile": "subtitles.srt",
        "textFile": "transcript.txt",
    }
    (out_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
