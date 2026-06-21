"""업로드 추적 — 메타 기록 + 파일 저장(관리자 열람용).

- 메타는 events.db(analytics.upload_record), 파일 바이트는 datadir.uploads_dir() 에 저장.
- 업로더는 **익명화**: 원시 IP 를 저장하지 않고 IP+UA+날짜 단방향 해시(visitor)만 남긴다.
- 보관기간(retention) 초과분은 analytics.cleanup_old_uploads 로 자동 삭제.
- 실패해도 silent — 업로드/추출 본 흐름을 절대 막지 않는다.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from cgr import datadir
from cgr.web.admin.store import analytics


def anon_visitor(request: Any | None) -> str:
    """익명 방문자 해시 — 원시 IP 저장 안 함(IP+UA+날짜 salt 단방향 해시 16자)."""
    ip = ua = ""
    try:
        if request is not None:
            client = getattr(request, "client", None)
            ip = getattr(client, "host", "") or ""
            ua = request.headers.get("user-agent", "") or ""
    except Exception:
        pass
    day = datetime.now().strftime("%Y%m%d")
    raw = f"{ip}|{ua}|{day}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def record_upload(
    *,
    content: bytes,
    filename: str,
    mime: str,
    service: str,
    request: Any | None = None,
    case_id: str | None = None,
) -> None:
    """업로드 1건 기록(메타 + 파일 저장). 절대 예외를 밖으로 던지지 않는다."""
    try:
        ext = (Path(filename or "").suffix.lower().lstrip(".")) or "bin"
        uid = uuid.uuid4().hex
        stored = ""
        try:
            dest = datadir.uploads_dir() / f"{uid}.{ext}"
            dest.write_bytes(content or b"")
            stored = str(dest)
        except Exception:
            stored = ""
        analytics.add_upload(
            service=service,
            filename=filename or "",
            size=len(content or b""),
            mime=mime or "",
            ext=ext,
            visitor=anon_visitor(request),
            case_id=case_id,
            stored_path=stored,
        )
    except Exception:
        pass
