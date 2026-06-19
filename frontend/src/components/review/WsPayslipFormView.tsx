'use client';

import type { ReactNode } from 'react';

import type { WsPayslipForm, WagePayLine } from '@/lib/api/ws';
import styles from './WsPayslipFormView.module.css';

/**
 * 고용노동부 표준 임금명세서 서식(공란)을 그대로 재현해 각 칸에 값을 채우는 뷰.
 * (backend/data/forms/임금명세서 서식(공란).hwp 레이아웃 기준)
 *
 * editable=true 면 각 칸을 contentEditable 로 직접 수정 가능 — blur 시 onChange 로 커밋.
 * (모바일 input 16px 강제·iOS 자동확대를 피하려 input 대신 contentEditable 사용)
 * 분석으로 보완된 항목은 '보완' 배지 + 행 하이라이트.
 */

interface Props {
  form: WsPayslipForm;
  editable?: boolean;
  onChange?: (next: WsPayslipForm) => void;
}

const numOnly = (v?: string) => (v ?? '').replace(/[^\d.-]/g, '');
const amt = (v?: string) => {
  const s = (v ?? '').trim();
  if (!s) return '';
  const n = numOnly(s);
  if (n && !Number.isNaN(Number(n))) return Number(n).toLocaleString('ko-KR');
  return s.replace(/원/g, '');
};

function yearMonth(form: WsPayslipForm): { y: string; m: string } {
  const src = form.settlementPeriod || form.paymentDate || '';
  const mt = src.match(/(\d{4})\s*[-./년]\s*(\d{1,2})/);
  if (mt) return { y: mt[1], m: String(Number(mt[2])) };
  return { y: '', m: '' };
}

