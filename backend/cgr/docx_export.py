"""DOCX 문서 생성 — 표준 임금명세서·근로계약서 다운로드용.

`python-docx` 활용. 텍스트 본문 → 양식 갖춘 .docx 바이트.

사용 패턴
    text = generate_service.run(...)   # 평문 본문 생성
    docx_bytes = text_to_docx(text, title='표준 임금명세서')
    # FastAPI 응답:
    return Response(docx_bytes, media_type=DOCX_MIMETYPE, headers={...})

설계
- 평문에서 `[섹션 제목]` 패턴을 헤딩으로 식별
- 한글 폰트 — '맑은 고딕' (Windows 기본) 적용
- A4 portrait, 표준 여백
"""
from __future__ import annotations

import io
import re

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt


DOCX_MIMETYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

# 평문에서 헤딩 후보 패턴 — `[제목]` 또는 끝까지 `:` 인 짧은 줄
_HEADING_BRACKET = re.compile(r"^\s*\[([^\]]+)\]\s*$")
# `근 로 계 약 서`, `임 금 명 세 서` 같이 자간 띄운 제목 (가운데 정렬)
_HEADING_SPACED = re.compile(r"^\s*([가-힣]\s){2,}[가-힣]\s*$")


def _apply_korean_font(run, font_name: str = "맑은 고딕"):
    """run.font.name + east_asia rPr 둘 다 설정 — 한글 안 깨짐."""
    run.font.name = font_name
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(
        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rFonts"
    )
    if rFonts is None:
        from docx.oxml.ns import qn

        rFonts = rPr.makeelement(qn("w:rFonts"), {})
        rPr.append(rFonts)
    from docx.oxml.ns import qn

    rFonts.set(qn("w:eastAsia"), font_name)
    rFonts.set(qn("w:ascii"), font_name)
    rFonts.set(qn("w:hAnsi"), font_name)


def text_to_docx(
    body_text: str,
    *,
    title: str = "표준 문서",
    subtitle: str | None = None,
    footer_note: str | None = None,
) -> bytes:
    """평문 본문 → DOCX 바이트.

    Args:
        body_text: LLM 생성 본문.
        title: 문서 최상단 제목 (Heading 0).
        subtitle: 제목 하단 부제 (선택).
        footer_note: 본문 하단 안내 (선택).
    """
    doc = Document()

    # 페이지 설정 — A4 + 표준 여백
    for section in doc.sections:
        section.top_margin = Cm(2.0)
        section.bottom_margin = Cm(2.0)
        section.left_margin = Cm(2.0)
        section.right_margin = Cm(2.0)

    # ─── 제목 ───
    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run_title = p_title.add_run(title)
    run_title.bold = True
    run_title.font.size = Pt(18)
    _apply_korean_font(run_title)

    if subtitle:
        p_sub = doc.add_paragraph()
        p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run_sub = p_sub.add_run(subtitle)
        run_sub.font.size = Pt(10)
        run_sub.font.color.rgb = None  # 기본 회색 톤 — python-docx 기본 검정
        _apply_korean_font(run_sub)

    # 빈 줄
    doc.add_paragraph()

    # ─── 본문 ───
    for raw_line in body_text.splitlines():
        line = raw_line.rstrip()
        if not line:
            doc.add_paragraph()
            continue

        # 헤딩 — `[제목]`
        m1 = _HEADING_BRACKET.match(line)
        if m1:
            p = doc.add_paragraph()
            run = p.add_run(m1.group(1))
            run.bold = True
            run.font.size = Pt(13)
            _apply_korean_font(run)
            continue

        # 헤딩 — `근 로 계 약 서` (자간 띄운 제목, body 안 부속 제목)
        m2 = _HEADING_SPACED.match(line)
        if m2 and len(line.replace(" ", "")) <= 10:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(line.strip())
            run.bold = True
            run.font.size = Pt(14)
            _apply_korean_font(run)
            continue

        # 본문 일반 — 한글 폰트 적용
        p = doc.add_paragraph()
        run = p.add_run(line)
        run.font.size = Pt(10.5)
        _apply_korean_font(run)

    # ─── 푸터 안내 ───
    if footer_note:
        doc.add_paragraph()  # 공백
        p_foot = doc.add_paragraph()
        p_foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run_foot = p_foot.add_run(footer_note)
        run_foot.italic = True
        run_foot.font.size = Pt(9)
        _apply_korean_font(run_foot)

    # 바이트로 직렬화
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.read()
