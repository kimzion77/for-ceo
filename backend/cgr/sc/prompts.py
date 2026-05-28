"""노무제공자 계약서 — 프롬프트 로더.

EC 와 달리 SC 는 외부 JSON 으로 빼지 않고 본 모듈 인라인.
구조화·분석 두 단계의 system prompt + safe_json_parse 헬퍼.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml


_SLOT_YAML = (
    Path(__file__).resolve().parent.parent.parent
    / "data" / "slots" / "atomic_slots_sc.yaml"
)


def _load_slots() -> list[dict[str, Any]]:
    if not _SLOT_YAML.exists():
        raise FileNotFoundError(f"SC 슬롯 YAML 없음: {_SLOT_YAML}")
    with _SLOT_YAML.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("slots", []) or []


# ─── 구조화 (텍스트 → 16 슬롯) ─────────────────────────────────
STRUCTURE_PROMPT = """\
당신은 한국 노동법(특히 노무제공자 / 특수형태근로종사자 / 플랫폼 종사자) 전문 검토 보조 AI 입니다.
입력으로 들어온 노무제공자 계약서 텍스트를 4 섹션·16 슬롯 JSON 으로 구조화합니다.

[원칙]
1. 원문에 적힌 내용 그대로 옮깁니다. 추측·요약·재작성 금지.
2. 슬롯에 해당하는 내용이 원문에 없으면 `value` 를 빈 문자열로 둡니다.
3. 사용자의 PII (성명·주민번호·계좌·주소) 가 입력에 있어도 그대로 둡니다(별도 마스킹 처리는 시스템이 담당).

[출력 JSON 스키마 — 반드시 이 구조 유지]
```json
{
  "당사자정보": {
    "사업주": {"value": "", "note": ""},
    "노무제공자": {"value": "", "note": ""},
    "적용직종": {"value": "", "note": ""}
  },
  "계약기본": {
    "계약기간": {"value": "", "note": ""},
    "노무제공장소": {"value": "", "note": ""},
    "업무내용": {"value": "", "note": ""},
    "노무제공방식": {"value": "", "note": ""}
  },
  "보수및사회보험": {
    "보수": {"value": "", "note": ""},
    "보수지급일": {"value": "", "note": ""},
    "산재보험": {"value": "", "note": ""},
    "고용보험": {"value": "", "note": ""}
  },
  "보호및분쟁": {
    "안전보건의무": {"value": "", "note": ""},
    "계약해지": {"value": "", "note": ""},
    "손해배상책임": {"value": "", "note": ""},
    "분쟁해결": {"value": "", "note": ""},
    "근로자성위장방지": {"value": "", "note": ""}
  },
  "기타사항": []
}
```

[note 필드 사용 규칙]
- 원문에 모호하거나 일방적인 표현이 보이면 그 표현을 `note` 에 적습니다 (예: "회사가 언제든지 해지 가능").
- `note` 는 한 줄로 짧게.

[기타사항]
- 16 슬롯에 명확히 매핑되지 않는 의미 있는 조항은 `기타사항` 배열에 객체 `{"항목": "...", "내용": "..."}` 로 추가.
"""


def build_structure_user_prompt(text: str) -> str:
    return (
        "다음 노무제공자 계약서 텍스트를 4 섹션·16 슬롯 JSON 으로 구조화해 주세요.\n\n"
        "===== 계약서 원문 =====\n"
        f"{text}\n"
        "===== 끝 =====\n"
    )


# ─── 분석 (구조화 + 컨텍스트 → 위반 분석) ───────────────────────
_ANALYZE_TEMPLATE = """\
당신은 한국 노동법(노무제공자·특고·플랫폼 종사자) 전문 검토 AI 입니다.
사업주가 자율점검을 위해 노무제공자 계약서를 검토합니다. 다음 16 슬롯 기준으로 검토하고
표준 JSON 으로 답하세요.

[핵심 원칙]
- 노무제공자는 근로기준법상 근로자가 아닙니다 (도급·위임).
- 산재보험법 제125조 적용 16개 직종은 산재보험 의무 가입 (사업주 100% 부담).
- 고용보험법 제77조의2 적용 19개 직종은 고용보험 의무 가입 (보험료 50:50 분담).
- "근로자성 위장" — 형식은 도급이지만 실질이 종속관계면 법원이 근로자로 판단 → 사업주에게도 큰 위험.
- 일방적 해지권, 무한 손해배상, 종속성 강화 표현(출퇴근 시간·취업규칙 준수 등) 은 부적절.

[검토 슬롯 16 (YAML 카탈로그)]
{slot_catalog}

[금지 표현 예시 — 검출 시 부적절 처리]
{prohibited_patterns}

