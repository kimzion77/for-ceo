'use client';

import { useEffect, useState } from 'react';

/**
 * 진행률·현재 단계 mock 훅.
 *
 * **설계**
 * - 단계 수 N → 진행률 구간 100/N% 씩으로 균등 분할
 * - 시간 기반으로 단조 증가하는 진행률 (선형)
 * - 단계 = `progress` 기반으로 계산 → 진행률·단계가 절대 어긋나지 않음
 *
 * 다음 단계에서 `GET /api/review/{id}/status` 폴링으로 교체될 때
 * `progress` 만 백엔드 값으로 갈아끼우면 단계 계산은 동일하게 동작한다.
 */
export interface ProgressState {
  /** 0~100 */
  progress: number;
  /** 1~totalSteps 사이의 활성 단계. 모두 끝났으면 totalSteps+1. */
  activeStep: number;
  /** 100 도달 여부. */
  done: boolean;
}

export interface UseMockProgressOptions {
  /** 단계 수 (기본 4). */
  totalSteps?: number;
  /** 0% → 100% 까지 걸리는 총 시간 ms (기본 9000). */
  totalDurationMs?: number;
  /** tick 주기 ms (기본 100 — 1초당 10번 갱신). */
  tickMs?: number;
}

export function useMockProgress(opts: UseMockProgressOptions = {}): ProgressState {
  const { totalSteps = 4, totalDurationMs = 9000, tickMs = 100 } = opts;

  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / totalDurationMs, 1);
      // 선형 — "전반적으로 쭈우욱" 동일 속도로 올라감
      setProgress(Math.round(ratio * 100));
      if (ratio >= 1) {
        window.clearInterval(id);
      }
    }, tickMs);
    return () => window.clearInterval(id);
  }, [totalDurationMs, tickMs]);

  // 진행률 → 활성 단계 (단계 사이 점프 없음, 진행률만 단조 증가)
  const stepSize = 100 / totalSteps;
  const activeStep =
    progress >= 100
      ? totalSteps + 1
      : Math.min(Math.floor(progress / stepSize) + 1, totalSteps);

  return {
    progress,
    activeStep,
    done: progress >= 100,
  };
}
