"""임금명세서(wage statement) API.

  1. POST /api/v1/ws/extract — 파일 → 텍스트
  2. POST /api/v1/ws/analyze — 텍스트 + 컨텍스트 → 11개 슬롯 위반 분석
  3. GET  /api/v1/ws/catalog — 슬롯 카탈로그 (디버그/관리자용)

EC 와 달리 structure(8섹션 구조화)·generate(표준 문서) 단계는 1차 미포함.
임금명세서는 표 구조가 단순하고, 사용자가 "필수 항목 누락 여부" 만 빠르게 확인하는 게 핵심.
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
from cgr.config import get_llm_model
from cgr.docx_export import DOCX_MIMETYPE, payslip_form_to_docx, text_to_docx
from cgr.parsers.dispatcher import parse_to_text
from cgr.ws import repository as ws_repo
from cgr.ws.catalog import load_ws_catalog
from cgr.ws.models import InspectionResult, PayslipIn
from cgr.ws.services import analyze as analyze_service
from cgr.ws.services import generate as generate_service
from cgr.ws.services import rule_engine


router = APIRouter(prefix="/ws", tags=["wage_statement"])


# ─────────────────────────────────────────────
# 1) POST /api/v1/ws/extract
# ─────────────────────────────────────────────
class ExtractOut(BaseModel):
    extracted_text: str
    filename: str
    elapsed_sec: float
    model: str


@router.post(
    "/extract",
    response_model=ExtractOut,
    summary="임금명세서 파일 → 텍스트 추출 (OCR 포함)",
    description=(
        "이미지(PNG/JPG)는 Vision OCR, PDF·DOCX·HWP·TXT 는 공용 파서.\n"
        "다음 단계 `/ws/analyze` 의 입력이 됩니다."
    ),
    dependencies=[Depends(require_api_key)],
)
async def post_extract(
    request: Request,
    file: UploadFile = File(..., description="임금명세서 파일"),
):
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
        service="임금명세서",
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
async def post_extract_start(
    request: Request,
    file: UploadFile = File(...),
    case_id: str = Form(default=""),
):
    content = await file.read()
    upload_tracker.validate_upload(file.filename or "", content)
    suffix = Path(file.filename or "upload.bin").suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(content)
        tmp_path = Path(tf.name)
    filename = file.filename or ""
    # 원본 파일 보관 — 관리자가 검토 로그에서 직접 열람·다운로드 (case_id 로 연결)
    if case_id:
        upload_tracker.record_upload(
            content=content,
            filename=filename,
            mime=file.content_type or "",
            service="임금명세서",
            request=request,
            case_id=case_id,
        )

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
# 1-c) 비동기 분류 — AI 1차 계약 유형 판별 (사용자는 분석 전 확인만)
# ─────────────────────────────────────────────
class ClassifyIn(BaseModel):
    extracted_text: str = Field(..., description="추출된 임금명세서 텍스트")


class ClassifyResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    contract_type: str | None = None
    pay_period_year: int | None = None
    pay_period_month: int | None = None
    pay_cycle: str | None = None
    weekly_hours: int | None = None
    doc_kind: str | None = None
    reason: str | None = None
    error: str | None = None
    elapsed_sec: float = 0.0


@router.post(
    "/classify/start",
    response_model=JobStartOut,
    summary="비동기 분류 시작 — 계약 유형 AI 판별",
    dependencies=[Depends(require_api_key)],
)
def post_classify_start(body: ClassifyIn):
    from cgr import ws_classify as ws_classify_service

    text = body.extracted_text

    def _do() -> dict[str, Any]:
        return ws_classify_service.run(text)

    return JobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/classify/result/{job_id}",
    response_model=ClassifyResultOut,
    summary="비동기 분류 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_classify_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="분류 작업을 찾을 수 없어요. 다시 시도해 주세요.",
        )
    r = job["result"] or {}
    return ClassifyResultOut(
        status=job["status"],
        contract_type=r.get("contract_type"),
        pay_period_year=r.get("pay_period_year"),
        pay_period_month=r.get("pay_period_month"),
        pay_cycle=r.get("pay_cycle"),
        weekly_hours=r.get("weekly_hours"),
        doc_kind=r.get("doc_kind"),
        reason=r.get("reason"),
        error=job["error"],
        elapsed_sec=job["elapsed"],
    )


# ─────────────────────────────────────────────
# 2) POST /api/v1/ws/analyze
# ─────────────────────────────────────────────
class AnalyzeIn(BaseModel):
    wage_text: str = Field(
        ..., description="임금명세서 원문 (extract 응답 또는 사용자 직접 붙여넣기)"
    )
    business_size: str = Field(default="", description="5인이상 / 5인미만")
    worker_types: list[str] = Field(
        default_factory=list,
        description="정규직 / 기간제 / 단시간 / 일용직 / 연소자 / 외국인",
    )
    pay_period_year: int | None = Field(
        default=None,
        description=(
            "산정 대상 연도 — 최저임금 기준 (없으면 LLM 이 텍스트에서 추론)"
        ),
    )
    pay_period_month: int | None = Field(
        default=None,
        description="산정 대상 월 (1~12)",
    )
    contract_type: str | None = Field(
        default=None,
        description="계약 유형 — 정규직 / 기간제 / 단시간 / 일용직",
    )
    pay_cycle: str | None = Field(
        default=None,
        description="임금 지급 주기 — 월급 / 시급 / 일급",
    )
    weekly_hours: float | None = Field(
        default=None,
        description="주 소정근로시간 (단시간 계약 시 의미)",
    )
    case_id: str = Field(
        default="",
        description="프론트 리뷰 세션 id — 업로드 원본 파일과 로그를 연결(관리자 열람용).",
    )


class AnalyzeOut(BaseModel):
    analysis_result: dict[str, Any] = Field(
        ...,
        description=(
            "`{riskLevel, overallStatus, overallOpinion, results[], finalRecommendations}` "
            "— EC analyze 와 통일된 스키마"
        ),
    )
    elapsed_sec: float
    model: str


@router.post(
    "/analyze",
    response_model=AnalyzeOut,
    summary="임금명세서 텍스트 → 11개 슬롯 위반 분석",
    dependencies=[Depends(require_api_key)],
)
def post_analyze(body: AnalyzeIn):
    t0 = time.time()
    try:
        result = analyze_service.run(
            body.wage_text,
            business_size=body.business_size,
            worker_types=body.worker_types,
            pay_period_year=body.pay_period_year,
            pay_period_month=body.pay_period_month,
            contract_type=body.contract_type,
            pay_cycle=body.pay_cycle,
            weekly_hours=body.weekly_hours,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"분석 실패: {type(e).__name__}: {e}",
        )
    try:
        from cgr.web.admin.store import analytics as _an
        import json as _json

        _an.log_interaction(
            kind="임금명세서",
            model=get_llm_model(),
            input_text=(body.wage_text or "")[:4000],
            output_text=_json.dumps(result, ensure_ascii=False)[:8000],
            visitor="",
            case_id=body.case_id or None,
        )
    except Exception:
        pass
    return AnalyzeOut(
        analysis_result=result,
        elapsed_sec=round(time.time() - t0, 2),
        model=get_llm_model(),
    )


# ── 2-async) 비동기 분석 — start + poll (게이트웨이 타임아웃 우회)
#
#   POST /api/v1/ws/analyze/start      → {job_id} 즉시 반환, 백그라운드 분석
#   GET  /api/v1/ws/analyze/result/{j} → {status, analysis_result, ...} 폴링
#
# 동기 /analyze 는 하위호환·로컬용으로 유지. 프론트는 start+poll 을 사용.
# ──
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
    # 클로저로 JSON 입력 캡처 — 스레드에서 실행 (ec analyze 와 동일 패턴)
    def _do() -> dict[str, Any]:
        result = analyze_service.run(
            body.wage_text,
            business_size=body.business_size,
            worker_types=body.worker_types,
            pay_period_year=body.pay_period_year,
            pay_period_month=body.pay_period_month,
            contract_type=body.contract_type,
            pay_cycle=body.pay_cycle,
            weekly_hours=body.weekly_hours,
        )
        # 상호작용 로그 — 입력(원문)·출력(분석결과) 전체 + 원본 연결(case_id)
        try:
            import json as _json

            from cgr.web.admin.store import analytics as _an

            _an.log_interaction(
                kind="임금명세서",
                model=get_llm_model(),
                input_text=(body.wage_text or "")[:6000],
                output_text=_json.dumps(result, ensure_ascii=False)[:12000],
                visitor="",
                case_id=body.case_id or None,
            )
        except Exception:
            pass
        return result

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
# 2-b) POST /api/v1/ws/generate — 분석결과 → 수정된 표준 임금명세서
# ─────────────────────────────────────────────
class GenerateIn(BaseModel):
    analysis_result: dict[str, Any] = Field(
        ...,
        description="`/ws/analyze` 응답의 analysis_result 전체",
    )
    wage_text: str = Field(
        ..., description="원본 임금명세서 텍스트 (extract 응답)"
    )
    user_overrides: dict[str, str] = Field(
        default_factory=dict,
        description="사용자가 결과 페이지에서 직접 작성한 보완 표현 (항목명 → 표현)",
    )


class GenerateOut(BaseModel):
    wage_text: str = Field(..., description="수정 반영된 표준 임금명세서 본문")
    elapsed_sec: float
    model: str


@router.post(
    "/generate",
    response_model=GenerateOut,
    summary="분석 결과 → 수정된 표준 임금명세서 텍스트",
    description=(
        "분석에서 지적된 부적절·보완필요 항목을 모두 반영한 표준 임금명세서 본문 생성. "
        "사용자가 직접 편집한 권고가 있으면(user_overrides) 그 표현을 그대로 사용."
    ),
    dependencies=[Depends(require_api_key)],
)
def post_generate(body: GenerateIn):
    t0 = time.time()
    try:
        text = generate_service.run(
            body.analysis_result,
            body.wage_text,
            user_overrides=body.user_overrides or None,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"임금명세서 생성 실패: {type(e).__name__}: {e}",
        )
    return GenerateOut(
        wage_text=text,
        elapsed_sec=round(time.time() - t0, 2),
        model=get_llm_model(),
    )


# ──
# 2-b') 비동기 생성 (start + poll) — 동기 /generate 는 LLM 시간이 길어
#       Vercel/게이트웨이 함수 타임아웃에 걸렸다. ec generate 와 동일 해법.
# ──
class GenerateResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    wage_text: str | None = None
    error: str | None = None
    elapsed_sec: float = 0.0
    model: str = ""


@router.post(
    "/generate/start",
    response_model=JobStartOut,
    summary="비동기 표준 명세서 생성 시작 — job_id 반환",
    dependencies=[Depends(require_api_key)],
)
def post_generate_start(body: GenerateIn):
    def _do() -> str:
        return generate_service.run(
            body.analysis_result,
            body.wage_text,
            user_overrides=body.user_overrides or None,
        )

    return JobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/generate/result/{job_id}",
    response_model=GenerateResultOut,
    summary="비동기 표준 명세서 생성 결과 폴링",
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
        wage_text=job["result"],
        error=job["error"],
        elapsed_sec=job["elapsed"],
        model=get_llm_model(),
    )


# ──
# 2-b'') 구조화 생성 (start + poll) — 공식 임금명세서 서식 칸을 채운 JSON.
#        프론트 비주얼 양식 뷰(WsPayslipFormView)가 칸별로 바인딩.
# ──
class GenerateFormResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    form: dict[str, Any] | None = None
    error: str | None = None
    elapsed_sec: float = 0.0
    model: str = ""


@router.post(
    "/generate-form/start",
    response_model=JobStartOut,
    summary="비동기 구조화 임금명세서 생성 시작 — job_id 반환",
    dependencies=[Depends(require_api_key)],
)
def post_generate_form_start(body: GenerateIn):
    def _do() -> dict[str, Any]:
        return generate_service.run_structured(
            body.analysis_result,
            body.wage_text,
            user_overrides=body.user_overrides or None,
        )

    return JobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/generate-form/result/{job_id}",
    response_model=GenerateFormResultOut,
    summary="비동기 구조화 임금명세서 생성 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_generate_form_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="생성 작업을 찾을 수 없어요. 작업이 만료됐거나 서버가 재시작됐을 수 있어요. 다시 시도해 주세요.",
        )
    return GenerateFormResultOut(
        status=job["status"],
        form=job["result"],
        error=job["error"],
        elapsed_sec=job["elapsed"],
        model=get_llm_model(),
    )


# ──
# 2-b''') 현재(업로드) 명세서를 '있는 그대로' 표로 — 교정 없이 전사.
#         결과 화면에서 현재 명세서를 HTML 표로 보여주는 용도.
# ──
class ParseFormIn(BaseModel):
    wage_text: str = Field(..., description="추출된 임금명세서 원문")


@router.post(
    "/parse-form/start",
    response_model=JobStartOut,
    summary="현재 임금명세서 원문 → 구조화 표 (전사, 교정 없음) 시작",
    dependencies=[Depends(require_api_key)],
)
def post_parse_form_start(body: ParseFormIn):
    def _do() -> dict[str, Any]:
        return generate_service.parse_current(body.wage_text)

    return JobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/parse-form/result/{job_id}",
    response_model=GenerateFormResultOut,
    summary="현재 임금명세서 전사 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_parse_form_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="전사 작업을 찾을 수 없어요. 다시 시도해 주세요.",
        )
    return GenerateFormResultOut(
        status=job["status"],
        form=job["result"],
        error=job["error"],
        elapsed_sec=job["elapsed"],
        model=get_llm_model(),
    )


# ─────────────────────────────────────────────
# 2-c) POST /api/v1/ws/generate-docx — 표준 명세서 .docx 다운로드
# ─────────────────────────────────────────────
class GenerateDocxIn(BaseModel):
    wage_text: str = Field(
        ..., description="이미 생성된 본문 (혹은 사용자가 편집한 내용)"
    )
    filename: str = Field(
        default="표준_임금명세서.docx",
        description="다운로드 파일명 (Content-Disposition)",
    )


@router.post(
    "/generate-docx",
    summary="평문 본문 → .docx 파일 변환·다운로드",
    description=(
        "사용자가 결과 페이지에서 편집한 표준 본문을 .docx 로 변환.\n"
        "한글 폰트 (맑은 고딕), A4, 표준 여백. `[제목]` 패턴은 자동으로 헤딩 처리."
    ),
    dependencies=[Depends(require_api_key)],
    response_class=Response,
)
def post_generate_docx(body: GenerateDocxIn):
    try:
        docx_bytes = text_to_docx(
            body.wage_text,
            title="표준 임금명세서",
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


# ──
# 2-d) POST /api/v1/ws/generate-docx-form — 구조화 form → 공식 서식 표 .docx
#      화면 양식과 동일한 표 레이아웃으로 다운로드(텍스트 dump 아님).
# ──
class GenerateDocxFormIn(BaseModel):
    form: dict[str, Any] = Field(..., description="구조화 임금명세서 form (편집본 포함)")
    filename: str = Field(default="표준_임금명세서.docx")


@router.post(
    "/generate-docx-form",
    summary="구조화 form → 공식 임금명세서 서식 표 .docx",
    dependencies=[Depends(require_api_key)],
    response_class=Response,
)
def post_generate_docx_form(body: GenerateDocxFormIn):
    try:
        docx_bytes = payslip_form_to_docx(
            body.form,
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
            f"attachment; filename=\"payslip.docx\"; "
            f"filename*=UTF-8''{fname_quoted}"
        ),
    }
    return Response(content=docx_bytes, media_type=DOCX_MIMETYPE, headers=headers)


# ─────────────────────────────────────────────
# 3) POST /api/v1/ws/inspect — 계산형 룰엔진
# ─────────────────────────────────────────────
class InspectIn(BaseModel):
    payslip: PayslipIn = Field(
        ...,
        description=(
            "사용자가 OCR 결과를 확인·확정한 구조화 임금명세서. "
            "`pay_period_year` 는 필수 (최저임금 기준 연도)."
        ),
    )
    persist: bool = Field(
        default=False,
        description=(
            "True 면 payslip + inspection_run + findings + recommendations 를 DB 에 저장 — "
            "`payslip.document_id` 가 채워져 있어야 함."
        ),
    )


class InspectOut(BaseModel):
    result: InspectionResult
    run_uid: str | None = None
    persisted: bool = False


@router.post(
    "/inspect",
    response_model=InspectOut,
    summary="구조화 임금명세서 → 계산형 룰엔진 실행",
    description=(
        "Phase 7 — 마스터 룰셋(V001~) 으로 계산형 위반 탐지.\n"
        "결정성: 같은 PayslipIn → 같은 findings (룰셋 버전 박힘).\n\n"
        "**판단형(LLM)** 위반은 `/ws/analyze` 와 별도 트랙."
    ),
    dependencies=[Depends(require_api_key)],
)
def post_inspect(body: InspectIn):
    try:
        result = rule_engine.inspect(body.payslip)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"룰엔진 실패: {type(e).__name__}: {e}",
        )

    run_uid: str | None = None
    persisted = False
    if body.persist:
        if not body.payslip.document_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "persist=true 면 payslip.document_id 가 필요. "
                    "먼저 payslip_document 를 생성하세요."
                ),
            )
        try:
            payslip_id = ws_repo.save_payslip(body.payslip)
            _run_id, run_uid = ws_repo.save_inspection_run(payslip_id, result)
            persisted = True
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"영속화 실패: {type(e).__name__}: {e}",
            )

    return InspectOut(result=result, run_uid=run_uid, persisted=persisted)


# ─────────────────────────────────────────────
# 4) GET /api/v1/ws/catalog
# ─────────────────────────────────────────────
class CatalogOut(BaseModel):
    version: str
    doc: str
    description: str
    slots: list[dict[str, Any]]


@router.get(
    "/catalog",
    response_model=CatalogOut,
    summary="임금명세서 슬롯 카탈로그 (관리자/디버그)",
    description="마스터 DB 의 11개 슬롯 + 적용조건·위험도·연관주제·법령을 한 번에.",
    dependencies=[Depends(require_api_key)],
)
def get_catalog():
    try:
        cat = load_ws_catalog()
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e)
        )
    return CatalogOut(
        version=cat.version,
        doc=cat.doc,
        description=cat.description,
        slots=[s.model_dump() for s in cat.slots],
    )
