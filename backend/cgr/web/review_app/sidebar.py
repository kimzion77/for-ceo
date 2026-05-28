"""검토 앱 사이드바 — 환경·DB·캐시·토픽·카탈로그.

호출: `from cgr.web.review_app.sidebar import render_sidebar; render_sidebar(catalog_path)`
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

import streamlit as st

from cgr import llm_cache
from cgr.config import get_api_key, get_embed_model, get_llm_model
from cgr.master_db import get_master_db
from cgr.topic_db import get_topic_db


def render_sidebar(catalog_path: Path) -> None:
    """사이드바 5개 섹션 렌더 (환경/마스터DB/캐시/토픽/카탈로그)."""
    with st.sidebar:
        _section_env()
        st.divider()
        _section_master_db()
        st.divider()
        _section_cache()
        st.divider()
        _section_topic_db()
        st.divider()
        _section_catalog(catalog_path)


def _section_env() -> None:
    st.markdown("### ⚙️ 환경")
    api_key = get_api_key()
    if api_key:
        st.success(f"OpenAI Key: …{api_key[-6:]}")
    else:
        st.error("OpenAI API Key 미설정")
    st.caption(f"LLM 모델: `{get_llm_model()}`")
    st.caption(f"임베딩: `{get_embed_model()}`")


def _section_master_db() -> None:
    st.markdown("### 📚 마스터 DB")
    try:
        db = get_master_db()
        st.success(f"로드 완료 ({len(db.all_articles())}개 조)")
        st.caption(f"경로: `{db.path}`")
    except Exception as e:
        st.error(f"로드 실패: {e}")


def _section_cache() -> None:
    st.markdown("### 💾 LLM 캐시")
    try:
        cs = llm_cache.stats()
        st.caption(f"항목 {cs['entries']:,}개 · {cs['size_kb']:,} KB")
        if st.button("🗑 캐시 비우기", use_container_width=True):
            n = llm_cache.clear()
            st.success(f"{n}개 삭제")
            st.rerun()
    except Exception as e:
        st.caption(f"캐시 상태 조회 실패: {e}")


def _section_topic_db() -> None:
    st.markdown("### 📚 토픽 DB")
    try:
        tdb = get_topic_db()
        if len(tdb) > 0:
            st.success(f"{len(tdb)}개 섹션 / {len(tdb.topic_names())}개 토픽")
            st.caption(f"경로: `{tdb.path.name}`")
        else:
            st.warning("토픽 인덱스 비어있음 — scripts/build_topic_index.py 실행 필요")
    except Exception as e:
        st.warning(f"토픽 로드 실패: {e}")


def _section_catalog(catalog_path: Path) -> None:
    st.markdown("### 📋 슬롯 카탈로그")
    if not catalog_path.exists():
        st.warning("카탈로그 파일 없음")
        return
    try:
        from cgr.catalog import load_catalog

        cat = load_catalog(catalog_path)
        comp = Counter(s.comparator for s in cat.slots)
        st.success(f"{len(cat.slots)}개 슬롯")
        for k, v in sorted(comp.items()):
            st.caption(f"`{k}`: {v}")
    except Exception as e:
        st.warning(f"파싱 오류: {e}")
