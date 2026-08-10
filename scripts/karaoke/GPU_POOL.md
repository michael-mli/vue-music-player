# Distributed karaoke GPU pool

Admin ingest uses direct SSH rather than the Web Terminal API. The confirmed NVIDIA
tunnel endpoints are stored in `gpu-servers.json`. `gpu_pool.py` probes them concurrently,
uses workers whose `~/karaoke_gpu/venv` contains CUDA-enabled torch, Demucs, and
SoundFile, distributes song IDs round-robin, and validates every returned file with
`ffprobe` before atomically publishing any of the batch.

```bash
# Re-scan only enabled tunnel endpoints returned by list-servers.sh
python3 gpu_pool.py discover

# Show configured GPU hardware and worker readiness
python3 gpu_pool.py status

# Preview assignment without running jobs
python3 gpu_pool.py plan 1400 1401 1402 1403

# Dispatch, validate, and collect results
python3 gpu_pool.py dispatch \
  --output-dir /var/www/html/others/music/karaoke \
  1400 1401
```

`discover --write` replaces `gpu-servers.json` with the enabled tunnel endpoints that
respond with an NVIDIA GPU. Direct-mode catalog entries are never scanned.

Each listed GPU host needs a CUDA-capable environment at `~/karaoke_gpu/venv`. The
dispatcher copies the tracked `gpu_worker.py` to every ready host before each job so the
worker logic stays synchronized. Hosts without the environment remain visible in status
output but do not receive work.
