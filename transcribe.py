#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WAV Player — 本地 Whisper 转写/翻译桥接脚本

子命令:
  env        输出环境探测结果 (单行 JSON)
  download   把模型快照下载到 config.model_dir
  transcribe 对单个音频做转写/翻译, 写出 .vtt / .srt

用法:
  python transcribe.py env
  python transcribe.py download --config <json>
  python transcribe.py transcribe --config <json>
  (也支持 --config 后跟 '-' 从 stdin 读 JSON)

stdout 输出一条条 JSON 行:
  {"type":"status","message":...,"detail":...}
  {"type":"progress","completed":0.0,"total":0.0,"elapsed":0.0,"percent":0}
  {"type":"segment","start":0.0,"end":0.0,"text":"..."}
  {"type":"done","output":"...","format":"vtt","count":N}
  {"type":"env",...}
  {"type":"error","code":"...","message":"..."}

config 字段(全部可省略):
  audio          str  单个音频绝对路径 (单文件模式)
  audios         list 批量模式: ["a.wav", ...] 或 [{"audio":...,"output":...}]
  model_dir      str  本地 CT2 模型目录, 或 HF repo id
  output         str  输出字幕绝对路径 (默认 audio + ".zh.vtt")
  format         str  "vtt" | "srt" (默认 vtt)
  device         str  "auto"|"cuda"|"cpu" (默认 auto)
  compute_type   str  "auto"|"int8_float16"|"float16"|"int8"|...(默认 auto)
  language       str  源语言 (默认 ja)
  task           str  "translate"|"transcribe" (默认 translate)
  beam_size      int  默认 5
  vad_filter     bool 默认 False
  skip_existing  bool 批量时跳过已存在的字幕 (默认 False)
  allow_download bool 默认 False

批量模式额外事件:
  {"type":"batch","total":N}
  {"type":"file","index":i,"total":N,"audio":...,"name":...,"skipped":bool}
  {"type":"file_done","index":i,"output":...,"count":N,"elapsed":s,"skipped":bool}
  {"type":"file_error","index":i,"audio":...,"message":...}
  {"type":"done","total":N,"ok":..,"failed":..,"skipped":..,"outputs":[...]}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback


def setup_dll_paths() -> None:
    """把 nvidia-cudnn / nvidia-cublas 的运行库目录加入 DLL 搜索路径。
    在导入 ctranslate2/faster-whisper 之前调用, 以便 Windows 找到 cuDNN/cuBLAS。"""
    import os as _os
    import sys as _sys

    added: list[str] = []
    for base in _sys.path:
        if not base or not _os.path.isdir(base):
            continue
        if base.rstrip("\\/").endswith(("Lib", "site-packages", "dist-packages")):
            base = _os.path.join(base, "nvidia")
        for sub in ("cudnn", "cublas", "cuda_nvrtc"):
            cand = _os.path.join(base, sub, "bin")
            if _os.path.isdir(cand):
                added.append(cand)
    for d in added:
        _os.environ["PATH"] = d + _os.pathsep + _os.environ.get("PATH", "")
        try:
            _os.add_dll_directory(d)
        except Exception:
            pass


setup_dll_paths()


