'use client';

/**
 * WsTypeConfirm — 임금명세서 "AI 계약 유형 1차 분류 → 사용자 확인" 배너.
 *
 * 분석(2차) 직전에, AI 가 명세서를 보고 추정한 계약 유형을 확인만 하게 한다.
 *  - 초기(asking): 'AI 판단 · {docKind}' + 유형 칩 + 근거 → [맞아요]/[아니에요]
 *  - 아니에요: 4유형(정규직/기간제/단시간/일용직) 중 하나 단일 선택 → '선택 완료'
 *  - 맞아요/선택 완료: 슬림 확정 바 + '변경'
 *
 * EC 의 ClassifyConfirm 과 시각 언어·CSS 를 공유하되 '단일 선택' 인 점만 다르다.
 */

import { useState } from 'react';

import { WS_CONTRACT_TYPES, type WsContractType } from '@/components/home/WorkplaceForm';

import styles from './ClassifyConfirm.module.css';

export interface WsTypeConfirmProps {
  /** 예: 'AI 판단: 기간제 임금명세서' 의 본문. */
  docKind: string;
  reason?: string;
  /** AI 가 추정한 계약 유형. */
  aiType: string;
  /** 현재 선택값 (controlled). */
  value: string;
  onChange: (type: string) => void;
  /** 맞아요(true)/아니에요(false) 클릭 시. */
  onConfirmed?: (ok: boolean) => void;
}

type Mode = 'asking' | 'editing' | 'confirmed';

function SparkleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3l1.8 4.6L18.5 9.4l-4.7 1.8L12 15.8l-1.8-4.6L5.5 9.4l4.7-1.8L12 3z" />
      <path d="M19 14l.9 2.3 2.3.9-2.3.9L19 20.4l-.9-2.3-2.3-.9 2.3-.9L19 14z" />
    </svg>
  );
}

export default function WsTypeConfirm({
  docKind,
  reason,
  aiType,
  value,
  onChange,
  onConfirmed,
}: WsTypeConfirmProps) {
  const [mode, setMode] = useState<Mode>('asking');

  const handleYes = () => {
    onChange(aiType);
    onConfirmed?.(true);
    setMode('confirmed');
  };

  const handleNo = () => {
    onConfirmed?.(false);
    setMode('editing');
  };

  // ── 확정 바 — 슬림 ──
  if (mode === 'confirmed') {
    return (
      <div className={styles.confirmedBar} role="status">
        <span className={styles.confirmedCheck} aria-hidden>
          ✓
        </span>
        <span className={styles.confirmedText}>
          {docKind}
          {value && <> · {value}</>}
        </span>
        <button
          type="button"
          className={styles.changeBtn}
          onClick={() => setMode('editing')}
        >
          변경
        </button>
      </div>
    );
  }

  // ── 수동 선택 (아니에요) — 단일 선택 ──
  if (mode === 'editing') {
    return (
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.icon} aria-hidden>
            <SparkleIcon />
          </span>
          <div className={styles.headText}>
            <div className={styles.line1}>계약 유형을 골라주세요</div>
            <div className={styles.helper}>
              명세서 분석 기준이 돼요. 하나만 선택하세요.
            </div>
          </div>
        </div>
        <div className={styles.chipGrid} role="group" aria-label="계약 유형 선택">
          {WS_CONTRACT_TYPES.map((t: WsContractType) => {
            const active = value === t;
            return (
              <button
                key={t}
                type="button"
                className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                aria-pressed={active}
                onClick={() => onChange(t)}
              >
                {t}
              </button>
            );
          })}
        </div>
        <div className={styles.editActions}>
          <button
            type="button"
            className={styles.btnBrand}
            disabled={!value}
            onClick={() => setMode('confirmed')}
          >
            선택 완료
          </button>
        </div>
      </div>
    );
  }

  // ── 초기 — AI 판단 확인 ──
  return (
    <div className={styles.card}>
      <div className={styles.askRow}>
        <span className={styles.icon} aria-hidden>
          <SparkleIcon />
        </span>
        <div className={styles.askBody}>
          <div className={styles.line1}>
            AI 판단 · <strong>{docKind}</strong>
          </div>
          <div className={styles.line2}>
            <span className={styles.miniChip}>{aiType}</span>
            {reason && <span className={styles.reason}>{reason}</span>}
          </div>
        </div>
        <div className={styles.askActions}>
          <button type="button" className={styles.btnBrand} onClick={handleYes}>
            맞아요
          </button>
          <button type="button" className={styles.btnGhost} onClick={handleNo}>
            아니에요
          </button>
        </div>
      </div>
    </div>
  );
}
