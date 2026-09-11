#!/usr/bin/env python3
"""Discover, inspect, and dispatch karaoke work across direct-SSH GPU workers."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import shlex
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from music_library import library

HERE = Path(__file__).resolve().parent
SERVERS_FILE = Path(os.environ.get("KARAOKE_GPU_SERVERS_FILE", HERE / "gpu-servers.json"))
WORKER_FILE = HERE / "gpu_worker.py"
REMOTE_DIR = os.environ.get("KARAOKE_GPU_REMOTE_DIR", "/home/mli/karaoke_gpu")
REMOTE_PYTHON = f"{REMOTE_DIR}/venv/bin/python"
CONNECT_TIMEOUT = int(os.environ.get("KARAOKE_GPU_CONNECT_TIMEOUT", "8"))
JOB_TIMEOUT = int(os.environ.get("KARAOKE_GPU_JOB_TIMEOUT", "21600"))
KNOWN_HOSTS = Path(os.environ.get("KARAOKE_GPU_KNOWN_HOSTS", "/home/mli/.ssh/karaoke_gpu_known_hosts"))
CATALOG_SCRIPT = Path(
    os.environ.get("KARAOKE_SERVER_LIST_SCRIPT", "/home/mli/micsapp-webterminal/list-servers.sh")
)
HOST_RE = re.compile(r"^[a-zA-Z0-9.-]+$")


@dataclass
class WorkerStatus:
    host: str
    reachable: bool = False
    gpu: str | None = None
    memory_mb: int | None = None
    ready: bool = False
    detail: str = ""


def ssh_base() -> list[str]:
    KNOWN_HOSTS.parent.mkdir(parents=True, exist_ok=True)
    KNOWN_HOSTS.touch(mode=0o600, exist_ok=True)
    return [
        "ssh", "-o", "BatchMode=yes", "-o", f"ConnectTimeout={CONNECT_TIMEOUT}",
        "-o", "StrictHostKeyChecking=accept-new", "-o", f"UserKnownHostsFile={KNOWN_HOSTS}",
    ]


def scp_base() -> list[str]:
    return [
        "scp", "-q", "-o", "BatchMode=yes", "-o", f"ConnectTimeout={CONNECT_TIMEOUT}",
        "-o", "StrictHostKeyChecking=accept-new", "-o", f"UserKnownHostsFile={KNOWN_HOSTS}",
    ]


def load_hosts() -> list[str]:
    if not SERVERS_FILE.is_file():
        raise RuntimeError(f"GPU server list not found: {SERVERS_FILE}")
    document = json.loads(SERVERS_FILE.read_text())
    hosts: list[str] = []
    for host in document.get("servers", []):
        if not isinstance(host, str) or not HOST_RE.fullmatch(host):
            raise RuntimeError(f"invalid SSH hostname in {SERVERS_FILE}: {host}")
        if host not in hosts:
            hosts.append(host)
    if not hosts:
        raise RuntimeError(f"GPU server list is empty: {SERVERS_FILE}")
    return hosts


PROBE_COMMAND = f"""
smi=$(command -v nvidia-smi 2>/dev/null || true)
[ -z "$smi" ] && [ -x /usr/lib/wsl/lib/nvidia-smi ] && smi=/usr/lib/wsl/lib/nvidia-smi
[ -n "$smi" ] || {{ printf 'NO_GPU'; exit 0; }}
gpu=$($smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
[ -n "$gpu" ] || {{ printf 'NO_GPU'; exit 0; }}
name=${{gpu%,*}}
memory=${{gpu##*,}}
ready=no
detail='worker environment missing'
if [ -x {REMOTE_PYTHON} ] && command -v ffmpeg >/dev/null && command -v curl >/dev/null; then
  if (cd /tmp && {REMOTE_PYTHON} -c 'import torch, demucs, soundfile; raise SystemExit(0 if torch.cuda.is_available() else 1)') >/dev/null 2>&1; then
    ready=yes
    detail=ready
  else
    detail='CUDA Python dependencies unavailable'
  fi
fi
printf 'GPU|%s|%s|%s|%s' "$name" "$memory" "$ready" "$detail"
""".strip()


def probe_host(host: str) -> WorkerStatus:
    try:
        result = subprocess.run(
            [*ssh_base(), host, PROBE_COMMAND],
            capture_output=True,
            text=True,
            timeout=CONNECT_TIMEOUT + 12,
        )
    except subprocess.TimeoutExpired:
        return WorkerStatus(host=host, detail="SSH probe timed out")
    except OSError as error:
        return WorkerStatus(host=host, detail=str(error))
    output = result.stdout.strip()
    if result.returncode != 0:
        return WorkerStatus(host=host, detail=result.stderr.strip() or f"SSH exited {result.returncode}")
    if output == "NO_GPU":
        return WorkerStatus(host=host, reachable=True, detail="no NVIDIA GPU")
    fields = output.split("|", 4)
    if len(fields) != 5 or fields[0] != "GPU":
        return WorkerStatus(host=host, reachable=True, detail=f"invalid probe response: {output[:120]}")
    try:
        memory = int(fields[2].strip())
    except ValueError:
        memory = None
    return WorkerStatus(
        host=host,
        reachable=True,
        gpu=fields[1].strip(),
        memory_mb=memory,
        ready=fields[3] == "yes",
        detail=fields[4].strip(),
    )


def statuses(hosts: list[str] | None = None) -> list[WorkerStatus]:
    selected = hosts or load_hosts()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(selected)) as executor:
        return list(executor.map(probe_host, selected))


def discover_tunnel_hosts() -> list[str]:
    if not CATALOG_SCRIPT.is_file():
        raise RuntimeError(f"server catalog script not found: {CATALOG_SCRIPT}")
    result = subprocess.run(
        [str(CATALOG_SCRIPT), "--json"], capture_output=True, text=True, timeout=20, check=True
    )
    document = json.loads(result.stdout)
    hosts = []
    for server in document.get("servers", []):
        host = server.get("ssh_hostname", "")
        if server.get("enabled", True) and server.get("ssh_mode") == "tunnel" and HOST_RE.fullmatch(host):
            hosts.append(host)
    return list(dict.fromkeys(hosts))


def sync_worker(host: str) -> None:
    remote_temp = f"{REMOTE_DIR}/.gpu_worker.py.{os.getpid()}"
    subprocess.run(
        [*ssh_base(), host, f"mkdir -p {REMOTE_DIR}/out"],
        check=True,
        timeout=CONNECT_TIMEOUT + 10,
    )
    subprocess.run(
        [*scp_base(), str(WORKER_FILE), f"{host}:{remote_temp}"],
        check=True,
        timeout=CONNECT_TIMEOUT + 30,
    )
    subprocess.run(
        [*ssh_base(), host, f"mv {remote_temp} {REMOTE_DIR}/gpu_worker.py"],
        check=True,
        timeout=CONNECT_TIMEOUT + 10,
    )


def validate_audio(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size <= 0:
        return False
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
            "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "audio"


def assignments(ids: list[int], workers: list[WorkerStatus]) -> dict[str, list[int]]:
    allocated = {worker.host: [] for worker in workers}
    for index, song_id in enumerate(ids):
        allocated[workers[index % len(workers)].host].append(song_id)
    return {host: values for host, values in allocated.items() if values}


def run_remote_job(host: str, ids: list[int]) -> tuple[str, int, str]:
    imported_ids = ','.join(str(sid) for sid in ids if sid in library.imported)
    environment = {
        'KARAOKE_IMPORTED_IDS': imported_ids,
        'KARAOKE_SOURCE_URL': os.environ.get('KARAOKE_SOURCE_URL', 'https://music.micstec.com/data'),
        'KARAOKE_IMPORT_URL': os.environ.get('KARAOKE_IMPORT_URL', 'https://music.micstec.com/api/dig/files'),
    }
    assignments = ' '.join(f'{key}={shlex.quote(value)}' for key, value in environment.items())
    command = f"cd {REMOTE_DIR} && {assignments} {REMOTE_PYTHON} gpu_worker.py {' '.join(map(str, ids))}"
    result = subprocess.run(
        [*ssh_base(), host, command], capture_output=True, text=True, timeout=JOB_TIMEOUT
    )
    log = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part.strip())
    return host, result.returncode, log


def dispatch(ids: list[int], output_dir: Path) -> None:
    worker_statuses = statuses()
    ready = [worker for worker in worker_statuses if worker.ready]
    if not ready:
        details = "; ".join(f"{worker.host}: {worker.detail}" for worker in worker_statuses)
        raise RuntimeError(f"no ready GPU workers ({details})")
    print("ready GPU workers:")
    for worker in ready:
        print(f"  {worker.host}: {worker.gpu} ({worker.memory_mb} MiB)")
        sync_worker(worker.host)

    work = assignments(ids, ready)
    for host, song_ids in work.items():
        print(f"assign {host}: {' '.join(map(str, song_ids))}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(work)) as executor:
        futures = [executor.submit(run_remote_job, host, song_ids) for host, song_ids in work.items()]
        remote_results = [future.result() for future in concurrent.futures.as_completed(futures)]
    failed_hosts = []
    for host, returncode, log in sorted(remote_results):
        print(f"[{host}]")
        if log:
            print(log)
        if returncode != 0:
            failed_hosts.append(host)
    if failed_hosts:
        raise RuntimeError(f"GPU jobs failed on: {', '.join(failed_hosts)}")

    output_dir.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".gpu-pool-", dir=output_dir))
    try:
        for host, song_ids in work.items():
            for song_id in song_ids:
                target = stage / f"link.{song_id}.instrumental.mp3"
                subprocess.run(
                    [*scp_base(), f"{host}:{REMOTE_DIR}/out/link.{song_id}.instrumental.mp3", str(target)],
                    check=True,
                    timeout=CONNECT_TIMEOUT + 180,
                )
                if not validate_audio(target):
                    raise RuntimeError(f"invalid audio returned by {host} for song {song_id}")
        for song_id in ids:
            source = stage / f"link.{song_id}.instrumental.mp3"
            os.replace(source, output_dir / source.name)
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def parse_ids(values: list[str]) -> list[int]:
    ids = []
    for value in values:
        if not value.isdigit() or int(value) <= 0:
            raise RuntimeError(f"invalid song id: {value}")
        song_id = int(value)
        if song_id not in ids:
            ids.append(song_id)
    if not ids:
        raise RuntimeError("provide at least one song id")
    return ids


def print_status(worker_statuses: list[WorkerStatus], as_json: bool) -> None:
    if as_json:
        print(json.dumps([asdict(worker) for worker in worker_statuses], separators=(",", ":")))
        return
    for worker in worker_statuses:
        marker = "ready" if worker.ready else "unavailable"
        print(f"{worker.host}\t{marker}\t{worker.gpu or 'no GPU'}\t{worker.detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    status_parser = subparsers.add_parser("status", help="probe configured GPU workers")
    status_parser.add_argument("--json", action="store_true")
    status_parser.add_argument("--require-ready", action="store_true")
    discover_parser = subparsers.add_parser("discover", help="scan tunnel endpoints from list-servers.sh")
    discover_parser.add_argument("--json", action="store_true")
    discover_parser.add_argument("--write", action="store_true", help="replace gpu-servers.json")
    plan_parser = subparsers.add_parser("plan", help="show assignments without running jobs")
    plan_parser.add_argument("ids", nargs="+")
    dispatch_parser = subparsers.add_parser("dispatch", help="run and collect instrumental jobs")
    dispatch_parser.add_argument("--output-dir", required=True, type=Path)
    dispatch_parser.add_argument("ids", nargs="+")
    args = parser.parse_args()

    try:
        if args.command == "status":
            worker_statuses = statuses()
            print_status(worker_statuses, args.json)
            return 1 if args.require_ready and not any(worker.ready for worker in worker_statuses) else 0
        if args.command == "discover":
            worker_statuses = [worker for worker in statuses(discover_tunnel_hosts()) if worker.gpu]
            print_status(worker_statuses, args.json)
            if args.write:
                temporary = SERVERS_FILE.with_suffix(".tmp")
                temporary.write_text(json.dumps({"servers": [worker.host for worker in worker_statuses]}, indent=2) + "\n")
                os.replace(temporary, SERVERS_FILE)
            return 0
        ids = parse_ids(args.ids)
        if args.command == "plan":
            worker_statuses = [worker for worker in statuses() if worker.ready]
            if not worker_statuses:
                raise RuntimeError("no ready GPU workers")
            print(json.dumps(assignments(ids, worker_statuses), indent=2))
            return 0
        dispatch(ids, args.output_dir)
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
