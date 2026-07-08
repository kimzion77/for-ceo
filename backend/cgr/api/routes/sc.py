"""노무제공자 계약서 (Service Provider Contract) — 3 단계 API.

Phase 17 신설. EC 와 거의 동일 패턴이며 검토 슬롯은 4 섹션·16 슬롯.

  1. POST /api/v1/sc/extract   — 파일 → 텍스트 (OCR/파서 공유)
  2. POST /api/v1/sc/structure — 텍스트 → 4섹션·16슬롯 JSON
  3. POST /api/v1/sc/analyze   — JSON + 컨텍스트 → 슬롯별 위반 분석
"""
from __future__ import annotations

import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status

from cgr import upload_tracker
from fastapi.responses import Response
from pydantic import BaseModel, Field

from cgr.api.auth import require_api_key
from cgr.api import jobs
from cgr import revise
from cgr.config import get_llm_model
from cgr.docx_export import DOCX_MIMETYPE, text_to_docx
from cgr.parsers.dispatcher import parse_to_text
from cgr.sc.services import analyze as analyze_service
from cgr.sc.services import structure as structure_service


from cgr.log import bind_context, get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/sc", tags=["service_provider_contract"])


# ─────────────────────────────────────────────
# 1) POST /api/v1/sc/extract
# ─────────────────────────────────────────────
class ExtractOut(BaseModel):
    extracted_text: str
    filename: str
    elapsed_sec: float
    model: str


@router.post(
    "/extract",
    response_model=ExtractOut,
    summary="노무제공자 계약서 파일 → 텍스트 추출 (OCR 포함)",
    dependencies=[Depends(require_api_key)],
)
async def post_extract(request: Request, file: UploadFile = File(...)):
    t0 = time.time()
    content = await file.read()
    upload_tracker.validate_upload(file.filename or "", content)
    suffix = Path(file.filename or "upload.bin").suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(content)
        tmp_path = Path(tf.name)
    upload_tracker.record_upload(
        content=content,
        filename=file.filename or "",
        mime=file.content_type or "",
        service="노무계약서",
        request=request,
    )
    try:
        try:
            text = parse_to_text(tmp_path)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"텍스트 추출 실패: {type(e).__name__}: {e}",
            )
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception as e:
            log.warning("무시된 예외 — %s: %s", type(e).__name__, e)

    return ExtractOut(
        extracted_text=text,
        filename=file.filename or "",
        elapsed_sec=round(time.time() - t0, 2),
        model=get_llm_model(),
    )


# ── 1-b) 비동기 추출 — start + poll (게이트웨이 타임아웃 우회) ──
class JobStartOut(BaseModel):
    job_id: str


class ExtractResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    extracted_text: str | None = None
    filename: str = ""
    error: str | None = None
    elapsed_sec: float = 0.0
    model: str = ""


@router.post(
    "/extract/start",
    response_model=JobStartOut,
    summary="비동기 추출 시작 — job_id 반환",
    dependencies=[Depends(require_api_key)],
)
async def post_extract_start(
    request: Request,
    file: UploadFile = File(...),
    case_id: str = Form(default=""),
    service: str = Form(default="노무계약서"),
):
    bind_context(case=case_id)  # 로그 상관 — 이후 이 요청·잡의 모든 로그에 case 부착
    content = await file.read()
    upload_tracker.validate_upload(file.filename or "", content)
    suffix = Path(file.filename or "upload.bin").suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(content)
        tmp_path = Path(tf.name)
    filename = file.filename or ""
    # 원본 파일 보관 — 관리자 업로드 기록에서 직접 열람·다운로드 (case_id 로 연결)
    if case_id:
        upload_tracker.record_upload(
            content=content,
            filename=filename,
            mime=file.content_type or "",
            service=service or "노무계약서",
            request=request,
            case_id=case_id,
        )

    def _do() -> dict[str, str]:
        try:
            return {"extracted_text": parse_to_text(tmp_path), "filename": filename}
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception as e:
                log.warning("무시된 예외 — %s: %s", type(e).__name__, e)

    return JobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/extract/result/{job_id}",
    response_model=ExtractResultOut,
    summary="비동기 추출 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_extract_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="추출 작업을 찾을 수 없어요. 다시 시도해 주세요.",
        )
    r = job["result"] or {}
    return ExtractResultOut(
        status=job["status"],
        extracted_text=r.get("extracted_text"),
        filename=r.get("filename", ""),
        error=job["error"],
        elapsed_sec=job["elapsed"],
        model=get_llm_model(),
    )


