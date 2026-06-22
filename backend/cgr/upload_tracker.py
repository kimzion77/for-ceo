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


# 허용 업로드 확장자 — 지원 문서·이미지만 (시큐어코딩: 입력 데이터 검증)
ALLOWED_UPLOAD_EXTS = {
    "png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp", "heic", "heif",
    "pdf", "docx", "doc", "hwp", "hwpx", "txt",
}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB (운영 리버스프록시의 client_max_body_size 와 함께)


def validate_upload(filename: str, content: bytes) -> None:
    """업로드 파일 검증 — 빈/과대/허용외 형식 거부. 위반 시 HTTPException 발생."""
    from fastapi import HTTPException

    size = len(content or b"")
    if size == 0:
        raise HTTPException(status_code=400, detail="빈 파일은 업로드할 수 없어요.")
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"파일이 너무 큽니다 (최대 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB).",
        )
    ext = Path(filename or "").suffix.lower().lstrip(".")
    if ext and ext not in ALLOWED_UPLOAD_EXTS:
        raise HTTPException(
            status_code=400, detail=f"허용되지 않은 파일 형식이에요 (.{ext})."
        )


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
