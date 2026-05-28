"""🕸 관계 그래프 탭 — 슬롯·조·주제·법령 노드/엣지 시각화.

이전: `06_🗂_데이터관계.py` 의 `tab_graph` 블록 (라인 78~494).
"""
from __future__ import annotations

import re

import networkx as nx
import plotly.graph_objects as go
import streamlit as st

from cgr.law_category import CATEGORY_COLOR, CATEGORY_EMOJI, classify_law_label


# 법령 추출 정규식 (penalty 안에서 "근로기준법 제X조" 같은 패턴)
_LAW_RE = re.compile(
    r"(근로기준법|남녀고용평등(?:과 일·가정 양립 지원에 관한)? ?법(?:률)?|산업안전보건법|근로자퇴직급여 ?보장법|"
    r"근로자의 ?날 ?제정에 ?관한 ?법률|고용상연령차별금지[가-힣]*법(?:률)?)\s*"
    r"(제\s*\d+조(?:의\d+)?(?:\s*제\s*\d+(?:항|호))*)"
)


def _extract_laws(penalty_list: list[str]) -> list[str]:
    """penalty 라인에서 "법령명 + 조항" 패턴을 뽑아 중복 제거."""
    laws = []
    for p in penalty_list or []:
        for m in _LAW_RE.finditer(str(p)):
            law_name = re.sub(r"\s+", " ", m.group(1)).strip()
            article = re.sub(r"\s+", "", m.group(2))
            laws.append(f"{law_name} {article}")
    return list(dict.fromkeys(laws))


# 노드 스타일 — 슬롯/조/주제 단일 색, 법령은 대분류별 색
_BASE_STYLE = {
    "slot":    {"color": "#60a5fa", "base_size": 8,  "max_size": 18, "symbol": "circle"},
    "article": {"color": "#f59e0b", "base_size": 12, "max_size": 24, "symbol": "diamond"},
    "topic":   {"color": "#22c55e", "base_size": 10, "max_size": 22, "symbol": "square"},
}
_LAW_SYMBOL = "star"
_LAW_BASE_SIZE = 10
_LAW_MAX_SIZE = 22


def render(slots, db, hist_rows) -> None:
    """관계 그래프 탭 렌더."""
    _ = hist_rows  # 미사용 (시그니처 통일을 위해 받기만 함)

    st.markdown("### 🕸 슬롯 ↔ 조 ↔ 주제 ↔ 법령 관계 그래프")
    st.caption(
        "노드 hover → 정보 미리보기 · 노드 클릭(또는 직접 선택) → 상세. "
        "전체 모드는 정보가 많아 **포커스 모드**(한 노드 주변만) 권장."
    )

    # ─── 보기 모드 ───────────────────
    view_mode = st.radio(
        "보기 모드",
        ["🎯 포커스 (한 노드 + 이웃만)", "🌐 전체 (모든 노드)"],
        horizontal=True,
        index=0,
        help="포커스 모드는 한 번에 한 영역만 — 가독성 ↑ / 전체 모드는 그래프 전체 구조 파악용",
    )
    is_focus = view_mode.startswith("🎯")

    # ─── 공통 필터 ───────────────────
    fc1, fc2, fc3 = st.columns([1, 1, 2.5])
    show_topic = fc1.checkbox("🏷 주제", value=True)
    show_law = fc2.checkbox("⚖️ 법령", value=True)
    law_categories_filter = fc3.multiselect(
        "법령 대분류 (선택 시 해당만)",
        ["개별법", "산안법", "단체법", "기타"],
        default=[],
        help="비워두면 모두 표시",
    )

    # ─── 그래프 구성 ──────────────────
    G = _build_graph(slots, db, show_topic, show_law, law_categories_filter)

    # ─── 포커스 모드: 중심 노드 선택 ────
    focus_node = None
    if is_focus and G.number_of_nodes() > 0:
        focus_node, G = _apply_focus(G)

    st.caption(
        f"📊 노드 **{G.number_of_nodes()}**개 · 엣지 **{G.number_of_edges()}**개"
        + (f" · 🎯 중심: `{focus_node}`" if focus_node else "")
    )

    if G.number_of_nodes() == 0:
        st.info("필터된 노드가 없습니다.")
        return

    # ─── 라벨 표시 옵션 ──────────
    lc1, _lc2 = st.columns([1, 3])
    label_mode = lc1.radio(
        "라벨 표시",
        ["허브만", "전체", "없음"],
        index=0,
        horizontal=True,
        help="허브만: 연결 많은 상위 10개 / 전체: 모든 노드 / 없음: hover 시에만",
    )

    pos, degrees, top_hubs = _compute_layout(G)

    fig, node_ids = _build_figure(G, pos, degrees, top_hubs, label_mode)

    event = st.plotly_chart(fig, use_container_width=True, on_select="rerun", selection_mode="points")

    # ─── 노드 클릭 상세 ──────────────
    _render_node_detail(event, node_ids, G, db)