def emit(obj: dict) -> None:
    """向 stdout 写一行 JSON 并立即刷新。"""
    try:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def err(msg: str) -> None:
    try:
        sys.stderr.write(msg.rstrip() + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def load_config(path: str | None) -> dict:
    if path == "-":
        raw = sys.stdin.read()
    elif not path:
        return {}
    else:
        if not os.path.exists(path):
            return {}
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()
    if not raw.strip():
        return {}
    try:
        return json.loads(raw) or {}
    except Exception:
        return {}


def env_probe() -> None:
    """探测 Python 环境, 输出单行 env JSON。"""
    info = {
        "type": "env",
        "python": sys.executable,
        "version": sys.version.split()[0],
        "platform": sys.platform,
    }
    missing = []
    try:
        import faster_whisper  # noqa: F401

        info["faster_whisper"] = getattr(faster_whisper, "__version__", "?")
    except Exception as exc:  # noqa: BLE001
        missing.append("faster_whisper")
        info["faster_whisper"] = None
        info["faster_whisper_error"] = str(exc)

    try:
        import ctranslate2  # noqa: F401

        info["ctranslate2"] = getattr(ctranslate2, "__version__", "?")
        try:
            info["cuda_devices"] = int(ctranslate2.get_cuda_device_count())
        except Exception:
            info["cuda_devices"] = 0
        if info["cuda_devices"]:
            try:
                info["compute_types"] = sorted(
                    str(x) for x in ctranslate2.get_supported_compute_types("cuda")
                )
            except Exception:
                info["compute_types"] = []
    except Exception as exc:  # noqa: BLE001
        missing.append("ctranslate2")
        info["ctranslate2"] = None
        info["ctranslate2_error"] = str(exc)

    try:
        import av  # noqa: F401

        info["av"] = getattr(av, "__version__", "?")
    except Exception:  # noqa: BLE001
        missing.append("av")
        info["av"] = None

    try:
        import huggingface_hub  # noqa: F401

        info["huggingface_hub"] = getattr(huggingface_hub, "__version__", "?")
    except Exception:  # noqa: BLE001
        missing.append("huggingface_hub")
        info["huggingface_hub"] = None

    info["missing"] = missing
    info["ok"] = not any(x in missing for x in ("faster_whisper", "ctranslate2"))
    emit(info)


def resolve_device(config: dict, info: dict | None = None) -> tuple[str, str]:
    """返回 (device, compute_type)。尽量使用 GPU, 兼顾 CPU 回退。"""
    requested = str(config.get("device") or "auto").lower()
    cuda_count = 0
    try:
        import ctranslate2  # noqa: F401

        cuda_count = int(ctranslate2.get_cuda_device_count())
    except Exception:
        cuda_count = 0

    if requested in ("cuda", "gpu", "amd", "rocm", "hip"):
        device = "cuda"
    elif requested == "cpu":
        device = "cpu"
    else:  # auto
        device = "cuda" if cuda_count > 0 else "cpu"

    requested_ct = str(config.get("compute_type") or "auto").lower()
    if requested_ct != "auto":
        return device, requested_ct

    if device == "cuda":
        # 8GB 显存用 int8_float16 更稳; 大模型空载也建议 int8_float16
        return device, "int8_float16"
    return device, "int8"


def download_model_to_local(repo_id: str, target: str) -> bool:
    """逐文件下载 HF 模型到 target, 成功返回 True。"""
    try:
        from huggingface_hub import HfApi, hf_hub_download
    except Exception:
        emit({"type": "error", "code": "no_hf", "message": "缺少 huggingface_hub, 无法下载模型"})
        return False

    os.makedirs(target, exist_ok=True)
    emit({"type": "status", "message": "开始下载模型", "detail": repo_id})
    try:
        api = HfApi()
        files = list(api.list_repo_tree(repo_id=repo_id, repo_type="model", recursive=True))
        file_entries = [f for f in files if getattr(f, "type", None) == "file"]
        if not file_entries:
            from huggingface_hub import snapshot_download

            snapshot_download(repo_id=repo_id, local_dir=target)
            emit({"type": "done", "output": target, "format": "model", "count": 0})
            return True
        total_bytes = sum(getattr(f, "size", 0) or 0 for f in file_entries)
        done_bytes = 0
        for f in file_entries:
            rel = getattr(f, "path", "")
            if not rel:
                continue
            try:
                hf_hub_download(repo_id=repo_id, filename=rel, local_dir=target)
            except Exception as exc:  # noqa: BLE001
                emit({"type": "error", "code": "download_failed", "message": f"{rel}: {exc}"})
                return False
            done_bytes += getattr(f, "size", 0) or 0
            percent = int((done_bytes / total_bytes) * 100) if total_bytes else 0
            emit(
                {
                    "type": "progress",
                    "completed": done_bytes,
                    "total": total_bytes,
                    "percent": percent,
                    "what": "download",
                    "file": rel,
                }
            )
        emit({"type": "done", "output": target, "format": "model", "count": len(file_entries)})
        return True
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "code": "download_failed", "message": str(exc)})
        return False