export default function WsPayslipFormView({ form, editable = false, onChange }: Props) {
  const w = form.worker || {};
  const e = form.employer || {};
  const { y, m } = yearMonth(form);
  const ed = editable && !!onChange;

  // ─── 편집 커밋 헬퍼 ───
  const patch = (next: WsPayslipForm) => onChange?.(next);
  const setTop = (k: keyof WsPayslipForm) => (v: string) =>
    patch({ ...form, [k]: v } as WsPayslipForm);
  const setObj =
    (obj: 'worker' | 'employer' | 'workTime', k: string) => (v: string) =>
      patch({ ...form, [obj]: { ...(form[obj] || {}), [k]: v } } as WsPayslipForm);
  const setLine =
    (arr: 'payments' | 'deductions', i: number, k: keyof WagePayLine) =>
    (v: string) => {
      const list = [...((form[arr] as WagePayLine[]) || [])];
      if (!list[i]) return;
      list[i] = { ...list[i], [k]: v };
      patch({ ...form, [arr]: list } as WsPayslipForm);
    };

  /** 편집 가능하면 contentEditable span, 아니면 텍스트(금액은 amt 포맷). */
  const cell = (
    value: string | undefined,
    setter?: (v: string) => void,
    opts: { right?: boolean; money?: boolean } = {},
  ): ReactNode => {
    if (ed && setter) {
      return (
        <span
          className={`${styles.edit} ${opts.right ? styles.editRight : ''}`}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={(ev) => {
            const t = (ev.currentTarget.textContent || '').trim();
            if (t !== (value || '').trim()) setter(t);
          }}
        >
          {value || ''}
        </span>
      );
    }
    return opts.money ? amt(value) : value || '';
  };

  const pays: WagePayLine[] = form.payments || [];
  const deds: WagePayLine[] = form.deductions || [];
  const rowN = Math.max(pays.length, deds.length, 4);
  const rows = Array.from({ length: rowN }, (_, i) => ({ pi: i, di: i }));

  // 계산 방법 — 산출식(basis)이 있는 지급 항목 (원본 index 보존).
  const calcRows = pays
    .map((p, i) => ({ p, i }))
    .filter((x) => (x.p.basis || '').trim() || ed);

  const empW = [e.company, e.businessNo ? `(${e.businessNo})` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`${styles.sheet} ${ed ? styles.editable : ''}`}>
      {/* 상단 회사 영역 */}
      <div className={styles.companyBox}>
        {ed ? cell(empW, setObj('employer', 'company')) : empW || ' '}
      </div>

      {/* 제목 + 지급일 */}
      <div className={styles.titleRow}>
        <h2 className={styles.docTitle}>
          {y || '____'} 년 {m || '__'} 월 임금명세서
        </h2>
        <div className={styles.payDate}>
          지급일 : {cell(form.paymentDate, setTop('paymentDate'))}
        </div>
      </div>

      {/* 성명·사번·부서·직급 */}
      <table className={styles.infoTable}>
        <tbody>
          <tr>
            <th>성명</th>
            <td>{cell(w.name, setObj('worker', 'name'))}</td>
            <th>사번</th>
            <td>{cell(w.idOrBirth, setObj('worker', 'idOrBirth'))}</td>
          </tr>
          <tr>
            <th>부서</th>
            <td>{cell(w.dept, setObj('worker', 'dept'))}</td>
            <th>직급</th>
            <td>{cell(w.position, setObj('worker', 'position'))}</td>
          </tr>
        </tbody>
      </table>

      {/* 세부 내역 */}
      <div className={styles.sectionHead}>세부 내역</div>
      <table className={styles.detailTable}>
        <colgroup>
          <col className={styles.colItem} />
          <col className={styles.colAmtW} />
          <col className={styles.colItem} />
          <col className={styles.colAmtW} />
        </colgroup>
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
          {rows.map(({ pi, di }) => {
            const p = pays[pi];
            const d = deds[di];
            return (
              <tr key={pi}>
                <td className={`${styles.itemName} ${p?.supplemented ? styles.sup : ''}`}>
                  {cell(p?.name, p ? setLine('payments', pi, 'name') : undefined)}
                  {p?.supplemented && <span className={styles.supBadge}>보완</span>}
                </td>
                <td className={`${styles.amtCell} ${p?.supplemented ? styles.sup : ''}`}>
                  {cell(p?.amount, p ? setLine('payments', pi, 'amount') : undefined, {
                    right: true,
                    money: true,
                  })}
                </td>
                <td className={`${styles.itemName} ${d?.supplemented ? styles.sup : ''}`}>
                  {cell(d?.name, d ? setLine('deductions', di, 'name') : undefined)}
                  {d?.supplemented && <span className={styles.supBadge}>보완</span>}
                </td>
                <td className={`${styles.amtCell} ${d?.supplemented ? styles.sup : ''}`}>
                  {cell(d?.amount, d ? setLine('deductions', di, 'amount') : undefined, {
                    right: true,
                    money: true,
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={styles.totalRow}>
            <th>지급액 계</th>
            <td className={styles.amtCell}>
              {cell(form.paymentTotal, setTop('paymentTotal'), { right: true, money: true })}
            </td>
            <th>공제액 계</th>
            <td className={styles.amtCell}>
              {cell(form.deductionTotal, setTop('deductionTotal'), { right: true, money: true })}
            </td>
          </tr>
          <tr className={styles.netRow}>
            <td className={styles.blankCell} colSpan={2} />
            <th>실지급액</th>
            <td className={styles.amtCell}>
              {cell(form.netPay, setTop('netPay'), { right: true, money: true })}
            </td>
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
            calcRows.map(({ p, i }) => (
              <tr key={i}>
                <td className={p.supplemented ? styles.sup : ''}>
                  {cell(p.name, setLine('payments', i, 'name'))}
                  {p.supplemented && <span className={styles.supBadge}>보완</span>}
                </td>
                <td className={styles.calcBasis}>
                  {cell(p.basis, setLine('payments', i, 'basis'))}
                </td>
                <td className={styles.amtCell}>
                  {cell(p.amount, setLine('payments', i, 'amount'), { right: true, money: true })}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className={styles.footnote}>
        ※ 가족수당은 취업규칙 등에 지급요건이 규정되어 있는 경우 계산방법을 기재하지
        않더라도 무방
      </div>

      {/* 보완·확인 메모 */}
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
