/**
 * 매우 단순한 inline 마크다운 파서 — **bold** 만 처리.
 *
 * 백엔드/샘플 데이터의 reason 문자열에 `**핵심**` 형태로 마커가 들어오면
 * `<strong>` 으로 변환한다. 다른 마크다운 (italic, link, list) 은 지원하지 않음.
 *
 * 보안: HTML 직접 삽입 없이 React Fragment 로만 구성 → XSS 안전.
 */
import { Fragment, type ReactNode } from 'react';

const BOLD_RE = /\*\*([^*]+)\*\*/g;

export function renderBold(text: string): ReactNode {
  if (!text) return text;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(BOLD_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push(<Fragment key={key++}>{text.slice(lastIndex, start)}</Fragment>);
    }
    parts.push(<strong key={key++}>{match[1]}</strong>);
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }

  return parts.length > 0 ? parts : text;
}
