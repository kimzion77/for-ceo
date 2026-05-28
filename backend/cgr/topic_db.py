"""TOPIC 메타데이터 — 단일 JSON 인덱스에서 즉시 조회.

소스: data/topic_index.json (2570 섹션, build_topic_index.py 로 생성)
구조: {"토픽이름 section_no": {"topic", "section_no", "title", "content"}}
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_INDEX_PATH = Path(__file__).parent.parent / "data" / "topic_index.json"


class TopicDB:
    def __init__(self, index_path: Path | None = None) -> None:
        self.path = index_path or _INDEX_PATH
        self._index: dict[str, dict[str, Any]] = {}
        if self.path.exists():
            self._index = json.loads(self.path.read_text(encoding="utf-8"))

    def topic_names(self) -> list[str]:
        names = sorted({v["topic"] for v in self._index.values()})
        return names

    def lookup(self, topic_meta: str) -> dict[str, Any] | None:
        """slot.topic_meta (예: '연차유급휴가 2.1.2') → {topic, section_no, title, content} or None."""
        if not topic_meta:
            return None
        key = topic_meta.strip()
        v = self._index.get(key)
        if v:
            return v
        # 정확 매치 실패 → prefix 매치 시도 (예: 2.1 → 2.1.1, 2.1.2 첫번째)
        m = key.rsplit(" ", 1)
        if len(m) == 2:
            topic, sec_prefix = m[0].strip(), m[1].strip()
            for k, vv in self._index.items():
                if vv["topic"] == topic and str(vv["section_no"]).startswith(sec_prefix):
                    return {**vv, "approx": True}
        return None

    def __len__(self) -> int:
        return len(self._index)


@lru_cache(maxsize=1)
def get_topic_db() -> TopicDB:
    return TopicDB()
