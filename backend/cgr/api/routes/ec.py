"""근로계약서 풀 이식 — 4단계 API.

기존 `1. 근로계약서/기존/server/routes/{ocr,analysis}.js` 을 옮긴 것.
각 단계가 독립 호출 가능하도록 4개 엔드포인트로 분리:

  1. POST /api/v1/ec/extract  — file (이미지·docx 등) → 텍스트
  2. POST /api/v1/ec/structure — text → 8섹션 JSON
  3. POST /api/v1/ec/analyze   — JSON + 사용자 컨텍스트 → 33매핑 분석
  4. POST /api/v1/ec/generate  — 분석 결과 → 표준 근로계약서 텍스트

기존 `POST /api/v1/review` (document_type=employment_contract) 은 legacy 로 유지.
"""
from __future__ import annotations

import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from cgr.api.auth import require_api_key
from cgr.api import jobs
from cgr.config import get_llm_model
from cgr.docx_export import DOCX_MIMETYPE, text_to_docx
from cgr.ec.services import analyze as analyze_service
from cgr.ec.services import chat as chat_service
from cgr.ec.services import generate as generate_service
from cgr.ec.services import structure as structure_service
from cgr.parsers.dispatcher import parse_to_text


router = APIRouter(prefix="/ec", tags=["employment_contract"])


# ─────────────────────────────────────────────
# 1) POST /api/v1/ec/extract
# ─────────────────────────────────────────────
class ExtractOut(BaseModel):
    """OCR/파일 추출 응답."""

    extracted_text: str
    filename: str
    elapsed_sec: float
    model: str


@router.post(
    "/extract",
    response_model=ExtractOut,
    summary="근로계약서 파일 → 텍스트 추출 (OCR 포함)",
    description=(
        "이미지(PNG/JPG 등)는 `cgr/parsers/image.py` Vision OCR 로,\n"
        "DOCX·HWP·PDF·TXT 는 기존 파서로 텍스트 추출.\n"
        "다음 단계(`/ec/structure`) 의 입력이 됩니다."
    ),
    dependencies=[Depends(require_api_key)],
)
async def post_extract(
    file: UploadFile = File(..., description="검토 대상 근로계약서 파일"),
):
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
# 2) POST /api/v1/ec/structure
# ─────────────────────────────────────────────
class StructureIn(BaseModel):
    extracted_text: str = Field(..., description="`/ec/extract` 의 응답에서 받은 텍스트")


class StructureOut(BaseModel):
    structured_data: dict[str, Any] = Field(
        ...,
        description="8섹션(기본정보/계약사항/근로시간/휴일휴가/임금/퇴직급여/사회보험/계약체결) + 기타사항",
    )
    elapsed_sec: float
    model: str


@router.post(
    "/structure",
    response_model=StructureOut,
    summary="OCR 텍스트 → 8섹션 구조화 JSON",
    description=(
        "Step2 검토 페이지의 입력 데이터. 사용자는 표 UI 에서 행 단위로 value/note 를 수정 후\n"
        "`/ec/analyze` 로 보낸다."
    ),
    dependencies=[Depends(require_api_key)],
)
def post_structure(body: StructureIn):
    t0 = time.time()
    try:
        data = structure_service.run(body.extracted_text)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"구조화 실패: {type(e).__name__}: {e}",
        )
    return StructureOut(
        structured_data=data,
        elapsed_sec=round(time.time() - t0, 2),
        model=get_llm_model(),
    )


# ─────────────────────────────────────────────
# 3) POST /api/v1/ec/analyze
# ─────────────────────────────────────────────
class AnalyzeIn(BaseModel):
    structured_data: dict[str, Any] = Field(
        ..., description="Step2 에서 사용자가 검토·수정 완료한 8섹션 dict"
    )
    business_size: str = Field(default="", description="5인이상 / 5인미만 / (빈 문자열)")
    worker_types: list[str] = Field(
        default_factory=list,
        description="정규직 / 기간제 / 단시간 / 일용직 / 연소자 / 외국인 / 외국인(농축어업)",
    )
    legal_guidelines: str = Field(
        default="",
        description="(선택) RAG 검색으로 채울 상세 가이드라인. 추후 단계에서 자동 주입.",
    )


class AnalyzeOut(BaseModel):
    analysis_result: dict[str, Any] = Field(
        ...,
        description=(
            "기존 prompts.json 의 analysis 출력 스키마. "
            "`{riskLevel, overallStatus, overallOpinion, results[], finalRecommendations}`"
        ),
    )
    elapsed_sec: float
    model: str


@router.post(
    "/analyze",
    response_model=AnalyzeOut,
    summary="구조화 데이터 + 컨텍스트 → 33매핑 위반 분석",
    dependencies=[Depends(require_api_key)],
)
def post_analyze(body: AnalyzeIn):
    t0 = time.time()
    try:
        result = analyze_service.run(
            body.structured_data,
            business_size=body.business_size,
            worker_types=body.worker_types,
            legal_guidelines=body.legal_guidelines,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"분석 실패: {type(e).__name__}: {e}",
        )
    return AnalyzeOut(
        analysis_result=result,
        elapsed_sec=round(time.time() - t0, 2),
        model=get_llm_model(),
    )


