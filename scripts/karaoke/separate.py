#!/usr/bin/env python3
"""
Generate karaoke instrumentals from music files using Demucs.

For each input `link.{id}.mp3`, runs htdemucs source separation, sums every stem
except vocals, and writes `link.{id}.instrumental.mp3` next to the original (or into
--out-dir). Idempotent: skips a file whose instrumental already exists unless --force.

Saving goes through soundfile (libsndfile) + ffmpeg rather than torchaudio's saver,
which avoids the torchcodec/torchaudio backend breakage on CPU-only installs.

Usage:
    python3 separate.py FILE [FILE ...]
    python3 separate.py --music-dir /mnt/yteatalk/music --ids 1,100,250
    python3 separate.py --music-dir /mnt/yteatalk/music --all
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile
import time

INSTR_SUFFIX = ".instrumental.mp3"
LINK_RE = re.compile(r"link\.(\d+)\.mp3$")


def instrumental_path(src: str, out_dir: str | None) -> str:
    base = os.path.basename(src)[: -len(".mp3")]  # link.42
    target_dir = out_dir or os.path.dirname(src)
    return os.path.join(target_dir, base + INSTR_SUFFIX)


def probe_duration(path: str) -> float:
    """Seconds, via ffprobe. 0.0 if it can't be determined."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", path],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return float(out)
    except Exception:  # noqa: BLE001
        return 0.0


def encode_mp3(wav_path: str, mp3_path: str, bitrate: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path, "-b:a", bitrate, mp3_path],
        check=True,
    )


def separate_one(model, apply_model, sf, np, torch, src: str, out_dir: str | None,
                 bitrate: str, force: bool) -> str:
    out_path = instrumental_path(src, out_dir)
    if os.path.exists(out_path) and not force:
        print(f"skip  {os.path.basename(src)} (exists)", flush=True)
        return out_path

    from demucs.audio import AudioFile
    sr = model.samplerate
    wav = AudioFile(src).read(streams=0, samplerate=sr, channels=model.audio_channels)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()
    with torch.no_grad():
        out = apply_model(model, wav[None], device="cpu", split=True,
                          overlap=0.25, progress=False)[0]
    out = out * ref.std() + ref.mean()
    instrumental = sum(
        out[i].cpu().numpy().T
        for i, name in enumerate(model.sources)
        if name != "vocals"
    )
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_wav = tmp.name
    try:
        sf.write(tmp_wav, instrumental, sr)
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        encode_mp3(tmp_wav, out_path, bitrate)
    finally:
        os.unlink(tmp_wav)
    return out_path


def collect_inputs(args) -> list[str]:
    files: list[str] = list(args.files)
    if args.music_dir:
        if args.all:
            for name in sorted(os.listdir(args.music_dir)):
                if LINK_RE.search(name) and INSTR_SUFFIX not in name:
                    files.append(os.path.join(args.music_dir, name))
        elif args.ids:
            for sid in args.ids.split(","):
                sid = sid.strip()
                if sid:
                    files.append(os.path.join(args.music_dir, f"link.{sid}.mp3"))
    return [f for f in files if os.path.exists(f)]


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate karaoke instrumentals with Demucs.")
    ap.add_argument("files", nargs="*", help="explicit input mp3 files")
    ap.add_argument("--music-dir", help="directory of link.{id}.mp3 files")
    ap.add_argument("--ids", help="comma-separated ids (with --music-dir)")
    ap.add_argument("--all", action="store_true", help="process every link.*.mp3 in --music-dir")
    ap.add_argument("--out-dir", help="write instrumentals here (default: next to source)")
    ap.add_argument("--bitrate", default="192k", help="output mp3 bitrate (default 192k)")
    ap.add_argument("--max-duration", type=float, default=0,
                    help="skip inputs longer than this many seconds (0 = no limit). "
                         "Long files are usually multi-song rips — pointless for karaoke "
                         "and very slow to process.")
    ap.add_argument("--model", default="htdemucs", help="demucs model (default htdemucs)")
    ap.add_argument("--force", action="store_true", help="re-process even if instrumental exists")
    args = ap.parse_args()

    inputs = collect_inputs(args)
    if not inputs:
        print("No input files found.", file=sys.stderr)
        return 1

    # Filter over-long files (multi-song rips) up front, before loading the model — so a
    # skip-only run doesn't pay for Demucs, and the worklist is clean.
    skipped_long = 0
    if args.max_duration > 0:
        kept = []
        for src in inputs:
            dur = probe_duration(src)
            if dur > args.max_duration:
                print(f"skip  {os.path.basename(src)} (too long: {dur / 60:.1f} min "
                      f"> {args.max_duration / 60:.0f} min cap)", flush=True)
                skipped_long += 1
            else:
                kept.append(src)
        inputs = kept
        if not inputs:
            print(f"Nothing to do: all {skipped_long} input(s) exceed the duration cap.",
                  flush=True)
            return 0

    # Heavy imports only once we know there's work to do.
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    print(f"Loading model {args.model} ...", flush=True)
    model = get_model(args.model)
    model.cpu().eval()

    ok = 0
    for src in inputs:
        t0 = time.time()
        try:
            out = separate_one(model, apply_model, sf, np, torch, src,
                               args.out_dir, args.bitrate, args.force)
            if out:
                print(f"ok    {os.path.basename(src)} -> {os.path.basename(out)} "
                      f"({time.time() - t0:.0f}s)", flush=True)
                ok += 1
        except Exception as e:  # noqa: BLE001 - keep batch going
            print(f"FAIL  {os.path.basename(src)}: {e}", file=sys.stderr, flush=True)

    msg = f"Done: {ok}/{len(inputs)} processed."
    if skipped_long:
        msg += f" Skipped {skipped_long} over-long file(s)."
    print(msg, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