# ─────────────────────────────────────────────
# 2) POST /api/v1/sc/structure
# ─────────────────────────────────────────────
class StructureIn(BaseModel):
    extracted_text: str = Field(..., description="`/sc/extract` 의 응답에서 받은 텍스트")


class StructureOut(BaseModel):
    structured_data: dict[str, Any] = Field(
        ...,
        description="4섹션(당사자정보/계약기본/보수및사회보험/보호및분쟁) + 기타사항",
    )
    elapsed_sec: float
    model: str


@router.post(
    "/structure",
    response_model=StructureOut,
    summary="OCR 텍스트 → 4섹션·16슬롯 구조화 JSON",
    dependencies=[Depends(require_api_key)],
)
def post_structure(body: StructureIn):
    t0 = time.time()
    try:
        data = structure_service.run(body.extracted_text)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"SC 구조화 실패: {type(e).__name__}: {e}",
        )
    return StructureOut(
        structured_data=data,
        elapsed_sec=round(time.time() - t0, 2),
        model=get_llm_model(),
    )


# ── 2-b) 비동기 구조화 — start + poll (LLM 호출이라 느릴 수 있음) ──
class StructureResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    structured_data: dict[str, Any] | None = None
    error: str | None = None
    elapsed_sec: float = 0.0
    model: str = ""


@router.post(
    "/structure/start",
    response_model=JobStartOut,
    summary="비동기 구조화 시작 — job_id 반환",
    dependencies=[Depends(require_api_key)],
)
def post_structure_start(body: StructureIn):
    text = body.extracted_text

    def _do() -> dict[str, Any]:
        return structure_service.run(text)

    return JobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/structure/result/{job_id}",
    response_model=StructureResultOut,
    summary="비동기 구조화 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_structure_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="구조화 작업을 찾을 수 없어요. 다시 시도해 주세요.",
        )
    return StructureResultOut(
        status=job["status"],
        structured_data=job["result"],
        error=job["error"],
        elapsed_sec=job["elapsed"],
        model=get_llm_model(),
    )


# ─────────────────────────────────────────────
# 3) POST /api/v1/sc/analyze
# ─────────────────────────────────────────────
class AnalyzeIn(BaseModel):
    structured_data: dict[str, Any] = Field(
        ..., description="Step2 사용자 검토·수정 완료된 4섹션 dict"
    )
    worker_subtype: str = Field(
        default="",
        description=(
            "산재적용_특고16 / 고용보험_노무제공자19 / 플랫폼종사자 / 기타_도급 "
            "— 빈 문자열이면 LLM 이 적용직종 슬롯 값을 보고 판단"
        ),
    )
    business_size: str = Field(default="", description="(선택) 5인이상 / 5인미만")


class AnalyzeOut(BaseModel):
    analysis_result: dict[str, Any] = Field(
        ...,
        description=(
            "{riskLevel, overallStatus, overallOpinion, results[], finalRecommendations}"
        ),
    )
    elapsed_sec: float
    model: str


@router.post(
    "/analyze",
    response_model=AnalyzeOut,
    summary="구조화 데이터 + 컨텍스트 → 16 슬롯 위반 분석",
    dependencies=[Depends(require_api_key)],
)
def post_analyze(body: AnalyzeIn):
    t0 = time.time()
    try:
        result = analyze_service.run(
            body.structured_data,
            worker_subtype=body.worker_subtype,
            business_size=body.business_size,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"SC 분석 실패: {type(e).__name__}: {e}",
        )
    return AnalyzeOut(
        analysis_result=result,
        elapsed_sec=round(time.time() - t0, 2),
        model=get_llm_model(),
    )


