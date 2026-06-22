"""검토 엔드포인트 — 핵심 API.

POST /api/v1/review            : 사업장 파일 업로드 + 검토 실행
GET  /api/v1/review/{case_id}  : 캐시·이력에서 case_id 로 결과 조회
"""
from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from cgr import revise
from cgr.api import jobs
from cgr.api.auth import require_api_key
from cgr.api.schemas import (
    ArticleResultOut,
    EcFindingOut,
    EcReviewOut,
    FindingOut,
    ReviewFullOut,
    ReviewSummaryOut,
    WorkplaceContextIn,
)
from cgr.config import get_llm_model
from cgr.docx_export import DOCX_MIMETYPE, text_to_docx, wr_comparison_to_docx
from cgr.ec import review_ec_file
from cgr.models import WorkplaceContext
from cgr.penalty_parser import format_for_user
from cgr.run import review_file
from cgr.verdict import classify
from cgr.web.admin.store import access_log, history


router = APIRouter(prefix="/review", tags=["review"])

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_CATALOG_PATH = _PROJECT_ROOT / "data" / "slots" / "atomic_slots_v0.yaml"
_STANDARD_WR_PATH = _PROJECT_ROOT / "data" / "standards" / "표준취업규칙_2026.txt"


from functools import lru_cache  # noqa: E402


@lru_cache(maxsize=1)
def _load_standard_work_rules() -> str | None:
    """고용노동부 표준취업규칙(2026) 전문 — 수정본 생성 시 준용 기준으로 주입.

    파일이 없어도(과거 배포 이미지 등) 수정본 생성 자체는 동작해야 하므로
    None 을 반환하고 revise 는 표준 없이 진행한다.
    """
    try:
        return _STANDARD_WR_PATH.read_text(encoding="utf-8")
    except Exception:
        return None


def _finding_to_out(f, ar_title: str) -> FindingOut:
    """cgr.models.Finding → API 응답 FindingOut."""
    penalty_groups = format_for_user(f.penalty or [])
    return FindingOut(
        slot_id=f.slot_id,
        article=f.article,
        bucket=classify(f),
        status=f.status,
        severity=f.severity or "",
        comparator=f.comparator,
        reason=f.reason or "",
        user_reason=f.user_reason,
        quote=(f.extracted.quote if f.extracted else "") or "",
        extracted_value=(f.extracted.extracted_value if f.extracted else None),
        penalty_omission=penalty_groups["omission"],
        penalty_violation=penalty_groups["violation"],
        fix_example=f.fix_example,
    )


def _to_bool(v: str | None) -> bool | None:
    if v is None or v == "" or v.lower() == "null":
        return None
    return v.lower() in ("true", "1", "yes", "y")


def _parse_worker_types(v: str | None) -> list[str]:
    """`정규직,기간제,단시간` 같은 콤마 구분 문자열 → list."""
    if not v:
        return []
    return [t.strip() for t in v.split(",") if t.strip()]


@router.post(
    "",
    response_model=ReviewFullOut | EcReviewOut,
    summary="사업장 문서 검토 (취업규칙·근로계약서)",
    description=(
        "`document_type` 으로 분기:\n"
        "- `work_rules` (기본): 취업규칙 → 5-Bucket (누락·위반·주의·검토필요·적정)\n"
        "- `employment_contract`: 근로계약서 → 3-Bucket (적절·보완필요·부적절)\n\n"
        "사업장 정보 폼은 통합 — 각 문서가 자기에게 필요한 필드만 사용.\n"
        "- 취업규칙: shift_work·osha·chemical·workenv\n"
        "- 근로계약서: business_size·worker_types"
    ),
    dependencies=[Depends(require_api_key)],
)
async def post_review(
    file: UploadFile = File(..., description="검토 대상 파일 (.docx/.hwp/.hwpx/.pdf/.txt)"),
    document_type: str = Form(
        default="work_rules",
        description="문서 종류: 'work_rules' | 'employment_contract'",
    ),
    # 취업규칙용
    shift_work_used: str | None = Form(default=None, description="교대근로 도입: 'true'/'false'/null"),
    osha_applicable: str | None = Form(default="true", description="산안법 적용 업종"),
    chemical_handling: str | None = Form(default=None, description="화학물질 취급"),
    workenv_measurement: str | None = Form(default=None, description="작업환경측정 대상"),
    # 근로계약서용
    business_size: str | None = Form(
        default=None,
        description="사업장 규모: '5+' / '5-' / 'any' / null",
    ),
    worker_types: str | None = Form(
        default=None,
        description="근로자 유형 콤마 구분: '정규직,기간제,단시간,일용직,연소자,외국인'",
    ),
    summary_only: bool = Form(default=False, description="true면 finding 상세 제외하고 summary 만"),
):
    # ── 임시 파일 저장
    suffix = Path(file.filename or "upload.bin").suffix
    if not suffix:
        suffix = ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        content = await file.read()
        tf.write(content)
        tmp_path = Path(tf.name)

    # ── 사업장 컨텍스트 (통합 폼)
    bs = business_size if business_size in ("5+", "5-", "any") else None
    context = WorkplaceContext(
        shift_work_used=_to_bool(shift_work_used),
        osha_applicable=_to_bool(osha_applicable) if osha_applicable else True,
        chemical_handling=_to_bool(chemical_handling),
        workenv_measurement=_to_bool(workenv_measurement),
        business_size=bs,
        worker_types=_parse_worker_types(worker_types),
    )

    # ── document_type 분기
    try:
        if document_type == "employment_contract":
            return _run_employment_contract(tmp_path, file.filename or "", context)
        else:
            return _run_work_rules(tmp_path, file.filename or "", context, summary_only)
    finally:
        # 임시 파일 정리
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