def download_model(config: dict) -> None:
    """下载 HF 模型快照到 config.model_dir (或默认目录)。"""
    repo_id = str(config.get("repo_id") or config.get("model_dir") or "")
    if not repo_id or os.path.isdir(repo_id):
        emit({"type": "error", "code": "bad_repo", "message": "需要提供有效的 HuggingFace repo_id"})
        return

    target = str(config.get("model_dir") or "")
    if not target or target == repo_id:
        target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
        if repo_id and "/" in repo_id:
            target = os.path.join(target, repo_id.split("/")[-1])
    download_model_to_local(repo_id, target)


def _format_ts(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    ms = int(round((seconds - int(seconds)) * 1000))
    secs = int(seconds)
    h, rem = divmod(secs, 3600)
    m, s = divmod(rem, 60)
    if ms >= 1000:
        ms -= 1000
        s += 1
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def write_subtitle(
    segments: list[dict], output: str, fmt: str
) -> int:
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    with open(output, "w", encoding="utf-8", newline="\n") as fh:
        if fmt == "srt":
            for i, seg in enumerate(segments, 1):
                start = _format_ss(seg["start"])
                end = _format_ss(seg["end"])
                text = (seg["text"] or "").strip()
                fh.write(f"{i}\n{start} --> {end}\n{text}\n\n")
        else:
            fh.write("WEBVTT\n\ntranslated by WAV Player (faster-whisper)\n\n")
            for seg in segments:
                start = _format_ts(seg["start"])
                end = _format_ts(seg["end"])
                text = (seg["text"] or "").strip()
                fh.write(f"{start} --> {end}\n{text}\n\n")
    return len(segments)


def _format_ss(seconds: float) -> str:
    # SRT uses commas for milliseconds.
    if seconds < 0:
        seconds = 0
    ms = int(round((seconds - int(seconds)) * 1000))
    secs = int(seconds)
    h, rem = divmod(secs, 3600)
    m, s = divmod(rem, 60)
    if ms >= 1000:
        ms -= 1000
        s += 1
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def default_output(audio: str, fmt: str) -> str:
    return audio + (".zh.vtt" if fmt == "vtt" else ".zh.srt")


def build_jobs(config: dict, fmt: str) -> list[dict]:
    """把 config 归一化成 [{audio, output}]。audios 存在时为批量模式。"""
    jobs: list[dict] = []
    audios = config.get("audios")
    if isinstance(audios, list) and audios:
        for item in audios:
            if isinstance(item, str):
                jobs.append({"audio": item, "output": default_output(item, fmt)})
            elif isinstance(item, dict):
                audio = str(item.get("audio") or item.get("path") or "")
                output = str(item.get("output") or "") or default_output(audio, fmt)
                jobs.append({"audio": audio, "output": output})
    else:
        audio = str(config.get("audio") or "")
        output = str(config.get("output") or "") or default_output(audio, fmt)
        jobs.append({"audio": audio, "output": output})
    return jobs


def resolve_model_dir(config: dict) -> str:
    """解析本地模型目录, 失败返回空串 (并已 emit error)。"""
    model_dir = str(config.get("model_dir") or "")
    allow_download = bool(config.get("allow_download"))
    if os.path.isdir(model_dir):
        return model_dir
    if not model_dir:
        emit({"type": "error", "code": "model_missing", "message": "未指定模型目录"})
        return ""
    repo_id = model_dir
    local_target = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "models", repo_id.split("/")[-1]
    )
    # 离线优先: 若本地已有模型, 直接复用, 不触发网络
    if os.path.isdir(local_target) and os.path.exists(os.path.join(local_target, "model.bin")):
        return local_target
    if allow_download:
        if download_model_to_local(repo_id, local_target):
            return local_target
        return ""
    emit(
        {
            "type": "error",
            "code": "model_missing",
            "message": f"模型目录不存在: {model_dir}。请先下载模型或选择有效目录。",
        }
    )
    return ""