# ─────────────────────────────────────────────
# 3-b) 비동기 분석 — start + poll (게이트웨이 타임아웃 우회)
#
#   POST /api/v1/sc/analyze/start      → {job_id} 즉시 반환, 백그라운드 분석
#   GET  /api/v1/sc/analyze/result/{j} → {status, analysis_result, ...} 폴링
#
# 동기 /analyze 는 하위호환·로컬용으로 유지. 프론트는 start+poll 을 사용.
# ─────────────────────────────────────────────
class AnalyzeResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    analysis_result: dict[str, Any] | None = None
    error: str | None = None
    elapsed_sec: float = 0.0
    model: str = ""


@router.post(
    "/analyze/start",
    response_model=JobStartOut,
    summary="비동기 분석 시작 — job_id 반환",
    dependencies=[Depends(require_api_key)],
)
def post_analyze_start(body: AnalyzeIn):
    # 클로저로 입력 캡처 — 스레드에서 실행
    def _do() -> dict[str, Any]:
        return analyze_service.run(
            body.structured_data,
            worker_subtype=body.worker_subtype,
            business_size=body.business_size,
        )

    return JobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/analyze/result/{job_id}",
    response_model=AnalyzeResultOut,
    summary="비동기 분석 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_analyze_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="분석 작업을 찾을 수 없어요. 작업이 만료됐거나 서버가 재시작됐을 수 있어요. 다시 시도해 주세요.",
        )
    return AnalyzeResultOut(
        status=job["status"],
        analysis_result=job["result"],
        error=job["error"],
        elapsed_sec=job["elapsed"],
        model=get_llm_model(),
    )


# ─────────────────────────────────────────────
# 4) 수정본 생성 — 원문 보존 + 사용자 수정 목록만 반영 (start + poll)
#
#   POST /api/v1/sc/generate/start       → {job_id} 즉시 반환, 백그라운드 생성
#   GET  /api/v1/sc/generate/result/{j}  → {status, revised_text, ...} 폴링
#   POST /api/v1/sc/generate-docx        → 본문 → .docx 다운로드
#
# 철학: 문제없는 내용은 두고, 사용자가 담은 수정 항목만 교체·추가해 전문 출력.
# ─────────────────────────────────────────────
class CorrectionIn(BaseModel):
    name: str = Field(..., description="항목명 (예: 보수, 산재보험)")
    now: str = Field(default="", description="현재 표현 (원문 발견 내용)")
    fix: str = Field(..., description="수정 문구 (사용자 확정 표현)")


class GenerateIn(BaseModel):
    original_text: str = Field(..., description="추출된 계약서 원문 전체")
    corrections: list[CorrectionIn] = Field(
        ..., description="사용자가 수정본에 담은 항목 목록"
    )


class GenerateResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    revised_text: str | None = None
    error: str | None = None
    elapsed_sec: float = 0.0
    model: str = ""


from functools import lru_cache  # noqa: E402

_SC_SLOTS_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "slots" / "atomic_slots_sc.yaml"
)


_STANDARD_SC_PATH = (
    Path(__file__).resolve().parents[3]
    / "data"
    / "standards"
    / "공통표준계약서_2023.txt"
)


