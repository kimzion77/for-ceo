"""hwpx(zip + xml) → plaintext.

hwpx 는 OOXML 유사 zip 패키지. Contents/section*.xml 의 <hp:p>·<hp:t> 텍스트 추출.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


def parse_hwpx(path: str | Path) -> str:
    parts: list[str] = []
    with zipfile.ZipFile(str(path)) as z:
        sections = sorted(n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n))
        for name in sections:
            with z.open(name) as f:
                try:
                    tree = ET.parse(f)
                except ET.ParseError:
                    continue
            for el in tree.getroot().iter():
                tag = el.tag.split("}")[-1]
                if tag in ("p", "para"):
                    text = "".join(
                        (t.text or "")
                        for t in el.iter()
                        if t.tag.split("}")[-1] in ("t", "char")
                    )
                    parts.append(text.rstrip())
    return "\n".join(parts)
