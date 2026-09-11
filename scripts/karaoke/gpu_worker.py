#!/usr/bin/env python3
"""Run Demucs for one or more song IDs on a single CUDA worker."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.audio import AudioFile
from demucs.pretrained import get_model

URL_BASE = os.environ.get("KARAOKE_SOURCE_URL", "https://music.micstec.com/data").rstrip("/")
IMPORT_URL = os.environ.get("KARAOKE_IMPORT_URL", "https://music.micstec.com/api/dig/files").rstrip("/")
IMPORTED_IDS = {int(value) for value in os.environ.get('KARAOKE_IMPORTED_IDS', '').split(',') if value.isdigit()}
OUT_DIR = Path(os.environ.get("KARAOKE_GPU_OUT", "~/karaoke_gpu/out")).expanduser()
MAX_DURATION = int(os.environ.get("KARAOKE_MAX_DURATION", "600"))
OUT_DIR.mkdir(parents=True, exist_ok=True)


def probe_duration(path: Path) -> float:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True,
            text=True,
            check=True,
        )
        return float(result.stdout.strip())
    except (OSError, subprocess.CalledProcessError, ValueError):
        return 0.0


def valid_audio(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0 and probe_duration(path) > 0


def parse_ids(args: list[str]) -> list[int]:
    ids: list[int] = []
    for value in args:
        if value.isdigit() and int(value) > 0:
            ids.append(int(value))
        else:
            raise ValueError(f"invalid song id: {value}")
    return list(dict.fromkeys(ids))


def main() -> int:
    try:
        ids = parse_ids(sys.argv[1:])
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    if not ids:
        print("ERROR: provide at least one song id", file=sys.stderr)
        return 2
    if not torch.cuda.is_available():
        print("ERROR: CUDA is not available", file=sys.stderr)
        return 1

    pending: list[int] = []
    for song_id in ids:
        output = OUT_DIR / f"link.{song_id}.instrumental.mp3"
        if valid_audio(output):
            print(f"skip {song_id} valid output exists", flush=True)
        else:
            if output.exists():
                output.unlink()
            pending.append(song_id)
    if not pending:
        print(f"BATCH_DONE ok=0 skipped={len(ids)} failed=0", flush=True)
        return 0

    device_name = torch.cuda.get_device_name(0)
    print(f"loading model on {device_name} for {len(pending)} ids", flush=True)
    model = get_model("htdemucs")
    model.to("cuda").eval()
    sample_rate = model.samplerate

    completed = failed = 0
    for song_id in pending:
        started = time.time()
        output = OUT_DIR / f"link.{song_id}.instrumental.mp3"
        source = Path(tempfile.gettempdir()) / f"karaoke-src-{song_id}-{os.getpid()}.mp3"
        wave_path = source.with_suffix(".wav")
        try:
            base = IMPORT_URL if song_id in IMPORTED_IDS else URL_BASE
            subprocess.run(
                [
                    "curl", "-sfL", "--retry", "3", "--retry-delay", "2", "--max-time", "120",
                    "-A", "Mozilla/5.0", "-o", str(source), f"{base}/link.{song_id}.mp3",
                ],
                check=True,
            )
            duration = probe_duration(source)
            if duration <= 0:
                raise RuntimeError("download is not valid audio")
            if MAX_DURATION > 0 and duration > MAX_DURATION:
                raise RuntimeError(f"duration {duration:.1f}s exceeds limit {MAX_DURATION}s")

            waveform = AudioFile(str(source)).read(
                streams=0, samplerate=sample_rate, channels=model.audio_channels
            )
            reference = waveform.mean(0)
            deviation = reference.std()
            if not torch.isfinite(deviation) or deviation <= 0:
                raise RuntimeError("source audio has no usable signal")
            waveform = (waveform - reference.mean()) / deviation
            with torch.no_grad():
                stems = apply_model(
                    model, waveform[None], device="cuda", split=True, overlap=0.25, progress=False
                )[0]
            stems = stems * deviation + reference.mean()
            instrumental = sum(
                stems[index].cpu().numpy().T
                for index, name in enumerate(model.sources)
                if name != "vocals"
            )
            sf.write(wave_path, instrumental, sample_rate)
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wave_path), "-b:a", "192k", str(output)],
                check=True,
            )
            if not valid_audio(output):
                raise RuntimeError("encoded output failed audio validation")
            print(f"ok {song_id} {time.time() - started:.1f}s", flush=True)
            completed += 1
        except Exception as error:
            output.unlink(missing_ok=True)
            print(f"FAIL {song_id} {type(error).__name__}: {error}", flush=True)
            failed += 1
        finally:
            source.unlink(missing_ok=True)
            wave_path.unlink(missing_ok=True)

    print(f"BATCH_DONE ok={completed} skipped={len(ids) - len(pending)} failed={failed}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
