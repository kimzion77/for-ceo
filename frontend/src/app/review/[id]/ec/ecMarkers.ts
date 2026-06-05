import type { EcAnalysisItem } from '@/lib/api/types';

/**
 * 데스크톱(page.tsx)·모바일(MobileEcResult.tsx) 공용 마커 유틸.
 *
 * 본문(추출 텍스트)에서 finding 위치를 찾아 번호 동그라미 + 하이라이트로
 * 강조하기 위한 순수 함수들. styles·DOM 의존 없음 → 양쪽에서 import.
 */

export interface MarkerHit {
  index: number;
  length: number;
  token: string;
  finding: EcAnalysisItem;
  /** 목록/카드/시트와 동기화되는 번호(1-based). = findings 배열 인덱스 + 1. */
  no: number;
}

/**
 * finding 의 본문 매칭 후보 토큰을 우선순위순으로 추출.
 * 우선순위:
 *   1) 항목명 자체 (예: "임금", "근무 장소") — 가장 의미있는 위치
 *   2) 발견내용 split — placeholder 제외, 2자 이상
 *
 * "임금" finding 이 본문의 "임금" 단어 위치를 잡도록 — 발견내용의 흔한 단어
 * (예: "근로자") 가 앞 위치에 먼저 매칭되어 마커가 엉뚱한 곳으로 가는 것 방지.
 */
export function extractCandidateTokens(item: EcAnalysisItem): string[] {
  const tokens: string[] = [];
  const skip = /^(미기재|없음|판독불가|해당없음|—|-)$/;

  // 1) 항목명 — 공백 유지 / 공백 제거 두 변형
  if (item.항목) {
    const t = item.항목.trim();
    if (t.length >= 2 && !skip.test(t)) {
      tokens.push(t);
      const nospace = t.replace(/\s+/g, '');
      if (nospace !== t && nospace.length >= 2) tokens.push(nospace);
    }
  }

  // 2) 발견내용 split — fallback
  const found = item.발견내용 || '';
  for (const piece of found.split(/[\s,;:·\/\n\r]+/)) {
    const s = piece.trim();
    if (s.length >= 2 && !skip.test(s) && !tokens.includes(s)) {
      tokens.push(s);
    }
  }
  return tokens;
}

/**
 * findings 는 캐러셀/목록과 동일한 정렬(부적절→보완필요→적절) 순으로 들어와야 한다.
 * 각 finding 의 배열 인덱스를 그대로 마커 번호로 사용해 목록/카드와 일대일 매칭.
 */
export function buildMarkerHits(
  text: string,
  findings: EcAnalysisItem[],
): MarkerHit[] {
  const used: Array<[number, number]> = [];
  const hits: MarkerHit[] = [];
  findings.forEach((f, idx) => {
    const tokens = extractCandidateTokens(f);
    let best: { index: number; length: number; token: string } | null = null;
    // 우선순위순 (항목명 → 발견내용) — 첫 매칭이 곧 채택. 위치는 우선 아님.
    for (const tok of tokens) {
      const i = text.indexOf(tok);
      if (i < 0) continue;
      const overlaps = used.some(
        ([s, e]) => !(i + tok.length <= s || i >= e),
      );
      if (overlaps) continue;
      best = { index: i, length: tok.length, token: tok };
      break;
    }
    if (best) {
      hits.push({ ...best, finding: f, no: idx + 1 });
      used.push([best.index, best.index + best.length]);
    }
  });
  // 본문 흐름대로 렌더하기 위해 위치순 정렬. 단 번호(no)는 변경 X — 목록과 동기화.
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

/** finding 의 짧은 한 줄 라벨 (Note 용).
 *  '부적절' 을 무조건 '미기재' 로 표기하던 버그 수정 — 발견내용이 실제로
 *  비었을 때만 '미기재', 값이 있으면(예: 최저임금 미달) '부적절' 로 표기. */
export function shortNoteForFinding(f: EcAnalysisItem): string {
  const found = (f.발견내용 || '').trim();
  const isMissing =
    !found || /^(미기재|없음|누락|미작성|판독불가|해당없음|미상|—|-)$/.test(found);
  if (f.적절성 === '부적절') return isMissing ? `${f.항목} 미기재` : `${f.항목} 부적절`;
  if (f.적절성 === '보완필요') return `${f.항목} 보완 필요`;
  return f.항목;
}