# ─────────────────────────────────────────────
# 3-b) 비동기 분석 — 게이트웨이 타임아웃 우회 (start + poll)
#
#   POST /api/v1/ec/analyze/start      → {job_id} 즉시 반환, 백그라운드 분석
#   GET  /api/v1/ec/analyze/result/{j} → {status, analysis_result, ...} 폴링
#
# 동기 /analyze 는 하위호환·로컬용으로 유지. 프론트는 start+poll 을 사용.
# ─────────────────────────────────────────────
class JobStartOut(BaseModel):
    job_id: str


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
            business_size=body.business_size,
            worker_types=body.worker_types,
            legal_guidelines=body.legal_guidelines,
        )

    job_id = jobs.start_job(_do)
    return JobStartOut(job_id=job_id)


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
# 4) POST /api/v1/ec/generate
# ─────────────────────────────────────────────
class GenerateIn(BaseModel):
    analysis_result: dict[str, Any] = Field(
        ..., description="`/ec/analyze` 의 응답 dict 전체"
    )
    user_overrides: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "사용자가 결과 페이지에서 SuggestBlock 을 통해 직접 작성한 보완 표현. "
            "항목명 → 본인 입력 텍스트. LLM 에게 '그대로 사용' 으로 강조 전달."
        ),
    )


class GenerateOut(BaseModel):
    contract_text: str
    elapsed_sec: float
    model: str


@router.post(
    "/generate",
    response_model=GenerateOut,
    summary="분석 결과 → 표준 근로계약서 텍스트",
    dependencies=[Depends(require_api_key)],
)
def post_generate(body: GenerateIn):
    t0 = time.time()
    try:
        text = generate_service.run(
            body.analysis_result,
            user_overrides=body.user_overrides or None,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"계약서 생성 실패: {type(e).__name__}: {e}",
        )
    return GenerateOut(
        contract_text=text,
        elapsed_sec=round(time.time() - t0, 2),
        model=get_llm_model(),
    )


# ─────────────────────────────────────────────
# 4-c) 비동기 계약서 생성 — start + poll (analyze 와 동일 패턴)
# ─────────────────────────────────────────────
class GenerateResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    contract_text: str | None = None
    error: str | None = None
    elapsed_sec: float = 0.0
    model: str = ""


@router.post(
    "/generate/start",
    response_model=JobStartOut,
    summary="비동기 계약서 생성 시작 — job_id 반환",
    dependencies=[Depends(require_api_key)],
)
def post_generate_start(body: GenerateIn):
    def _do() -> str:
        return generate_service.run(
            body.analysis_result,
            user_overrides=body.user_overrides or None,
        )

    job_id = jobs.start_job(_do)
    return JobStartOut(job_id=job_id)


@router.get(
    "/generate/result/{job_id}",
    response_model=GenerateResultOut,
    summary="비동기 계약서 생성 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_generate_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="생성 작업을 찾을 수 없어요. 다시 시도해 주세요.",
        )
    return GenerateResultOut(
        status=job["status"],
        contract_text=job["result"],
        error=job["error"],
        elapsed_sec=job["elapsed"],
        model=get_llm_model(),
    )


# ─────────────────────────────────────────────
# 4-b) POST /api/v1/ec/generate-docx — 표준 계약서 .docx 다운로드
# ─────────────────────────────────────────────
class GenerateDocxIn(BaseModel):
    contract_text: str = Field(
        ..., description="이미 생성된 본문 (혹은 사용자가 편집한 내용)"
    )
    filename: str = Field(
        default="표준_근로계약서.docx",
        description="다운로드 파일명",
    )


@router.post(
    "/generate-docx",
    summary="평문 본문 → .docx 변환·다운로드",
    description="사용자가 편집한 계약서 본문을 .docx 로 변환. 한글 폰트·A4·표준 양식.",
    dependencies=[Depends(require_api_key)],
    response_class=Response,
)
def post_generate_docx(body: GenerateDocxIn):
    try:
        docx_bytes = text_to_docx(
            body.contract_text,
            title="표준 근로계약서",
            subtitle="영세사업장 자율점검 서비스 — AI 기반 시정안 반영",
            footer_note=(
                "※ 본 문서는 AI 자율점검 결과를 반영한 표준안입니다. "
                "법적 효력은 사업장·노무사 검토 후 확정됩니다."
            ),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"docx 변환 실패: {type(e).__name__}: {e}",
        )
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


# ─────────────────────────────────────────────
# 5) POST /api/v1/ec/chat — 대화형 챗봇 (SFR-001)
# ─────────────────────────────────────────────
class ChatHistoryTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatIn(BaseModel):
    message: str = Field(..., description="사용자 질문 (자연어)")
    analysis_result: dict[str, Any] | None = Field(
        default=None,
        description="현재 사용자가 보고 있는 분석 결과 (있으면 컨텍스트로 활용)",
    )
    focused_item: str | None = Field(
        default=None,
        description="사용자가 캐러셀에서 보고 있는 항목명 (예: '임금')",
    )
    history: list[ChatHistoryTurn] = Field(
        default_factory=list,
        description="이전 대화 (role/content). 최근 6턴까지만 활용.",
    )


class ChatOut(BaseModel):
    answer: str
    elapsed_sec: float
    model: str


@router.post(
    "/chat",
    response_model=ChatOut,
    summary="근로계약서 검토 결과 기반 대화형 후속 질문",
    description=(
        "사용자가 결과 페이지에서 본 항목에 대해 자연어로 후속 질문을 던지면,\n"
        "분석 결과 + 이전 대화 + 사용자가 본 항목을 컨텍스트로 LLM 이 답변."
    ),
    dependencies=[Depends(require_api_key)],
)
def post_chat(body: ChatIn):
    t0 = time.time()
    try:
        answer = chat_service.run(
            body.message,
            analysis_result=body.analysis_result,
            focused_item=body.focused_item,
            history=[
                {"role": h.role, "content": h.content} for h in body.history
            ],
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"챗봇 호출 실패: {type(e).__name__}: {e}",
        )
    return ChatOut(
        answer=answer,
        elapsed_sec=round(time.time() - t0, 2),
        model=get_llm_model(),
    )
