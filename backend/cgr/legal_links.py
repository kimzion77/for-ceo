"""법령 인용 → 국가법령정보센터 링크 생성.

벌칙 문자열에서 (법령명, 조항) 추출 후 https://www.law.go.kr/법령/<법령명>/제<N>조 링크.
"""
from __future__ import annotations

import re
from urllib.parse import quote


# 법령명 정규화 — 슬롯/마스터 DB 표기 → 국가법령정보센터 표준 명칭
LAW_NAME_MAP = {
    "근로기준법": "근로기준법",
    "남녀고용평등법": "남녀고용평등과 일·가정 양립 지원에 관한 법률",
    "남녀고용평등과 일·가정 양립 지원에 관한 법률": "남녀고용평등과 일·가정 양립 지원에 관한 법률",
    "산업안전보건법": "산업안전보건법",
    "근로자퇴직급여보장법": "근로자퇴직급여 보장법",
    "근로자퇴직급여 보장법": "근로자퇴직급여 보장법",
    "최저임금법": "최저임금법",
    "고용상연령차별금지및고령자고용촉진에관한법률": "고용상 연령차별금지 및 고령자고용촉진에 관한 법률",
    "고용상 연령차별금지 및 고령자고용촉진에 관한 법률": "고용상 연령차별금지 및 고령자고용촉진에 관한 법률",
    "고령자고용법": "고용상 연령차별금지 및 고령자고용촉진에 관한 법률",
    "채용절차의 공정화에 관한 법률": "채용절차의 공정화에 관한 법률",
    "산업재해보상보험법": "산업재해보상보험법",
    "기간제법": "기간제 및 단시간근로자 보호 등에 관한 법률",
    "기간제 및 단시간근로자 보호 등에 관한 법률": "기간제 및 단시간근로자 보호 등에 관한 법률",
    "파견법": "파견근로자 보호 등에 관한 법률",
    "파견근로자 보호 등에 관한 법률": "파견근로자 보호 등에 관한 법률",
    "장애인차별금지법": "장애인차별금지 및 권리구제 등에 관한 법률",
    "장애인차별금지 및 권리구제 등에 관한 법률": "장애인차별금지 및 권리구제 등에 관한 법률",
    "장애인고용촉진 및 직업재활법": "장애인고용촉진 및 직업재활법",
    "개인정보 보호법": "개인정보 보호법",
    "개인정보보호법": "개인정보 보호법",
    "근로자의 날 제정에 관한 법률": "근로자의 날 제정에 관한 법률",
    "모자보건법": "모자보건법",
    "공익신고자 보호법": "공익신고자 보호법",
    "병역법": "병역법",
}

# 정규식: "(법명) 제(N)조" 또는 "(법명) §(N)조"
# 법명은 한글+공백+·+조사 등 포함 가능
_LAW_PATTERN = re.compile(
    r"([가-힣·\s]{3,30}?(?:법|법률|시행령|시행규칙))"
    r"\s*"
    r"(?:제\s*|§\s*)"
    r"(\d+)"
    r"조"
    r"(?:의(\d+))?"   # 제17조의2 같은 가지번호
    r"(?:\s*제\s*(\d+)\s*항)?"
    r"(?:\s*제\s*(\d+)(?:의\d+)?\s*호)?"
)


def parse_legal_refs(text: str) -> list[dict[str, str]]:
    """문자열에서 모든 법령 인용을 추출.

    Returns:
        [{"law": 정규화된 법명, "raw_law": 원문 법명, "article": "제N조", "url": "..."}]
    """
    out = []
    seen = set()
    for m in _LAW_PATTERN.finditer(text):
        raw_law = m.group(1).strip()
        art_no = m.group(2)
        sub_art = m.group(3)
        para = m.group(4)
        ho = m.group(5)
        # 공백 정리
        raw_law = re.sub(r"\s+", " ", raw_law).strip()
        # 매핑 시도 — 부분 일치도 허용
        canon = LAW_NAME_MAP.get(raw_law)
        if not canon:
            # raw_law 가 너무 길게 잡혔을 수 있음 — 끝 단어부터 trim
            for key in sorted(LAW_NAME_MAP, key=len, reverse=True):
                if raw_law.endswith(key):
                    canon = LAW_NAME_MAP[key]
                    raw_law = key
                    break
        if not canon:
            canon = raw_law

        article_label = f"제{art_no}조"
        if sub_art:
            article_label += f"의{sub_art}"
        full_label = f"{canon} {article_label}"
        if para:
            full_label += f" 제{para}항"
        if ho:
            full_label += f" 제{ho}호"

        url = f"https://www.law.go.kr/법령/{quote(canon)}/{quote(article_label)}"
        key = (canon, article_label)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "law": canon,
            "raw": raw_law,
            "article": article_label,
            "label": full_label,
            "url": url,
        })
    return out


def parse_penalties(penalties: list[str]) -> list[dict[str, str]]:
    """penalty 리스트에서 법령 인용 + 처벌 텍스트 분리."""
    parsed = []
    for p in penalties:
        refs = parse_legal_refs(p)
        parsed.append({
            "raw": p,
            "refs": refs,
        })
    return parsed