# ════════════════════════════════════════
# Helpers
# ════════════════════════════════════════
def _build_graph(slots, db, show_topic, show_law, law_categories_filter):
    G = nx.Graph()
    for s in slots:
        slot_id = s.slot_id
        G.add_node(
            slot_id,
            kind="slot",
            label=slot_id,
            article=s.article,
            comparator=s.comparator,
            severity=s.violation_severity or "",
            extract_target=(s.extract_target or "")[:300],
            search_phrases=" / ".join(s.search_phrases or []),
        )
        art_label = f"제{s.article}조 {db.title(s.article) or ''}"
        if art_label not in G:
            G.add_node(
                art_label,
                kind="article",
                label=art_label,
                body=(db.body(s.article) or "")[:500],
            )
        G.add_edge(slot_id, art_label, kind="slot-article")

        if show_topic and s.topic_meta:
            for t in s.topic_meta:
                t_label = f"🏷 {t}"
                if t_label not in G:
                    G.add_node(t_label, kind="topic", label=t_label)
                G.add_edge(slot_id, t_label, kind="slot-topic")

        if show_law:
            for law in _extract_laws(s.penalty):
                law_label = f"⚖️ {law}"
                category = classify_law_label(law_label)
                if law_categories_filter and category not in law_categories_filter:
                    continue
                if law_label not in G:
                    G.add_node(law_label, kind="law", label=law_label, category=category)
                G.add_edge(slot_id, law_label, kind="slot-law")
    return G


def _apply_focus(G):
    """포커스 모드 — 중심 노드 + 이웃만 남긴 subgraph 반환."""
    all_nodes = sorted(G.nodes())
    slot_nodes = [n for n in all_nodes if G.nodes[n].get("kind") == "slot"]
    art_nodes = [n for n in all_nodes if G.nodes[n].get("kind") == "article"]
    topic_nodes = [n for n in all_nodes if G.nodes[n].get("kind") == "topic"]
    law_nodes = [n for n in all_nodes if G.nodes[n].get("kind") == "law"]

    fcc1, fcc2 = st.columns([1, 3])
    focus_kind = fcc1.selectbox(
        "중심 노드 종류",
        ["📋 조", "🏷 주제", "⚖️ 법령", "🔵 슬롯"],
        index=0,
    )
    kind_map = {
        "📋 조": art_nodes,
        "🏷 주제": topic_nodes,
        "⚖️ 법령": law_nodes,
        "🔵 슬롯": slot_nodes,
    }
    choices = kind_map[focus_kind]
    if not choices:
        fcc2.warning("해당 종류 노드 없음")
        return None, G

    focus_node = fcc2.selectbox(
        f"중심 노드 ({len(choices)}개 중 선택)",
        choices,
        key=f"focus_{focus_kind}",
    )
    depth = st.slider(
        "이웃 거리 (몇 단계까지 표시)",
        1, 3, 1,
        help="1=직접 연결 / 2=친구의 친구 / 3=3단계",
    )
    if focus_node:
        keep = set(nx.ego_graph(G, focus_node, radius=depth, undirected=True).nodes())
        G = G.subgraph(keep).copy()
    return focus_node, G


def _compute_layout(G):
    """노드 수에 따라 적응적 layout. degree 기반 허브 추출."""
    n_nodes = G.number_of_nodes()
    if n_nodes <= 50:
        try:
            pos = nx.kamada_kawai_layout(G)
        except Exception:
            pos = nx.spring_layout(G, k=2.0, seed=42, iterations=100)
    else:
        pos = nx.spring_layout(
            G,
            k=1.5 / (n_nodes ** 0.25),
            seed=42,
            iterations=100,
        )
    degrees = dict(G.degree())
    top_hubs = set(sorted(degrees, key=lambda x: -degrees[x])[:10])
    return pos, degrees, top_hubs


def _scaled_size(base: int, mx: int, deg: int, max_deg: int) -> int:
    """degree 비례 크기 — 최소 base, 최대 mx."""
    if max_deg <= 1:
        return base
    ratio = deg / max_deg
    return int(base + (mx - base) * ratio)