def load_whisper(config: dict):
    """加载模型一次, 返回 (model, device, compute_type)。失败时 model 为 None。"""
    model_dir = resolve_model_dir(config)
    if not model_dir:
        return None, None, None
    device, compute_type = resolve_device(config)
    emit(
        {
            "type": "status",
            "message": "正在加载模型",
            "detail": f"device={device} compute_type={compute_type}",
        }
    )
    try:
        from faster_whisper import WhisperModel
    except Exception:  # noqa: BLE001
        emit(
            {
                "type": "error",
                "code": "no_faster_whisper",
                "message": "缺少 faster-whisper。请在 Python 3.11 环境执行: pip install faster-whisper",
            }
        )
        return None, device, compute_type
    try:
        model = WhisperModel(model_dir, device=device, compute_type=compute_type)
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "code": "load_model", "message": str(exc)})
        return None, device, compute_type
    return model, device, compute_type


def transcribe_file(model, audio, config, output, fmt, index=None, total_files=None):
    """转写单个文件, 返回 {output,count,elapsed}; 失败返回 None。"""
    ctx = {"index": index, "total": total_files} if index is not None else {}
    fail_type = "file_error" if index is not None else "error"
    try:
        segments, info = model.transcribe(
            audio,
            language=(str(config.get("language") or "ja") or None),
            task=str(config.get("task") or "translate"),
            beam_size=int(config.get("beam_size") or 5),
            vad_filter=bool(config.get("vad_filter")),
        )
    except Exception as exc:  # noqa: BLE001
        emit({"type": fail_type, "code": "transcribe", "message": str(exc), "audio": audio, **ctx})
        return None

    total = float(getattr(info, "duration", 0) or 0)
    t0 = time.time()
    collected: list[dict] = []
    last_progress = {"t": t0}
    try:
        for seg in segments:
            start = float(getattr(seg, "start", 0))
            end = float(getattr(seg, "end", 0))
            text = str(getattr(seg, "text", "")).strip()
            collected.append({"start": start, "end": end, "text": text})
            emit({"type": "segment", "start": start, "end": end, "text": text, **ctx})
            now = time.time()
            if now - last_progress["t"] >= 0.15:
                last_progress["t"] = now
                percent = int((end / total) * 100) if total else 0
                emit(
                    {
                        "type": "progress",
                        "completed": end,
                        "total": total,
                        "elapsed": round(now - t0, 2),
                        "percent": percent,
                        **ctx,
                    }
                )
    except Exception as exc:  # noqa: BLE001
        emit({"type": fail_type, "code": "transcribe_iter", "message": str(exc), "audio": audio, **ctx})
        return None

    count = write_subtitle(collected, output, fmt)
    return {"output": output, "count": count, "elapsed": round(time.time() - t0, 2)}


