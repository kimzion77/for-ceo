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
from cgr.ec import review_ec_file
from cgr.models import WorkplaceContext
from cgr.penalty_parser import format_for_user
from cgr.run import review_file
from cgr.verdict import classify
from cgr.web.admin.store import access_log, history


router = APIRouter(prefix="/review", tags=["review"])

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_CATALOG_PATH = _PROJECT_ROOT / "data" / "slots" / "atomic_slots_v0.yaml"


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