def _build_figure(G, pos, degrees, top_hubs, label_mode):
    max_deg = max(degrees.values()) if degrees else 1

    edge_x, edge_y = [], []
    for u, v in G.edges():
        x0, y0 = pos[u]
        x1, y1 = pos[v]
        edge_x.extend([x0, x1, None])
        edge_y.extend([y0, y1, None])

    edge_trace = go.Scatter(
        x=edge_x, y=edge_y, mode="lines",
        line=dict(width=0.5, color="#e2e8f0"),
        hoverinfo="none",
    )

    node_x, node_y, node_text, node_color, node_size, node_symbol, node_label = (
        [], [], [], [], [], [], []
    )
    node_ids = list(G.nodes())
    for n in node_ids:
        x, y = pos[n]
        d = G.nodes[n]
        kind = d.get("kind", "slot")
        deg = degrees.get(n, 0)
        node_x.append(x)
        node_y.append(y)

        if kind == "law":
            cat = d.get("category", "기타")
            node_color.append(CATEGORY_COLOR.get(cat, "#94a3b8"))
            node_size.append(_scaled_size(_LAW_BASE_SIZE, _LAW_MAX_SIZE, deg, max_deg))
            node_symbol.append(_LAW_SYMBOL)
        else:
            style = _BASE_STYLE[kind]
            node_color.append(style["color"])
            node_size.append(_scaled_size(style["base_size"], style["max_size"], deg, max_deg))
            node_symbol.append(style["symbol"])

        if kind == "slot":
            hover = (
                f"<b>{n}</b><br>"
                f"제{d.get('article')}조 · {d.get('comparator')} · sev={d.get('severity')}<br>"
                f"연결 {deg}개"
            )
            lab_short = n.replace("SLOT_", "")[:14]
        elif kind == "article":
            hover = f"<b>{n}</b><br>슬롯 {deg}개 매핑"
            lab_short = n[:16]
        elif kind == "law":
            cat = d.get("category", "기타")
            hover = (
                f"<b>{n}</b><br>"
                f"대분류: {CATEGORY_EMOJI.get(cat,'')} <b>{cat}</b><br>"
                f"인용 슬롯 {deg}개"
            )
            lab_short = n.replace("⚖️ ", "")[:16]
        else:
            hover = f"<b>{n}</b><br>슬롯 {deg}개"
            lab_short = n.replace("🏷 ", "")[:14]

        node_text.append(hover)

        if label_mode == "전체":
            node_label.append(lab_short)
        elif label_mode == "허브만":
            node_label.append(lab_short if n in top_hubs else "")
        else:
            node_label.append("")

    marker_mode = "markers" if label_mode == "없음" else "markers+text"

    node_trace = go.Scatter(
        x=node_x, y=node_y, mode=marker_mode,
        hoverinfo="text",
        hovertext=node_text,
        text=node_label if marker_mode == "markers+text" else None,
        textposition="top center",
        textfont=dict(size=10, color="#0f172a", family="Pretendard, sans-serif"),
        marker=dict(
            color=node_color,
            size=node_size,
            symbol=node_symbol,
            line=dict(width=1.2, color="#ffffff"),
            opacity=0.92,
        ),
        customdata=node_ids,
    )

    legend_traces = _build_legend(G)

    fig = go.Figure(data=[edge_trace, node_trace] + legend_traces)
    n_nodes = G.number_of_nodes()
    canvas_height = 800 if n_nodes > 100 else (700 if n_nodes > 30 else 550)
    fig.update_layout(
        showlegend=True,
        hovermode="closest",
        margin=dict(b=10, l=10, r=10, t=10),
        xaxis=dict(showgrid=False, zeroline=False, showticklabels=False, fixedrange=False),
        yaxis=dict(showgrid=False, zeroline=False, showticklabels=False, fixedrange=False),
        height=canvas_height,
        plot_bgcolor="#fafafa",
        paper_bgcolor="white",
        legend=dict(
            orientation="h",
            yanchor="bottom", y=1.02,
            xanchor="left", x=0,
            bgcolor="rgba(255,255,255,0.8)",
            bordercolor="#e2e8f0",
            borderwidth=1,
            font=dict(size=11),
        ),
        dragmode="pan",
    )
    return fig, node_ids


def _build_legend(G):
    """수동 범례 — 슬롯/조/주제 + 등장한 법령 대분류."""
    legend_traces = []
    for kind, label in [("slot", "🔵 슬롯"), ("article", "🟧 조"), ("topic", "🟩 주제")]:
        style = _BASE_STYLE[kind]
        legend_traces.append(
            go.Scatter(
                x=[None], y=[None],
                mode="markers",
                marker=dict(
                    color=style["color"],
                    size=style["base_size"] + 2,
                    symbol=style["symbol"],
                ),
                showlegend=True,
                name=label,
            )
        )
    present_cats = set(
        d.get("category") for _, d in G.nodes(data=True) if d.get("kind") == "law"
    )
    for cat in ["개별법", "산안법", "단체법", "기타"]:
        if cat in present_cats:
            legend_traces.append(
                go.Scatter(
                    x=[None], y=[None],
                    mode="markers",
                    marker=dict(
                        color=CATEGORY_COLOR[cat],
                        size=_LAW_BASE_SIZE + 2,
                        symbol=_LAW_SYMBOL,
                    ),
                    showlegend=True,
                    name=f"{CATEGORY_EMOJI[cat]} {cat} (법령)",
                )
            )
    return legend_traces


