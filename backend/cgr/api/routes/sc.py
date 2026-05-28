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