# ─────────────────────────────────────────────
# 비동기 검토 — 게이트웨이 타임아웃 우회 (start + poll)
#
#   POST /api/v1/review/start       → {job_id} 즉시 반환, 백그라운드 검토
#   GET  /api/v1/review/result/{id} → {status, result, ...} 폴링
#
# 취업규칙 검토는 Excel 로드 + 전 조항 LLM 검토를 한 번에 하므로 가장 느림.
# 동기 POST /review 는 하위호환·로컬용으로 유지하고, 프론트는 start+poll 사용.
# ─────────────────────────────────────────────
class ReviewJobStartOut(BaseModel):
    job_id: str


class ReviewJobResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    result: dict | None = None
    error: str | None = None
    elapsed_sec: float = 0.0


def _dispatch_review(
    tmp_path: Path,
    filename: str,
    document_type: str,
    context: WorkplaceContext,
    summary_only: bool,
) -> dict:
    """검토 실행 후 JSON 직렬화 dict 반환 — 백그라운드 잡에서 호출."""
    try:
        if document_type == "employment_contract":
            out = _run_employment_contract(tmp_path, filename, context)
        else:
            out = _run_work_rules(tmp_path, filename, context, summary_only)
        return out.model_dump(mode="json")
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


@router.post(
    "/start",
    response_model=ReviewJobStartOut,
    summary="비동기 검토 시작 — job_id 반환",
    dependencies=[Depends(require_api_key)],
)
async def post_review_start(
    file: UploadFile = File(...),
    document_type: str = Form(default="work_rules"),
    shift_work_used: str | None = Form(default=None),
    osha_applicable: str | None = Form(default="true"),
    chemical_handling: str | None = Form(default=None),
    workenv_measurement: str | None = Form(default=None),
    business_size: str | None = Form(default=None),
    worker_types: str | None = Form(default=None),
    summary_only: bool = Form(default=False),
):
    suffix = Path(file.filename or "upload.bin").suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(await file.read())
        tmp_path = Path(tf.name)
    filename = file.filename or ""

    bs = business_size if business_size in ("5+", "5-", "any") else None
    context = WorkplaceContext(
        shift_work_used=_to_bool(shift_work_used),
        osha_applicable=_to_bool(osha_applicable) if osha_applicable else True,
        chemical_handling=_to_bool(chemical_handling),
        workenv_measurement=_to_bool(workenv_measurement),
        business_size=bs,
        worker_types=_parse_worker_types(worker_types),
    )

    def _do() -> dict:
        return _dispatch_review(tmp_path, filename, document_type, context, summary_only)

    job_id = jobs.start_job(_do)
    return ReviewJobStartOut(job_id=job_id)


@router.get(
    "/result/{job_id}",
    response_model=ReviewJobResultOut,
    summary="비동기 검토 결과 폴링",
    dependencies=[Depends(require_api_key)],
)
def get_review_result(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="검토 작업을 찾을 수 없어요. 작업이 만료됐거나 서버가 재시작됐을 수 있어요. 다시 시도해 주세요.",
        )
    return ReviewJobResultOut(
        status=job["status"],
        result=job["result"],
        error=job["error"],
        elapsed_sec=job["elapsed"],
    )


