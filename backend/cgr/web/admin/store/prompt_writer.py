"""시스템 프롬프트 저장소 — extractor/explainer 외부 프롬프트 파일.

저장 위치: data/prompts/{extractor,explainer}.md
- 파일 존재 시: cgr.extractor / cgr.explainer 가 우선 사용
- 파일 없음/빈 파일: 모듈 내장 _SYSTEM_PROMPT 사용 (기본값)

저장 시:
  1. 백업: backups/<ts>_prompt_<name>/<name>.md
  2. 원자적 쓰기: tmp → os.replace
  3. LLM 캐시 자동 무효화 (SHA256 키가 system prompt 포함이라 변경 시 cache miss)
"""
from __future__ import annotations

import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Literal

PromptName = Literal["extractor", "explainer"]


def _project_root() -> Path:
    return Path(__file__).resolve().parents[4]


def prompt_path(name: PromptName) -> Path:
    d = _project_root() / "data" / "prompts"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{name}.md"


def load_current(name: PromptName) -> str:
    """현재 외부 파일 내용 (있으면). 없으면 모듈 내장 기본값."""
    p = prompt_path(name)
    if p.exists():
        try:
            return p.read_text(encoding="utf-8")
        except Exception:
            pass
    return load_default(name)


def load_default(name: PromptName) -> str:
    """모듈 내장 기본 프롬프트 (롤백 비교용)."""
    if name == "extractor":
        from cgr.extractor import _SYSTEM_PROMPT
        return _SYSTEM_PROMPT
    elif name == "explainer":
        from cgr.explainer import _SYSTEM_PROMPT
        return _SYSTEM_PROMPT
    raise ValueError(f"unknown prompt name: {name}")


def save(name: PromptName, content: str, backup: bool = True) -> Path | None:
    """프롬프트 저장 + 자동 백업.

    Returns: backup_dir 경로 (백업 미실행 시 None)
    """
    target = prompt_path(name)
    backup_dir = None
    if backup and target.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = _project_root() / "backups" / f"{ts}_prompt_{name}"
        backup_dir.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(target, backup_dir / target.name)
        except Exception:
            pass

    # 원자적 쓰기
    tmp = target.with_suffix(".md.tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, target)
    return backup_dir


def reset_to_default(name: PromptName) -> Path | None:
    """외부 프롬프트 파일 제거 (모듈 기본값으로 복귀). 삭제 전 백업."""
    target = prompt_path(name)
    if not target.exists():
        return None
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = _project_root() / "backups" / f"{ts}_prompt_{name}_reset"
    backup_dir.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(target, backup_dir / target.name)
    except Exception:
        pass
    target.unlink()
    return backup_dir


def stats() -> dict:
    """전체 프롬프트 메타 정보 (편집 페이지·랜딩 KPI 용)."""
    out = {}
    for name in ("extractor", "explainer"):
        p = prompt_path(name)
        if p.exists():
            content = p.read_text(encoding="utf-8")
            out[name] = {
                "exists": True,
                "chars": len(content),
                "lines": content.count("\n") + 1,
                "mtime": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds"),
                "diverged": content != load_default(name),
            }
        else:
            default = load_default(name)
            out[name] = {
                "exists": False,
                "chars": len(default),
                "lines": default.count("\n") + 1,
                "mtime": None,
                "diverged": False,
            }
    return out