@lru_cache(maxsize=1)
def _load_standard_sc() -> str | None:
    """노무제공자 계약서 수정본 생성의 준용 기준.

    1순위: 고용노동부 「공통 표준계약서」(2023.12) 전문 — data/standards/.
       특고·플랫폼종사자·프리랜서 등 노무제공자와 사업주 간 계약의 공식
       표준 양식 (법적 의무는 아니나 공정계약 권고 기준).
    2순위(폴백): 슬롯 카탈로그(atomic_slots_sc.yaml)의 필수 기재 기준 합성.
    """
    try:
        text = _STANDARD_SC_PATH.read_text(encoding="utf-8").strip()
        if text:
            return text
    except Exception as e:
        log.warning("무시된 예외 — %s: %s", type(e).__name__, e)
    # 폴백 — 슬롯 카탈로그 합성
    try:
        import yaml

        data = yaml.safe_load(_SC_SLOTS_PATH.read_text(encoding="utf-8"))
        lines: list[str] = [
            "고용노동부 권고 표준 노무제공계약서 기재 기준 (슬롯 카탈로그 준거)"
        ]
        for s in data.get("slots") or []:
            field = str(s.get("field") or "").strip()
            req = str(s.get("required_content") or "").strip()
            fix = str(s.get("fix_example") or "").strip()
            if not field:
                continue
            line = f"■ {field}: {req}"
            if fix:
                line += f"\n  표준 문구 예시: {fix}"
            lines.append(line)
        return "\n".join(lines) if len(lines) > 1 else None
    except Exception as e:
        log.warning("실패 — None 반환: %s: %s", type(e).__name__, e)
        return None


@router.post(
    "/generate/start",
    response_model=JobStartOut,
    summary="비동기 수정본 생성 시작 — job_id 반환",
    description=(
        "원문은 그대로 유지하고, 사용자가 담은 수정 항목만 반영한 "
        "'노무제공자 계약서 수정본' 전문을 생성합니다."
    ),
    dependencies=[Depends(require_api_key)],
)
def post_generate_start(body: GenerateIn):
    original_text = body.original_text
    corrections = [c.model_dump() for c in body.corrections]
    standard = _load_standard_sc()

    def _do() -> str:
        return revise.run(
            "노무제공자 계약서", original_text, corrections, standard_text=standard
        )

    return JobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/generate/result/{job_id}",
    response_model=GenerateResultOut,
    summary="비동기 수정본 생성 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_generate_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="생성 작업을 찾을 수 없어요. 작업이 만료됐거나 서버가 재시작됐을 수 있어요. 다시 시도해 주세요.",
        )
    return GenerateResultOut(
        status=job["status"],
        revised_text=job["result"],
        error=job["error"],
        elapsed_sec=job["elapsed"],
        model=get_llm_model(),
    )


class GenerateDocxIn(BaseModel):
    contract_text: str = Field(
        ..., description="이미 생성된 수정본 본문 (혹은 사용자가 편집한 내용)"
    )
    filename: str = Field(
        default="노무제공자_계약서_수정본.docx",
        description="다운로드 파일명 (Content-Disposition)",
    )


@router.post(
    "/generate-docx",
    summary="수정본 본문 → .docx 변환·다운로드",
    description="수정본 본문을 .docx 로 변환. 한글 폰트(맑은 고딕)·A4·표준 여백.",
    dependencies=[Depends(require_api_key)],
    response_class=Response,
)
def post_generate_docx(body: GenerateDocxIn):
    try:
        docx_bytes = text_to_docx(
            body.contract_text,
            title="노무제공자 계약서 수정본",
            subtitle="영세사업장 자율점검 서비스 — 사용자 확정 수정안 반영",
            footer_note=(
                "※ 본 문서는 AI 자율점검 결과를 반영한 수정본입니다. "
                "법적 효력은 사업장·노무사 검토 후 확정됩니다."
            ),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"docx 변환 실패: {type(e).__name__}: {e}",
        )
    # 한글 파일명 — RFC 6266 (filename*=UTF-8) 방식
    from urllib.parse import quote

    fname_quoted = quote(body.filename, safe="")
    headers = {
        "Content-Disposition": (
            f"attachment; filename=\"document.docx\"; "
            f"filename*=UTF-8''{fname_quoted}"
        ),
    }
    return Response(
        content=docx_bytes,
        media_type=DOCX_MIMETYPE,
        headers=headers,
    )
