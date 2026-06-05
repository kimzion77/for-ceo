'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  getDutiesBySize,
  type SizeDuty,
} from '@/lib/api/guide';

import styles from './HomeGuidePreview.module.css';

interface HomeGuidePreviewProps {
  /** 사업장 규모 — `'5+' | '5-' | null`. WorkplaceForm 에서 받아 미리보기 분기. */
  businessSize?: '5+' | '5-' | null;
}

const SIZE_TO_LABEL: Record<string, string> = {
  '5+': '5인 이상',
  '5-': '1인 이상',
};

/**
 * 홈 페이지 하단 — 꿀팁 가이드 미리보기.
 *
 * 동작
 *  1. 첫 진입 시 overview KPI 4장
 *  2. 사용자가 사업장 규모 선택했으면 "내 규모 의무" 상위 5건 미리보기 추가
 *  3. "전체 가이드 보기 →" CTA → /guide 로
 */
export default function HomeGuidePreview({ businessSize }: HomeGuidePreviewProps) {
  const [duties, setDuties] = useState<SizeDuty[] | null>(null);
  const [loadingDuties, setLoadingDuties] = useState(false);

  useEffect(() => {
    if (!businessSize) {
      setDuties(null);
      return;
    }
    const label = SIZE_TO_LABEL[businessSize];
    if (!label) return;
    setLoadingDuties(true);
    getDutiesBySize(label)
      .then((r) => setDuties(r.duties.slice(0, 6)))
      .catch(() => setDuties([]))
      .finally(() => setLoadingDuties(false));
  }, [businessSize]);

  return (
    <section className={styles.section}>
      <div className={styles.head}>
        <div>
          <div className={styles.eyebrow}>꿀팁</div>
          <h2 className={styles.title}>알아두면 든든한 노무 가이드</h2>
          <p className={styles.subtitle}>
            검토 결과에서 막막한 부분이 있으면 가이드 챗봇에게 물어보세요.
          </p>
        </div>
        <Link href="/guide" className={styles.cta}>
          전체 가이드 보기 →
        </Link>
      </div>

      {/* 사업장 규모 선택 시 — 내 의무 미리보기 */}
      {businessSize && (
        <div className={styles.dutyBox}>
          <div className={styles.dutyHead}>
            <span className={styles.dutyBadge}>
              {businessSize === '5+' ? '5인 이상' : '1인 이상'} 사업장
            </span>
            <span className={styles.dutyTitle}>
              내 사업장이 챙겨야 할 의무
              {duties && (
                <span className={styles.dutyCount}> · {duties.length}건 미리보기</span>
              )}
            </span>
            <Link
              href="/guide"
              className={styles.dutyMore}
              aria-label="전체 보기"
            >
              전체 →
            </Link>
          </div>
          {loadingDuties ? (
            <div className={styles.dutyLoading}>의무 목록 가져오는 중…</div>
          ) : duties && duties.length > 0 ? (
            <ul className={styles.dutyList}>
              {duties.map((d) => (
                <li key={d.code} className={styles.dutyItem}>
                  <span className={styles.dutyMinSize}>{d.min_size}</span>
                  <div className={styles.dutyContent}>
                    <div className={styles.dutyName}>{d.duty}</div>
                    <div className={styles.dutyLaw}>{d.legal_basis}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.dutyEmpty}>의무 정보를 가져오지 못했어요.</div>
          )}
        </div>
      )}
    </section>
  );
}