[출력 JSON 스키마]
```json
{{
  "riskLevel": "상/중/하",
  "overallStatus": "위험/보완필요/적정",
  "overallOpinion": "전반 검토 총평 (2~3 문장)",
  "results": [
    {{
      "슬롯ID": "SLOT_SC_07_노무제공_방식",
      "항목": "노무제공 방식 (자율성 보장)",
      "적용조건": "any / 산재적용_특고16 / 고용보험_노무제공자19",
      "적절성": "적절/부적절/보완필요",
      "발견내용": "원문에서 발견한 표현·문구·기재 여부",
      "판단이유": "왜 그렇게 판단했는지 (법령·종속성 등 근거)",
      "법적근거": "산재보험법 제125조 / 대법원 2006다17287 등",
      "개선권고": "이렇게 고치면 좋다는 구체적 표현",
      "심각도": "HIGH/MEDIUM/LOW"
    }}
  ],
  "finalRecommendations": "전체적으로 가장 시급한 시정 1~3개를 묶어 권고"
}}
```

[규칙]
- 16 개 슬롯을 모두 results 배열에 포함하세요 (원문에 없는 슬롯은 적절성='부적절', 발견내용='기재 없음' 으로).
- "적절성" 은 정확히 ['적절', '부적절', '보완필요'] 중 하나.
- "심각도" 는 YAML missing_severity 또는 violation_severity 중 큰 쪽을 따릅니다.
- 사회보험(산재·고용) 슬롯은 사업장이 해당 직종이 아닐 수도 있으니, 적용직종 슬롯 값을 보고 판단하세요.
"""


def _format_slot_catalog(slots: list[dict[str, Any]]) -> str:
    """슬롯 카탈로그를 LLM 이 읽기 쉬운 형태로 직렬화."""
    lines = []
    for s in slots:
        sid = s.get("slot_id")
        field = s.get("field")
        req = s.get("required_content", "")
        purpose = s.get("purpose", "")
        ms = s.get("missing_severity", "")
        vs = s.get("violation_severity", "")
        laws = ", ".join(s.get("laws", []) or [])
        lines.append(
            f"- {sid} · {field}\n"
            f"  필수: {req}\n"
            f"  목적: {purpose}\n"
            f"  법령: {laws}\n"
            f"  심각도(미기재/부적절): {ms}/{vs}"
        )
    return "\n".join(lines)


def _format_prohibited_patterns(slots: list[dict[str, Any]]) -> str:
    """금지 표현이 정의된 슬롯만 모아 출력."""
    lines = []
    for s in slots:
        pps = s.get("prohibited_patterns") or []
        if not pps:
            continue
        sid = s.get("slot_id")
        for pp in pps:
            lines.append(f'  - [{sid}] "{pp}"')
    return "\n".join(lines) if lines else "  (없음)"


def get_analysis_prompt() -> str:
    """슬롯 카탈로그 + 금지 표현을 인라인한 system prompt."""
    slots = _load_slots()
    return _ANALYZE_TEMPLATE.format(
        slot_catalog=_format_slot_catalog(slots),
        prohibited_patterns=_format_prohibited_patterns(slots),
    )


def build_analyze_user_prompt(
    structured_data: dict[str, Any],
    *,
    worker_subtype: str = "",
    business_size: str = "",
) -> str:
    ctx_lines = []
    if worker_subtype:
        ctx_lines.append(f"노무제공자 직종 분류: {worker_subtype}")
    if business_size:
        ctx_lines.append(f"사업장 규모: {business_size}")
    ctx = "\n".join(ctx_lines) or "(컨텍스트 없음)"

    return (
        "다음 구조화 계약서 JSON 을 위 16 슬롯 기준으로 검토하고 결과 JSON 으로 응답하세요.\n\n"
        f"[사용자 컨텍스트]\n{ctx}\n\n"
        "===== 구조화 계약서 =====\n"
        f"{json.dumps(structured_data, ensure_ascii=False, indent=2)}\n"
        "===== 끝 =====\n"
    )


# ─── 공통 helper ───────────────────────────────────────────────
def safe_json_parse(raw: str, default: Any = None) -> Any:
    """LLM 응답에서 JSON 부분만 추출해 파싱.

    재시도 없이 한 번만. 실패 시 default 반환.
    """
    if not raw:
        return default
    # ```json ... ``` 블록 우선
    m = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", raw, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # 첫 { 부터 마지막 } 까지
    s, e = raw.find("{"), raw.rfind("}")
    if s >= 0 and e > s:
        try:
            return json.loads(raw[s : e + 1])
        except Exception:
            pass
    try:
        return json.loads(raw)
    except Exception:
        return default
