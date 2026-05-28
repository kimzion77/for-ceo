"""pdf → plaintext (pdfplumber)."""
from __future__ import annotations
from pathlib import Path


def parse_pdf(path: str | Path) -> str:
    try:
        import pdfplumber
    except ImportError as e:
        raise RuntimeError(
            "pdfplumber 미설치. 'pip install pdfplumber' 로 설치하세요."
        ) from e
    parts: list[str] = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            parts.append(text)
    return "\n".join(parts)