def _render_node_detail(event, node_ids, G, db) -> None:
    """plotly selection 또는 직접 선택된 노드의 상세 표시."""
    st.markdown("#### 🖱 노드 선택 → 상세 보기")
    st.caption(
        "그래프에서 노드를 박스 선택(드래그) 또는 lasso 로 선택하면 아래에 상세 표시. "
        "단일 클릭은 hover 로 미리보기."
    )

    selected_points = []
    if hasattr(event, "selection") and event.selection.get("points"):
        selected_points = event.selection["points"]

    if not selected_points:
        options = ["(선택 안 함)"] + sorted(node_ids)
        sel = st.selectbox("또는 직접 선택 ↓", options)
        selected_node_names = [sel] if sel != "(선택 안 함)" else []
    else:
        selected_node_names = []
        for pt in selected_points:
            idx = pt.get("point_index")
            if idx is None or idx >= len(node_ids):
                continue
            selected_node_names.append(node_ids[idx])
        selected_node_names = list(dict.fromkeys(selected_node_names))

    for name in selected_node_names[:5]:
        d = G.nodes[name]
        kind = d.get("kind", "?")
        with st.expander(f"📌 [{kind}] {name}", expanded=True):
            if kind == "slot":
                _detail_slot(d, name, G)
            elif kind == "article":
                _detail_article(name, G, db)
            elif kind == "topic":
                _detail_topic(name, G)
            elif kind == "law":
                _detail_law(d, name, G)


def _detail_slot(d, name, G) -> None:
    st.markdown(
        f"**제{d.get('article')}조 · {d.get('comparator')} · severity={d.get('severity')}**"
    )
    st.markdown("**extract_target**")
    st.code(d.get("extract_target") or "(없음)", language="markdown")
    if d.get("search_phrases"):
        st.markdown("**search_phrases**")
        st.markdown(d["search_phrases"])
    neighbors = list(G.neighbors(name))
    if neighbors:
        st.markdown(f"**연결된 노드 ({len(neighbors)}개)**")
        st.markdown(" · ".join(neighbors))


def _detail_article(name, G, db) -> None:
    from cgr.penalty_parser import format_for_user

    st.markdown(f"**{name}**")
    art_num = int(name.replace("제", "").split("조")[0]) if "조" in name else None
    if art_num:
        art = db.article(art_num)
        if art:
            st.markdown("**📄 표준 본문**")
            st.code(art.get("body", "") or "(없음)", language="text")
            st.markdown("**🚫 벌칙**")
            penalty_raw = art.get("penalty") or ""
            lines = [l.strip() for l in penalty_raw.splitlines() if l.strip()]
            parts = format_for_user(lines)
            if parts["omission"]:
                st.markdown("📋 *취업규칙 미기재 시*")
                for p in parts["omission"]:
                    st.markdown(f"- {p}")
            if parts["violation"]:
                st.markdown("⚖️ *법령 위반 시*")
                for p in parts["violation"]:
                    st.markdown(f"- {p}")
    mapped = [n for n in G.neighbors(name) if G.nodes[n].get("kind") == "slot"]
    if mapped:
        st.markdown(f"**매핑된 슬롯 ({len(mapped)}개)**")
        for m in mapped[:20]:
            st.markdown(f"- `{m}`")


def _detail_topic(name, G) -> None:
    related = list(G.neighbors(name))
    st.markdown(f"**주제 노드** — 연결된 슬롯 **{len(related)}**개")
    for r in related:
        if G.nodes[r].get("kind") == "slot":
            st.markdown(f"- `{r}` (제{G.nodes[r].get('article')}조)")


def _detail_law(d, name, G) -> None:
    cat = d.get("category", "기타")
    st.markdown(f"**대분류**: {CATEGORY_EMOJI.get(cat,'')} **{cat}**")
    related = list(G.neighbors(name))
    st.markdown(f"**법령 노드** — 인용된 슬롯 **{len(related)}**개")
    for r in related:
        if G.nodes[r].get("kind") == "slot":
            st.markdown(f"- `{r}` (제{G.nodes[r].get('article')}조)")
