/**
 * 마커 매칭 — 모바일 검토앱 전용 (데스크톱 page.tsx 헬퍼와 독립).
 *
 * 추출 텍스트(extractedText) 안에서 각 finding 의 위치를 찾아
 * 번호 동그라미 + 하이라이트를 꽂을 수 있도록 [index, length, no] 목록을 만든다.
 *
 * 전략 (EC 데스크톱 buildMarkerHits 와 동일):
 *  1) 후보 토큰 = [항목명(공백 유지/제거 변형), ...현재표현(now) 분할 조각]
 *     — 2자 이상, placeholder(미기재·없음·판독불가·해당없음·—·-) 제외
 *  2) 우선순위순으로 첫 번째 "겹치지 않는" indexOf 매칭을 채택
 *  3) 번호(no)는 findings 배열 인덱스+1 고정 — 목록·시트·수정본과 1:1
 *  4) 렌더 편의를 위해 위치순 정렬해 반환
 */
import type { MobileFinding } from './MobileReviewApp';

export interface MobileMarkerHit {
  /** 본문 내 시작 위치. */
  index: number;
  /** 매칭된 토큰 길이. */
  length: number;
  /** 표시 번호 — findings 인덱스 + 1. */
  no: number;
}

const SKIP_PLACEHOLDER = /^(미기재|없음|판독불가|해당없음|—|-)$/;

/** finding 하나의 본문 매칭 후보 토큰 — 우선순위순. */
function candidateTokens(f: MobileFinding): string[] {
  const tokens: string[] = [];

  // 1) 항목명 — 공백 유지 / 공백 제거 두 변형
  if (f.name) {
    const t = f.name.trim();
    if (t.length >= 2 && !SKIP_PLACEHOLDER.test(t)) {
      tokens.push(t);
      const nospace = t.replace(/\s+/g, '');
      if (nospace !== t && nospace.length >= 2) tokens.push(nospace);
    }
  }

  // 2) 현재 표현(now) 분할 — fallback
  for (const piece of (f.now || '').split(/[\s,;:·/()\n\r"']+/)) {
    const s = piece.trim();
    if (s.length >= 2 && !SKIP_PLACEHOLDER.test(s) && !tokens.includes(s)) {
      tokens.push(s);
    }
  }
  return tokens;
}

/**
 * 본문 텍스트에서 각 finding 의 첫 비중첩 매칭 위치를 찾는다.
 * 매칭 실패한 finding 은 결과에서 빠진다 (목록·시트에는 그대로 존재).
 */
export function matchMarkers(
  text: string,
  findings: MobileFinding[],
): MobileMarkerHit[] {
  if (!text) return [];
  const used: Array<[number, number]> = [];
  const hits: MobileMarkerHit[] = [];

  findings.forEach((f, idx) => {
    const tokens = candidateTokens(f);
    let best: { index: number; length: number } | null = null;
    for (const tok of tokens) {
      const i = text.indexOf(tok);
      if (i < 0) continue;
      const overlaps = used.some(([s, e]) => !(i + tok.length <= s || i >= e));
      if (overlaps) continue;
      best = { index: i, length: tok.length };
      break;
    }
    if (best) {
      hits.push({ ...best, no: idx + 1 });
      used.push([best.index, best.index + best.length]);
    }
  });

  // 본문 흐름대로 렌더하기 위해 위치순 정렬. 번호(no)는 그대로 유지.
  hits.sort((a, b) => a.index - b.index);
  return hits;
}