def transcribe(config: dict) -> None:
    fmt = str(config.get("format") or "vtt").lower()
    if fmt not in ("vtt", "srt"):
        emit({"type": "error", "code": "bad_format", "message": "format 仅支持 vtt / srt"})
        return

    batch = isinstance(config.get("audios"), list) and bool(config.get("audios"))
    jobs = build_jobs(config, fmt)
    if not jobs or not any(j["audio"] for j in jobs):
        emit({"type": "error", "code": "bad_audio", "message": "没有要转写的音频文件"})
        return

    model, device, compute_type = load_whisper(config)
    if model is None:
        return

    emit(
        {
            "type": "status",
            "message": "模型已加载, 开始转写",
            "detail": f"{len(jobs)} 个文件" if batch else jobs[0]["audio"],
        }
    )
    if batch:
        emit({"type": "batch", "total": len(jobs)})

    skip_existing = bool(config.get("skip_existing"))
    t_all = time.time()
    ok = failed = skipped = 0
    outputs: list[str] = []
    results: list[dict] = []

    for i, job in enumerate(jobs):
        audio = job["audio"]
        output = job["output"]
        name = os.path.basename(audio) if audio else ""
        if not audio or not os.path.exists(audio):
            failed += 1
            emit({"type": "file_error", "index": i, "total": len(jobs), "audio": audio, "name": name, "message": "音频文件不存在"})
            continue
        skip = skip_existing and os.path.exists(output)
        if batch:
            emit({"type": "file", "index": i, "total": len(jobs), "audio": audio, "name": name, "skipped": skip})
        if skip:
            skipped += 1
            if batch:
                emit({"type": "file_done", "index": i, "output": output, "count": 0, "skipped": True, "elapsed": 0})
            continue
        res = transcribe_file(
            model,
            audio,
            config,
            output,
            fmt,
            index=(i if batch else None),
            total_files=(len(jobs) if batch else None),
        )
        if res is None:
            failed += 1
            continue
        ok += 1
        outputs.append(res["output"])
        results.append(res)
        if batch:
            emit(
                {
                    "type": "file_done",
                    "index": i,
                    "output": res["output"],
                    "count": res["count"],
                    "elapsed": res["elapsed"],
                    "skipped": False,
                }
            )

    elapsed = round(time.time() - t_all, 2)
    if batch:
        emit(
            {
                "type": "done",
                "total": len(jobs),
                "ok": ok,
                "failed": failed,
                "skipped": skipped,
                "outputs": outputs,
                "format": fmt,
                "elapsed": elapsed,
                "device": device,
                "compute_type": compute_type,
            }
        )
    elif results:
        # 单文件: 保持与旧版一致的字段
        last = results[-1]
        emit(
            {
                "type": "done",
                "output": last["output"],
                "format": fmt,
                "count": last["count"],
                "elapsed": last["elapsed"],
                "device": device,
                "compute_type": compute_type,
            }
        )


def main() -> int:
    parser = argparse.ArgumentParser(prog="wav-player-transcribe")
    parser.add_argument("command", choices=["env", "download", "transcribe"])
    parser.add_argument("--config", default=None)
    parser.add_argument("--repo-id", default=None)
    parser.add_argument("--model-dir", default=None)
    parser.add_argument("--output", default=None)
    parser.add_argument("--audio", default=None)
    parser.add_argument("--device", default=None)
    parser.add_argument("--compute-type", default=None)
    parser.add_argument("--format", default=None)
    args = parser.parse_args()

    config = load_config(args.config)
    if args.repo_id:
        config["repo_id"] = args.repo_id
    if args.model_dir:
        config["model_dir"] = args.model_dir
    if args.output:
        config["output"] = args.output
    if args.audio:
        config["audio"] = args.audio
    if args.device:
        config["device"] = args.device
    if args.compute_type:
        config["compute_type"] = args.compute_type
    if args.format:
        config["format"] = args.format

    try:
        if args.command == "env":
            env_probe()
        elif args.command == "download":
            download_model(config)
        elif args.command == "transcribe":
            transcribe(config)
    except KeyboardInterrupt:
        emit({"type": "error", "code": "cancelled", "message": "已取消"})
    except Exception:  # noqa: BLE001
        emit({"type": "error", "code": "unhandled", "message": traceback.format_exc(limit=5)})
        err(traceback.format_exc())
    return 0


if __name__ == "__main__":
    sys.exit(main())