def _run_work_rules(
    tmp_path: Path,
    filename: str,
    context: WorkplaceContext,
    summary_only: bool,
) -> ReviewFullOut:
    """취업규칙 검토 흐름 (기존 로직)."""
    t0 = time.time()
    try:
        report = review_file(tmp_path, _CATALOG_PATH, context=context)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"검토 실패: {type(e).__name__}: {e}",
        )
    elapsed = time.time() - t0

    # 이력 누적
    try:
        entry = history.build_entry_from_report(report)
        entry["filename"] = filename
        entry["service"] = "취업규칙"
        history.append_history(entry)
    except Exception:
        pass
    try:
        access_log.log_event(
            service="취업규칙",
            action="review",
            meta={"filename": filename, "via": "api"},
        )
    except Exception:
        pass

    article_results = []
    if not summary_only:
        for ar in report.article_results:
            article_results.append(
                ArticleResultOut(
                    article=ar.article,
                    title=ar.title or "",
                    findings=[_finding_to_out(f, ar.title or "") for f in ar.findings],
                )
            )

    try:
        import json as _json
        import mimetypes as _mt

        from cgr import upload_tracker as _ut
        from cgr.web.admin.store import analytics as _an

        # (1) 원본 업로드 파일 보관 — 상세 화면에서 이미지/문서 열람 (case_id 로 연결)
        _upload_id: int | None = None
        try:
            _content = tmp_path.read_bytes()
            _mime = _mt.guess_type(filename)[0] or ""
            _upload_id = _ut.record_upload(
                content=_content,
                filename=filename,
                mime=_mime,
                service="취업규칙",
                case_id=report.case_id,
            )
        except Exception:
            _upload_id = None

        # (2) 무엇을 위반/누락으로 잡았는지 — 조항·판정·근거·원문 인용·권고까지 전체 기록
        _flagged: list[dict] = []
        _ok = 0
        for _ar in report.article_results:
            for _f in _ar.findings:
                _b = classify(_f)
                if _b == "적정":
                    _ok += 1
                    continue
                _flagged.append(
                    {
                        "article": _f.article,
                        "title": (_ar.title or "")[:120],
                        "bucket": _b,
                        "severity": _f.severity or "",
                        "reason": (_f.reason or "")[:600],
                        "quote": ((_f.extracted.quote if _f.extracted else "") or "")[:400],
                        "fix": (_f.fix_example or "")[:600],
                    }
                )
        _payload = {
            "overall": report.overall_label or "",
            "summary": dict(report.summary or {}),
            "flagged": _flagged[:80],
            "flagged_total": len(_flagged),
            "ok_count": _ok,
            "case_id": report.case_id,
        }
        _an.log_interaction(
            kind="취업규칙",
            model=get_llm_model(),
            input_text=f"[취업규칙 검토] {filename}",
            output_text=_json.dumps(_payload, ensure_ascii=False)[:12000],
            visitor="",
            case_id=report.case_id,
            upload_id=_upload_id,
        )
    except Exception:
        pass

    return ReviewFullOut(
        case_id=report.case_id,
        filename=filename,
        overall_label=report.overall_label or "",
        summary=dict(report.summary),
        n_findings=sum(report.summary.values()) if report.summary else 0,
        elapsed_sec=round(elapsed, 2),
        llm_model=get_llm_model(),
        article_results=article_results,
    )


def _run_employment_contract(
    tmp_path: Path,
    filename: str,
    context: WorkplaceContext,
) -> EcReviewOut:
    """근로계약서 검토 흐름 (3-Bucket)."""
    try:
        report = review_ec_file(tmp_path, context=context)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"근로계약서 검토 실패: {type(e).__name__}: {e}",
        )

    # 이력 누적 (취업규칙과 분리)
    try:
        access_log.log_event(
            service="근로계약서",
            action="review",
            meta={
                "filename": filename,
                "via": "api",
                "overall_label": report.overall_label,
            },
        )
    except Exception:
        pass

    findings_out = [
        EcFindingOut(
            slot_id=f.slot_id,
            field=f.field,
            bucket=f.bucket,
            severity=f.severity,
            present=f.present,
            extracted=f.extracted,
            reason=f.reason,
            required_content=f.required_content,
            purpose=f.purpose,
            laws=f.laws,
            topic_meta=f.topic_meta,
            fix_example=f.fix_example,
        )
        for f in report.findings
    ]

    return EcReviewOut(
        case_id=report.case_id,
        filename=filename,
        doc="employment_contract",
        overall_label=report.overall_label,
        summary=report.summary,
        n_findings=len(report.findings),
        skipped=report.skipped,
        elapsed_sec=report.elapsed_sec,
        findings=findings_out,
    )


# ─────────────────────────────────────────────
# 수정본 생성 — 원문 보존 + 사용자 수정 목록만 반영 (start + poll)
#
#   POST /api/v1/review/generate/start       → {job_id} 즉시 반환, 백그라운드 생성
#   GET  /api/v1/review/generate/result/{j}  → {status, revised_text, ...} 폴링
#   POST /api/v1/review/generate-docx        → 본문 → .docx 다운로드
#
# 철학: 문제없는 조항은 두고, 사용자가 담은 수정 항목만 교체·추가해 전문 출력.
# 주의: GET /review/{case_id} (단일 세그먼트) 보다 먼저 선언 — 경로 충돌 방지.
# ─────────────────────────────────────────────
class CorrectionIn(BaseModel):
    name: str = Field(..., description="항목명 (예: 제24조 연차유급휴가)")
    now: str = Field(default="", description="현재 표현 (원문 발견 내용)")
    fix: str = Field(..., description="수정 문구 (사용자 확정 표현)")


