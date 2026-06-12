"""취업규칙 근로환경 1차 분류 라우트 — /review/classify/*.

review.py 와 같은 '/review' prefix 를 쓰지만 파일을 분리 — 분류는 검토
파이프라인과 독립적인 보조 기능이고, EC 의 /ec/classify/* 와 동일한
start+poll 비동기 잡 패턴을 따른다 (Vercel 60s 한도 우회).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from cgr.api import jobs
from cgr.api.auth import require_api_key
from cgr import wr_classify as wr_classify_service

router = APIRouter(prefix="/review", tags=["review"])


class JobStartOut(BaseModel):
    job_id: str = Field(..., description="폴링에 사용할 작업 ID")


class WrClassifyIn(BaseModel):
    extracted_text: str = Field(..., description="추출된 취업규칙 텍스트")


class WrClassifyResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    shift_work_used: bool | None = None
    osha_applicable: bool | None = None
    chemical_handling: bool | None = None
    workenv_measurement: bool | None = None
    doc_kind: str | None = None
    reason: str | None = None
    error: str | None = None
    elapsed_sec: float = 0.0


@router.post(
    "/classify/start",
    response_model=JobStartOut,
    summary="비동기 분류 시작 — 취업규칙 근로환경 AI 판별",
    dependencies=[Depends(require_api_key)],
)
def post_wr_classify_start(body: WrClassifyIn):
    text = body.extracted_text

    def _do() -> dict[str, Any]:
        return wr_classify_service.run(text)

    return JobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/classify/result/{job_id}",
    response_model=WrClassifyResultOut,
    summary="비동기 분류 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_wr_classify_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="분류 작업을 찾을 수 없어요. 다시 시도해 주세요.",
        )
    r = job["result"] or {}
    return WrClassifyResultOut(
        status=job["status"],
        shift_work_used=r.get("shift_work_used"),
        osha_applicable=r.get("osha_applicable"),
        chemical_handling=r.get("chemical_handling"),
        workenv_measurement=r.get("workenv_measurement"),
        doc_kind=r.get("doc_kind"),
        reason=r.get("reason"),
        error=job["error"],
        elapsed_sec=job["elapsed"],
    )
