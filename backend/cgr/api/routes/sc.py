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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from cgr.api.auth import require_api_key
from cgr.api import jobs
from cgr.config import get_llm_model
from cgr.parsers.dispatcher import parse_to_text
from cgr.sc.services import analyze as analyze_service
from cgr.sc.services import structure as structure_service


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
async def post_extract(file: UploadFile = File(...)):
    t0 = time.time()
    suffix = Path(file.filename or "upload.bin").suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        content = await file.read()
        tf.write(content)
        tmp_path = Path(tf.name)
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
        except Exception:
            pass

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
async def post_extract_start(file: UploadFile = File(...)):
    suffix = Path(file.filename or "upload.bin").suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(await file.read())
        tmp_path = Path(tf.name)
    filename = file.filename or ""

    def _do() -> dict[str, str]:
        try:
            return {"extracted_text": parse_to_text(tmp_path), "filename": filename}
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass

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
