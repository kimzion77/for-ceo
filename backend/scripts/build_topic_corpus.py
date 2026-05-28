"""노무사회 obsidian 마크다운 → 주제 DB 코퍼스 JSON 추출.

입력:
  ../온톨로지구축/labor-law-ontology/data/knowledge/obsidian/02_주제_노하우/*.md
  (필요 시 04_체크리스트/ 도 포함 — 본 1차는 02 만)

출력:
  frontend/src/data/topicCorpus.json
  형식:
    {
      "DB_근로시간": {
        "2.1.1": {
          "title": "근로시간",
          "body": "근로시간이란 근로자가 사용자의 지휘·감독 아래에서..."
        },
        ...
      },
      ...
    }

호버 시 frontend `lookupLawExcerpt` 가 이 corpus 를 우선 참조.

마크다운 형식 (관찰):
  - `# 근로시간` — 주제 제목 (파일 첫 헤더)
  - `## §2.1.1 근로시간이란 ...` — 섹션. `§N.N.N` 이 키, 그 뒤가 본문 첫 줄
  - `## §2.1` 같이 본문 없는 그룹 헤더도 있음 — body 가 비어있으면 skip
"""
from __future__ import annotations

import json
import re
from pathlib import Path

# 절대 경로로 박음 — workspace 가 "1. 영세사업장 자율점검" 안.
WORKSPACE = Path(
    r"C:\Users\Jini\Desktop\1. 영세사업장 자율점검"
)
SRC = (
    WORKSPACE
    / "온톨로지구축"
    / "labor-law-ontology"
    / "data"
    / "knowledge"
    / "obsidian"
    / "02_주제_노하우"
)
DST = (
    WORKSPACE / "3. 취업규칙" / "frontend" / "src" / "data" / "topicCorpus.json"
)

SECTION_RE = re.compile(r"^##\s*§\s*(\d+(?:\.\d+)*)\s+(.*)$")
LIST_PREFIX_RE = re.compile(r"^\s*[-*]\s*")


def parse_markdown(path: Path) -> dict[str, dict[str, str]]:
    """단일 .md → { section: { title, body } }."""
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    sections: dict[str, dict[str, str]] = {}

    cur_key: str | None = None
    cur_lines: list[str] = []

    def flush():
        nonlocal cur_key, cur_lines
        if cur_key is None:
            return
        # body 텍스트 합치기 — 빈 줄 정리
        body_lines: list[str] = []
        for raw in cur_lines:
            stripped = raw.rstrip()
            if not stripped:
                if body_lines and body_lines[-1] != "":
                    body_lines.append("")
                continue
            # 마크다운 list bullet 은 본문 그대로
            body_lines.append(stripped)
        body = "\n".join(body_lines).strip()
        # 너무 짧은 (그룹 헤더 본문 한 줄) 도 일단 저장 — 호버 시 그것조차 도움
        if body:
            sections[cur_key] = {
                "title": cur_lines[0].strip() if cur_lines else "",
                "body": body,
            }
        cur_key = None
        cur_lines = []

    for line in lines:
        m = SECTION_RE.match(line)
        if m:
            flush()
            cur_key = m.group(1)
            # 헤더 줄의 본문 부분도 body 의 첫 줄로
            cur_lines = [m.group(2).strip()]
            continue
        # 새 H2 ('## ' for 다른 영역) 만나면 flush
        if line.startswith("## ") and cur_key is not None:
            flush()
            continue
        if cur_key is not None:
            cur_lines.append(line)

    flush()
    return sections


def topic_name_to_db(name: str) -> str:
    """`근로시간.md` → `DB_근로시간`. 공백·괄호 등 제거 통일."""
    # 파일명에서 _ 뒤 데이터 표기 제거 (예: 임금대장-임금명세서_울_250730)
    base = name.split("_")[0]
    return f"DB_{base}"


def main():
    if not SRC.exists():
        raise SystemExit(f"obsidian dir not found: {SRC}")
    corpus: dict[str, dict[str, dict[str, str]]] = {}
    for md in sorted(SRC.glob("*.md")):
        topic = md.stem  # 파일명 (확장자 제외)
        db = topic_name_to_db(topic)
        try:
            sections = parse_markdown(md)
        except Exception as e:
            print(f"  parse failed for {md.name}: {e}")
            continue
        if not sections:
            continue
        corpus[db] = sections
        print(f"  {topic}: {len(sections)} sections")

    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(
        json.dumps(corpus, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    total = sum(len(v) for v in corpus.values())
    print(f"\nwrote {DST} ({len(corpus)} topics, {total} sections)")
    print(f"file size: {DST.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