class GenerateIn(BaseModel):
    original_text: str = Field(..., description="추출된 취업규칙 원문 전체")
    corrections: list[CorrectionIn] = Field(
        ..., description="사용자가 수정본에 담은 항목 목록"
    )


class GenerateResultOut(BaseModel):
    status: str = Field(..., description="pending | done | error")
    revised_text: str | None = None
    error: str | None = None
    elapsed_sec: float = 0.0
    model: str = ""


@router.post(
    "/generate/start",
    response_model=ReviewJobStartOut,
    summary="비동기 취업규칙 수정본 생성 시작 — job_id 반환",
    description=(
        "원문은 그대로 유지하고, 사용자가 담은 수정 항목만 반영한 "
        "'취업규칙 수정본' 전문을 생성합니다."
    ),
    dependencies=[Depends(require_api_key)],
)
def post_generate_start(body: GenerateIn):
    original_text = body.original_text
    corrections = [c.model_dump() for c in body.corrections]
    standard = _load_standard_work_rules()

    def _do() -> str:
        # mark_changes=True — 교체·추가 문구를 【수정】…【/수정】 로 감싸 반환.
        # 프론트(wr/contract)가 하이라이트 렌더에 사용. SC 경로는 기본 False 유지.
        return revise.run(
            "취업규칙",
            original_text,
            corrections,
            standard_text=standard,
            mark_changes=True,
        )

    return ReviewJobStartOut(job_id=jobs.start_job(_do))


@router.get(
    "/generate/result/{job_id}",
    response_model=GenerateResultOut,
    summary="비동기 취업규칙 수정본 생성 결과 폴링",
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
        default="취업규칙_수정본.docx",
        description="다운로드 파일명 (Content-Disposition)",
    )


@router.post(
    "/generate-docx",
    summary="취업규칙 수정본 본문 → .docx 변환·다운로드",
    description="수정본 본문을 .docx 로 변환. 한글 폰트(맑은 고딕)·A4·표준 여백.",
    dependencies=[Depends(require_api_key)],
    response_class=Response,
)
def post_generate_docx(body: GenerateDocxIn):
    try:
        docx_bytes = text_to_docx(
            body.contract_text,
            title="취업규칙 수정본",
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


class ComparisonDocxIn(BaseModel):
    rows: list[dict] = Field(
        default_factory=list,
        description="신구대조표 행 목록 [{article,title,before,after,remark}]",
    )
    effective_date: str = Field(default="", description="개정 취업규칙 시행일")
    filename: str = Field(default="취업규칙_신구대조표.docx", description="다운로드 파일명")


@router.post(
    "/comparison-docx",
    summary="취업규칙 신구대조표(표) + 의견청취서 → .docx 다운로드",
    description="신구대조표를 깨지지 않는 3열 표로 출력하고, 뒤에 의견청취서 양식을 함께 첨부.",
    dependencies=[Depends(require_api_key)],
    response_class=Response,
)
def post_comparison_docx(body: ComparisonDocxIn):
    try:
        docx_bytes = wr_comparison_to_docx(
            body.rows,
            effective_date=body.effective_date,
            footer_note=(
                "※ 본 신구대조표는 AI 자율점검 결과를 반영한 개정안입니다. "
                "시행은 의견청취·동의 등 법정 절차를 거쳐 확정하세요."
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
            f"attachment; filename=\"comparison.docx\"; "
            f"filename*=UTF-8''{fname_quoted}"
        ),
    }
    return Response(content=docx_bytes, media_type=DOCX_MIMETYPE, headers=headers)


@router.get(
    "/{case_id}",
    response_model=ReviewSummaryOut,
    summary="case_id 로 이력 검토 결과 조회",
    dependencies=[Depends(require_api_key)],
)
async def get_review_by_case(case_id: str) -> ReviewSummaryOut:
    rows = history.read_history()
    matched = [r for r in rows if r.get("case_id") == case_id]
    if not matched:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"case_id={case_id} 결과를 이력에서 찾지 못함",
        )
    r = matched[-1]
    by_bucket = r.get("by_bucket") or {}
    return ReviewSummaryOut(
        case_id=r.get("case_id", ""),
        filename=r.get("filename", ""),
        overall_label=r.get("overall_label", ""),
        summary=by_bucket,
        n_findings=r.get("n_findings", sum(by_bucket.values())),
        elapsed_sec=0.0,
        llm_model=r.get("llm_model", ""),
    )
