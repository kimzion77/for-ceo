"""근로계약서 슬롯 카탈로그 빌드.

CSV (`근로계약서_updated.csv`) → YAML (`data/slots/atomic_slots_ec.yaml`)

CSV 컬럼:
  적용조건, 항목, 기재내용, 필요이유, 연관주제1~7, 관련법령1~4

YAML 슬롯 스키마:
  slot_id, doc, applicability (business_size + worker_types),
  field, required_content, purpose, topic_meta, laws,
  comparator, missing_severity, violation_severity, fix_example
"""
from __future__ import annotations

import csv
import io
import re
import sys
from pathlib import Path

# UTF-8 출력 강제 (Windows cp949 회피)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import yaml


# 입력·출력 경로
CSV_PATH = Path(
    "C:/Users/Jini/Desktop/1. 영세사업장 자율점검/1. 근로계약서/기존/근로계약서_updated.csv"
)
OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "slots" / "atomic_slots_ec.yaml"


# 적용조건 → applicability 매핑
def parse_applicability(cond: str) -> dict:
    """
    공통             → {business_size: any, worker_types: any}
    5인이상           → {business_size: 5+,  worker_types: any}
    기간제           → {business_size: any, worker_types: [기간제]}
    단시간           → {business_size: any, worker_types: [단시간]}
    일용직           → {business_size: any, worker_types: [일용직]}
    연소자           → {business_size: any, worker_types: [연소자]}
    외국인           → {business_size: any, worker_types: [외국인]}
    외국인(농축어업)   → {business_size: any, worker_types: [외국인-농축어업]}
    """
    cond = cond.strip()
    if cond == "공통":
        return {"business_size": "any", "worker_types": "any"}
    if cond == "5인이상":
        return {"business_size": "5+", "worker_types": "any"}
    m = re.match(r"외국인\(농축어업\)", cond)
    if m:
        return {"business_size": "any", "worker_types": ["외국인-농축어업"]}
    # 단일 worker type
    return {"business_size": "any", "worker_types": [cond]}


# 항목명 → slot_id (영문 ID 가 없어서 일련번호 + 항목 슬러그)
def make_slot_id(idx: int, field: str) -> str:
    # 간단 슬러그: 비-한글/영숫자 제거
    slug = re.sub(r"[^\w가-힣]+", "_", field).strip("_")[:30]
    return f"SLOT_EC_{idx:02d}_{slug}"


def topic_list(row: dict) -> list[str]:
    out = []
    for i in range(1, 8):
        v = (row.get(f"연관주제{i}") or "").strip()
        if v:
            out.append(v)
    return out


def law_list(row: dict) -> list[str]:
    out = []
    for i in range(1, 5):
        v = (row.get(f"관련법령{i}") or "").strip()
        if v:
            out.append(v)
    return out


# 항목명·필요이유로 severity 추정 (간이 휴리스틱).
# 명세상 명확한 severity 없으므로 보수적으로:
#   - 임금/근로시간/계약기간 등 → HIGH (필수기재 + 즉시 분쟁 소지)
#   - 그 외 공통 → MEDIUM (필수기재이지만 분쟁 소지 낮음)
#   - 연소자 보호·외국인 등 특수조항 → HIGH
HIGH_KEYWORDS = [
    "임금", "근로시간", "계약기간", "계약일", "근로일",
    "수당", "퇴직", "최저임금", "야간", "휴일",
    "친권자", "연령", "체류",
]


def estimate_severity(field: str, purpose: str) -> str:
    text = f"{field} {purpose}"
    if any(k in text for k in HIGH_KEYWORDS):
        return "HIGH"
    return "MEDIUM"


def main() -> None:
    if not CSV_PATH.exists():
        sys.exit(f"CSV 없음: {CSV_PATH}")

    slots = []
    with CSV_PATH.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, start=1):
            field = (row.get("항목") or "").strip()
            if not field:
                continue

            slot = {
                "slot_id": make_slot_id(idx, field),
                "doc": "employment_contract",
                "applicability": parse_applicability(row.get("적용조건", "공통")),
                "field": field,
                "required_content": (row.get("기재내용") or "").strip(),
                "purpose": (row.get("필요이유") or "").strip(),
                "topic_meta": topic_list(row),
                "laws": law_list(row),
                # 모든 항목이 "필수 기재 여부" 검증이므로 comparator=presence
                "comparator": "presence",
                "missing_severity": estimate_severity(field, row.get("필요이유", "")),
                "violation_severity": estimate_severity(field, row.get("필요이유", "")),
                # fix_example 은 기재내용 그대로 사용 (사용자에게 어떤 내용을 적어야 하는지)
                "fix_example": (row.get("기재내용") or "").strip(),
            }
            slots.append(slot)

    catalog = {
        "version": "v0",
        "doc": "employment_contract",
        "description": (
            "근로계약서 슬롯 카탈로그 (v0). 원본: 근로계약서_updated.csv (35개 항목).\n"
            "검토 AI 파이프라인:\n"
            "  [추출(LLM)] 사업장 근로계약서 텍스트 → 항목별 기재 여부·내용\n"
            "    → [정합성 판정(코드)] required_content 와 비교\n"
            "    → [위험도 산출] severity 부여 → 적절/보완필요/부적절 라벨링"
        ),
        "schema": {
            "slot_id": "고유 ID (SLOT_EC_<index>_<field>)",
            "doc": "문서 종류 — employment_contract",
            "applicability": "적용 조건 — business_size + worker_types",
            "field": "필수 기재 항목명",
            "required_content": "기재되어야 할 내용 (csv 의 기재내용)",
            "purpose": "기재 필요 이유 (csv 의 필요이유)",
            "topic_meta": "연관 주제 (csv 의 연관주제1~7)",
            "laws": "관련 법령 (csv 의 관련법령1~4)",
            "comparator": "비교 연산자 — 근로계약서는 모두 presence (기재 여부)",
            "missing_severity": "미기재 시 위험도",
            "violation_severity": "내용 부적절 시 위험도",
            "fix_example": "시정 예시 (기재내용 권장 표현)",
        },
        "risk_levels": {
            "HIGH": "필수 기재 누락 — 임금·근로시간·계약기간·수당 등 (분쟁 소지 큼)",
            "MEDIUM": "필수 기재 누락 — 기타 항목 (분쟁 소지 낮음)",
            "LOW": "권고 — 형식·표현 다듬기",
        },
        "verdict_buckets": {
            "부적절": "기재 자체가 없거나 법정 기준에 명백히 위반",
            "보완필요": "기재는 있으나 표현·금액·기간 등에 보완 필요",
            "적절": "법정 기준 충족 + 명확히 기재됨",
        },
        "slots": slots,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        yaml.safe_dump(
            catalog,
            f,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
            width=120,
        )

    print(f"✓ 작성: {OUT_PATH}")
    print(f"  슬롯 수: {len(slots)}")
    print(f"  HIGH: {sum(1 for s in slots if s['missing_severity']=='HIGH')}")
    print(f"  MEDIUM: {sum(1 for s in slots if s['missing_severity']=='MEDIUM')}")


if __name__ == "__main__":
    main()
