"""GPU preparation: reclaim an idle-but-occupied GPU before loading the model.

Policy (per user request): if the target GPU has memory occupied but ~0%
utilization (e.g. an idle ComfyUI instance just holding VRAM), stop that
ComfyUI instance so the curation job can run in full bf16 instead of squeezing
in with fp8. If the GPU is actively in use (high utilization), we do NOT
disturb it and fall back to fp8 quantization instead.

Cooperates with the imagen-lab `watch` daemon: the worker marks curation
processes with IS_CURATION_JOB=1 and watch treats them as GPU claimants (see
scripts/imagen-lab.sh), so when watch is running it performs the ComfyUI
stop/restore itself. When watch is NOT running, we stop/restore ComfyUI here.
"""
from __future__ import annotations

import atexit
import os
import socket
import subprocess
import time
from typing import Optional

IMAGEN_ROOT = "/data/workspace/imagen-lab"
SCRIPT = os.path.join(IMAGEN_ROOT, "scripts", "imagen-lab.sh")
RUN_DIR = os.path.join(IMAGEN_ROOT, "run")
COMFY_BASE_PORT = 8188  # GPU0; GPU n => base + 100*n


def physical_index(device: str, log=print) -> Optional[int]:
    """Physical GPU index for nvidia-smi, honoring CUDA_VISIBLE_DEVICES.

    The worker sets CUDA_VISIBLE_DEVICES=<gpu_ids> and passes --device cuda:0,
    so the physical device is the (single) value of CUDA_VISIBLE_DEVICES. If
    unset, derive from the --device string (cuda:N -> N).
    """
    cvd = os.environ.get("CUDA_VISIBLE_DEVICES", "").strip()
    if cvd:
        first = cvd.split(",")[0].strip()
        if first.isdigit():
            return int(first)
    if device and device.startswith("cuda:"):
        tail = device.split(":", 1)[1]
        if tail.isdigit():
            return int(tail)
    return None


def _smi(fields: str, index: int) -> Optional[list[str]]:
    try:
        out = subprocess.run(
            ["nvidia-smi", f"--query-gpu={fields}",
             "--format=csv,noheader,nounits", "-i", str(index)],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode != 0:
            return None
        return [x.strip() for x in out.stdout.strip().split(",")]
    except Exception:  # noqa: BLE001
        return None


def stats(index: int) -> Optional[dict]:
    r = _smi("utilization.gpu,memory.used,memory.total,memory.free", index)
    if not r or len(r) < 4:
        return None
    try:
        return {"util": float(r[0]), "mem_used": float(r[1]),
                "mem_total": float(r[2]), "mem_free": float(r[3])}
    except ValueError:
        return None


def free_mb(index: int) -> float:
    s = stats(index)
    return s["mem_free"] if s else 0.0


def sample_idle(index: int, samples: int = 4, interval: float = 0.6,
                util_max: float = 8.0, mem_used_min: float = 1500.0) -> tuple[bool, float]:
    """Return (is_idle_but_occupied, mem_free). Idle = memory occupied and
    utilization stays at/below util_max across all samples."""
    utils, mem_used, mem_free = [], 0.0, 0.0
    for _ in range(samples):
        s = stats(index)
        if not s:
            return False, mem_free
        utils.append(s["util"])
        mem_used, mem_free = s["mem_used"], s["mem_free"]
        time.sleep(interval)
    idle = mem_used > mem_used_min and all(u <= util_max for u in utils)
    return idle, mem_free


def _port_alive(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def comfy_on_gpu(index: int) -> bool:
    return _port_alive(COMFY_BASE_PORT + 100 * index)


def watch_running() -> bool:
    pidf = os.path.join(RUN_DIR, "watch.pid")
    try:
        with open(pidf) as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)
        return True
    except Exception:  # noqa: BLE001
        return False


def _script(*args: str, log=print) -> bool:
    if not os.path.exists(SCRIPT):
        log(f"[gpu] {SCRIPT} not found; skipping")
        return False
    try:
        subprocess.run([SCRIPT, *args], capture_output=True, text=True, timeout=60)
        return True
    except Exception as e:  # noqa: BLE001
        log(f"[gpu] {SCRIPT} {' '.join(args)} failed: {e}")
        return False


def wait_for_free(index: int, need_mb: float, timeout: float = 45.0, log=print) -> float:
    deadline = time.time() + timeout
    last = free_mb(index)
    while time.time() < deadline:
        last = free_mb(index)
        if last >= need_mb:
            return last
        time.sleep(1.5)
    log(f"[gpu] timeout waiting for {need_mb:.0f}MB free on GPU{index} (have {last:.0f}MB)")
    return last


def prepare(index: Optional[int], need_mb: float = 20000.0, log=print) -> dict:
    """Reclaim GPU `index` if it is idle-but-occupied.

    Returns {"reclaimed": bool, "free_mb": float, "restored_by": "watch"|"self"|None}.
    Registers an atexit restore if we stopped ComfyUI ourselves.
    """
    result = {"reclaimed": False, "free_mb": 0.0, "restore": None}
    if index is None:
        return result
    idle, mem_free = sample_idle(index)
    result["free_mb"] = mem_free
    if mem_free >= need_mb:
        log(f"[gpu] GPU{index} already has {mem_free:.0f}MB free; no reclaim needed")
        return result
    if not idle:
        log(f"[gpu] GPU{index} is actively in use (mem_free {mem_free:.0f}MB); "
            f"will NOT stop it — coexisting via fp8")
        return result
    if not comfy_on_gpu(index):
        log(f"[gpu] GPU{index} idle-occupied but no ComfyUI instance found; leaving as-is")
        return result

    if watch_running():
        # watch will stop ComfyUI for this GPU (curation marked as claimant) and
        # restore it afterward. Just wait for the memory to free.
        log(f"[gpu] GPU{index} idle ComfyUI; watch active → waiting for it to yield")
        result["restore"] = "watch"
    else:
        log(f"[gpu] GPU{index} idle ComfyUI holding VRAM → stopping comfyui:{index}")
        if _script(f"comfyui:{index}", "stop", log=log):
            result["restore"] = "self"

            def _restore():
                log(f"[gpu] restoring comfyui:{index}")
                _script(f"comfyui:{index}", "start", log=log)

            atexit.register(_restore)

    result["free_mb"] = wait_for_free(index, need_mb, log=log)
    result["reclaimed"] = result["free_mb"] >= need_mb
    return result
