'use client';

import type { WsPayslipForm, WagePayLine } from '@/lib/api/ws';
import styles from './WsPayslipFormView.module.css';

/**
 * 공식 임금명세서 서식(고용노동부 표준)을 HTML 로 재현해 각 칸에 값을 채우는 뷰.
 *
 * 구조화 생성(`/ws/generate-form`) 결과를 그대로 바인딩한다.
 * 분석에서 보완된 항목/칸은 `supplemented` / `supplementedFields` 로 표시해 하이라이트.
 */

interface Props {
  form: WsPayslipForm;
}

const won = (v?: string) => {
  const s = (v ?? '').trim();
  if (!s) return '';
  // 이미 콤마/원 표기면 그대로, 숫자만이면 원 추가
  return /[원,]/.test(s) ? s : `${s}원`;
};

function isSup(form: WsPayslipForm, key: string): boolean {
  return Array.isArray(form.supplementedFields) && form.supplementedFields.includes(key);
}

function Field({
  label,
  value,
  sup,
}: {
  label: string;
  value?: string;
  sup?: boolean;
}) {
  return (
    <div className={`${styles.field} ${sup ? styles.fieldSup : ''}`}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>
        {value && value.trim() ? value : <em className={styles.empty}>—</em>}
        {sup && <span className={styles.supBadge}>보완</span>}
      </span>
    </div>
  );
}

function LineTable({
  title,
  lines,
  total,
  totalLabel,
}: {
  title: string;
  lines: WagePayLine[];
  total?: string;
  totalLabel: string;
}) {
  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableTitle}>{title}</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.colName}>항목</th>
            <th className={styles.colAmt}>금액</th>
            <th className={styles.colBasis}>계산방법·비고</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={3} className={styles.emptyRow}>
                기재된 항목이 없습니다
              </td>
            </tr>
          ) : (
            lines.map((l, i) => (
              <tr
                key={`${l.name}-${i}`}
                className={l.supplemented ? styles.rowSup : ''}
              >
                <td className={styles.colName}>
                  {l.name}
                  {l.supplemented && <span className={styles.supBadge}>보완</span>}
                </td>
                <td className={styles.colAmt}>{won(l.amount)}</td>
                <td className={styles.colBasis}>{l.basis || ''}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className={styles.colName}>
              <strong>{totalLabel}</strong>
            </td>
            <td className={styles.colAmt}>
              <strong>{won(total)}</strong>
            </td>
            <td className={styles.colBasis} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function WsPayslipFormView({ form }: Props) {
  const w = form.worker || {};
  const e = form.employer || {};
  const t = form.workTime || {};

  return (
    <div className={styles.sheet}>
      <h2 className={styles.docTitle}>임 금 명 세 서</h2>

      {/* 상단 메타 */}
      <div className={styles.metaGrid}>
        <Field label="산정 기간" value={form.settlementPeriod} sup={isSup(form, 'settlementPeriod')} />
        <Field label="지급일" value={form.paymentDate} sup={isSup(form, 'paymentDate')} />
        <Field label="교부 방식" value={form.deliveryMethod} sup={isSup(form, 'deliveryMethod')} />
      </div>

      {/* 사용자 / 근로자 정보 */}
      <div className={styles.twoCol}>
        <section className={`${styles.infoBox} ${isSup(form, 'employer') ? styles.boxSup : ''}`}>
          <div className={styles.boxHead}>
            사용자(사업자) 정보
            {isSup(form, 'employer') && <span className={styles.supBadge}>보완</span>}
          </div>
          <Field label="상호" value={e.company} />
          <Field label="사업자등록번호" value={e.businessNo} />
          <Field label="대표자" value={e.ceo} />
          <Field label="주소" value={e.address} />
        </section>

        <section className={`${styles.infoBox} ${isSup(form, 'worker') ? styles.boxSup : ''}`}>
          <div className={styles.boxHead}>
            근로자 정보
            {isSup(form, 'worker') && <span className={styles.supBadge}>보완</span>}
          </div>
          <Field label="성명" value={w.name} />
          <Field label="사번/생년월일" value={w.idOrBirth} />
          <Field label="부서" value={w.dept} />
          <Field label="직급" value={w.position} />
        </section>
      </div>

      {/* 근로시간 */}
      <div className={`${styles.workTime} ${isSup(form, 'workTime') ? styles.boxSup : ''}`}>
        <div className={styles.boxHead}>근로시간</div>
        <div className={styles.workTimeRow}>
          <Field label="근로일수" value={t.days} />
          <Field label="근로시간" value={t.hours} />
          <Field label="연장" value={t.overtime} />
          <Field label="야간" value={t.night} />
          <Field label="휴일" value={t.holiday} />
        </div>
      </div>

      {/* 지급 / 공제 */}
      <LineTable
        title="지급 내역"
        lines={form.payments || []}
        total={form.paymentTotal}
        totalLabel="지급 총액"
      />
      <LineTable
        title="공제 내역"
        lines={form.deductions || []}
        total={form.deductionTotal}
        totalLabel="공제 총액"
      />

      {/* 실수령액 */}
      <div className={styles.netRow}>
        <span className={styles.netLabel}>실수령액</span>
        <span className={styles.netValue}>{won(form.netPay) || '—'}</span>
      </div>

      {/* 비고 */}
      {Array.isArray(form.notes) && form.notes.length > 0 && (
        <div className={styles.notes}>
          <div className={styles.notesHead}>비고 · 확인 사항</div>
          <ul>
            {form.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
