'use client';

import type { WsPayslipForm, WagePayLine } from '@/lib/api/ws';
import styles from './WsPayslipFormView.module.css';

/**
 * 고용노동부 표준 임금명세서 서식(공란)을 그대로 재현해 각 칸에 값을 채우는 뷰.
 * (backend/data/forms/임금명세서 서식(공란).hwp 레이아웃 기준)
 *
 * 구조: 제목(년·월) + 지급일 / 성명·사번·부서·직급 / 세부 내역(지급|공제 2단 +
 * 지급액계·공제액계·실지급액) / 계산 방법 / 하단 안내문.
 * 분석으로 보완된 항목은 '보완' 배지 + 행 하이라이트.
 */

interface Props {
  form: WsPayslipForm;
}

const numOnly = (v?: string) => (v ?? '').replace(/[^\d.-]/g, '');
const amt = (v?: string) => {
  const s = (v ?? '').trim();
  if (!s) return '';
  const n = numOnly(s);
  if (n && !Number.isNaN(Number(n))) return Number(n).toLocaleString('ko-KR');
  return s.replace(/원/g, '');
};

/** settlementPeriod 또는 paymentDate 에서 연·월 추출. */
function yearMonth(form: WsPayslipForm): { y: string; m: string } {
  const src = form.settlementPeriod || form.paymentDate || '';
  const mt = src.match(/(\d{4})\s*[-./년]\s*(\d{1,2})/);
  if (mt) return { y: mt[1], m: String(Number(mt[2])) };
  return { y: '', m: '' };
}

export default function WsPayslipFormView({ form }: Props) {
  const w = form.worker || {};
  const e = form.employer || {};
  const { y, m } = yearMonth(form);

  const pays: WagePayLine[] = form.payments || [];
  const deds: WagePayLine[] = form.deductions || [];
  const rowN = Math.max(pays.length, deds.length, 4);
  const rows = Array.from({ length: rowN }, (_, i) => ({
    pay: pays[i],
    ded: deds[i],
  }));

  // 계산 방법 — 산출식(basis)이 있는 지급 항목.
  const calcRows = pays.filter((p) => (p.basis || '').trim());

  const empW = [e.company, e.businessNo ? `(${e.businessNo})` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.sheet}>
      {/* 상단 회사 영역 (서식 상단 점선 박스) */}
      <div className={styles.companyBox}>{empW || ' '}</div>

      {/* 제목 + 지급일 */}
      <div className={styles.titleRow}>
        <h2 className={styles.docTitle}>
          {y || '____'} 년 {m || '__'} 월 임금명세서
        </h2>
        <div className={styles.payDate}>지급일 : {form.paymentDate || ''}</div>
      </div>

      {/* 성명·사번·부서·직급 */}
      <table className={styles.infoTable}>
        <tbody>
          <tr>
            <th>성명</th>
            <td>{w.name || ''}</td>
            <th>사번</th>
            <td>{w.idOrBirth || ''}</td>
          </tr>
          <tr>
            <th>부서</th>
            <td>{w.dept || ''}</td>
            <th>직급</th>
            <td>{w.position || ''}</td>
          </tr>
        </tbody>
      </table>

      {/* 세부 내역 */}
      <div className={styles.sectionHead}>세부 내역</div>
      <table className={styles.detailTable}>
        <thead>
          <tr className={styles.groupRow}>
            <th colSpan={2}>지 급</th>
            <th colSpan={2}>공 제</th>
          </tr>
          <tr className={styles.colRow}>
            <th>임금 항목</th>
            <th>지급 금액(원)</th>
            <th>공제 항목</th>
            <th>공제 금액(원)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={`${styles.itemName} ${r.pay?.supplemented ? styles.sup : ''}`}>
                {r.pay?.name || ''}
                {r.pay?.supplemented && <span className={styles.supBadge}>보완</span>}
              </td>
              <td className={`${styles.amtCell} ${r.pay?.supplemented ? styles.sup : ''}`}>
                {amt(r.pay?.amount)}
              </td>
              <td className={`${styles.itemName} ${r.ded?.supplemented ? styles.sup : ''}`}>
                {r.ded?.name || ''}
                {r.ded?.supplemented && <span className={styles.supBadge}>보완</span>}
              </td>
              <td className={`${styles.amtCell} ${r.ded?.supplemented ? styles.sup : ''}`}>
                {amt(r.ded?.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.totalRow}>
            <th>지급액 계</th>
            <td className={styles.amtCell}>{amt(form.paymentTotal)}</td>
            <th>공제액 계</th>
            <td className={styles.amtCell}>{amt(form.deductionTotal)}</td>
          </tr>
          <tr className={styles.netRow}>
            <td className={styles.blankCell} colSpan={2} />
            <th>실지급액</th>
            <td className={styles.amtCell}>{amt(form.netPay)}</td>
          </tr>
        </tfoot>
      </table>

      {/* 계산 방법 */}
      <div className={styles.sectionHead}>계산 방법</div>
      <table className={styles.calcTable}>
        <thead>
          <tr className={styles.colRow}>
            <th className={styles.calcGubun}>구분</th>
            <th>산출식 또는 산출방법</th>
            <th className={styles.calcAmt}>지급액(원)</th>
          </tr>
        </thead>
        <tbody>
          {calcRows.length === 0 ? (
            <tr>
              <td colSpan={3} className={styles.emptyRow}>
                별도 산출방법 기재 항목 없음
              </td>
            </tr>
          ) : (
            calcRows.map((p, i) => (
              <tr key={i}>
                <td className={p.supplemented ? styles.sup : ''}>
                  {p.name}
                  {p.supplemented && <span className={styles.supBadge}>보완</span>}
                </td>
                <td className={styles.calcBasis}>{p.basis}</td>
                <td className={styles.amtCell}>{amt(p.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className={styles.footnote}>
        ※ 가족수당은 취업규칙 등에 지급요건이 규정되어 있는 경우 계산방법을 기재하지
        않더라도 무방
      </div>

      {/* 보완·확인 메모 (서식 밖 보조 안내) */}
      {((form.notes && form.notes.length > 0) ||
        (form.supplementedFields && form.supplementedFields.length > 0)) && (
        <div className={styles.notes}>
          <div className={styles.notesHead}>보완·확인 사항</div>
          <ul>
            {(form.notes || []).map((n, i) => (
              <li key={`n${i}`}>{n}</li>
            ))}
            {(form.supplementedFields || []).includes('deliveryMethod') &&
              form.deliveryMethod && <li>교부 방식: {form.deliveryMethod} (보완)</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
