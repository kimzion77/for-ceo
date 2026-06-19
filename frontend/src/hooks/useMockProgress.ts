'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 진행률·현재 단계 mock 훅 (구간 점근형).
 *
 * **설계 — "연속처럼 보이는" 진행률**
 * 전체 검토 흐름은 사용자 확인 페이지를 사이에 두고 여러 로딩 인스턴스로
 * 쪼개진다(추출→[확인]→분석→[확인]→생성). 각 인스턴스를 0% 부터 다시
 * 시작하면 "9%→100%→6%" 처럼 튄다. 그래서:
 *
 * - 각 인스턴스는 0 이 아니라 **자기 매크로 구간의 하한(`segLo`)** 에서 시작.
 * - 구간 안에서는 **점근 곡선**(빠르게 오르다 92% 지점에서 멈춤)으로 차오름 →
 *   백엔드가 빠르면 일찍 끝나고, 느려도 92% 에서 자연스럽게 대기.
 * - 페이지 이동 직전 호출부가 `snapTo=segHi` 로 구간 상한까지 끌어올림 →
 *   다음 인스턴스가 그 상한부터 이어받아 **단조 증가**(역행·점프 없음).
 *
 * opts 는 ref 로 보관하고 effect deps 를 `[tickMs]` 로 고정해, phase/config 가
 * 바뀌어도 타이머가 재시작·리셋되지 않는다(기존 진행률 0% 리셋 버그 제거).
 */
export interface ProgressState {
  /** 0~100 정수 */
  progress: number;
  /** 1~totalSteps 사이의 활성 단계. 구간을 다 채우면 totalSteps+1. */
  activeStep: number;
  /** 100 도달 여부. */
  done: boolean;
}

export interface UseMockProgressOptions {
  /** 이 구간의 하한 % — 진행률이 이 값에서 시작. 기본 0. */
  segLo?: number;
  /** 이 구간의 상한 % — 점근의 목표(92% 까지만 차오름). 기본 100. */
  segHi?: number;
  /** 구간을 (거의) 채우는 데 걸리는 체감 시간 ms. 기본 12000. */
  segDurationMs?: number;
  /** 설정되면 target 을 이 값으로 즉시 끌어올림(완료 스냅). 기본 null. */
  snapTo?: number | null;
  /** 구간 내 세부 단계 수 (activeStep 계산용). 기본 4. */
  totalSteps?: number;
  /** tick 주기 ms (기본 100 — 1초당 10번 갱신). */
  tickMs?: number;
}

export function useMockProgress(opts: UseMockProgressOptions = {}): ProgressState {
  const {
    segLo = 0,
    segHi = 100,
    segDurationMs = 12000,
    snapTo = null,
    totalSteps = 4,
    tickMs = 100,
  } = opts;

  // 매 렌더 최신 opts 를 ref 로 보관 — interval deps 를 [tickMs] 로 고정해
  // phase/config 가 바뀌어도 timer 가 재시작·리셋되지 않게 한다.
  const optsRef = useRef({ segLo, segHi, segDurationMs, snapTo });
  optsRef.current = { segLo, segHi, segDurationMs, snapTo };

  // 시작값은 0 이 아니라 자기 구간 하한 — 이전 구간에서 이어받은 연속감.
  const [progress, setProgress] = useState<number>(() => segLo);

  useEffect(() => {
    let segKey = optsRef.current.segLo;
    let segStartAt = Date.now();
    const id = window.setInterval(() => {
      const o = optsRef.current;
      // 구간이 바뀌면(다음 매크로로 전진) 점근 타이머를 리셋해
      // 새 구간을 처음부터 다시 빠르게 차오르게 한다.
      if (o.segLo !== segKey) {
        segKey = o.segLo;
        segStartAt = Date.now();
      }
      const elapsed = Date.now() - segStartAt;
      const target =
        o.snapTo != null
          ? o.snapTo
          : o.segLo +
            (o.segHi - o.segLo) *
              Math.min(1 - Math.exp((-2.3 * elapsed) / o.segDurationMs), 0.92);
      // 단조 증가 — 절대 거꾸로 내려가지 않음.
      setProgress((prev) => (target > prev ? target : prev));
    }, tickMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickMs]);

  // 구간이 올라가면(segLo 증가) 첫 tick 전이라도 즉시 하한까지 보이게 한다 —
  // 매크로 전환 직후 "0%" 가 한 프레임 깜빡이는 것을 방지(단조성 유지).
  const shown = Math.max(progress, segLo);

  // 구간 로컬 비율로 세부 단계 계산 (진행률·단계가 절대 어긋나지 않음).
  const span = Math.max(segHi - segLo, 1);
  const local = Math.min(Math.max((shown - segLo) / span, 0), 1);
  const activeStep =
    shown >= segHi - 0.01
      ? totalSteps + 1
      : Math.min(Math.floor(local * totalSteps) + 1, totalSteps);

  return {
    progress: Math.round(shown),
    activeStep,
    done: shown >= 100 - 0.01,
  };
}
