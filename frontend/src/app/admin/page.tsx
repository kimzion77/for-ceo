'use client';

/**
 * 관리자 대시보드 — /admin
 *
 *  1) 비밀번호 로그인 게이트 (세션 쿠키)
 *  2) 탭: 대시보드(방문/사용자 통계) · 업로드(기록·파일 열람) · 프롬프트(편집·즉시 적용)
 *
 * 모든 관리자 데이터 API 는 BFF(/api/cgr/admin/*) 가 세션 검증 후에만 키를 주입한다.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  adminLogin,
  adminLogout,
  checkAdminSession,
  getAnalytics,
  getPrompts,
  getUploads,
  savePrompt,
  uploadFileUrl,
  type AdminAnalytics,
  type PromptItem,
  type UploadRow,
} from '@/lib/api/admin';

import styles from './page.module.css';

type Tab = 'dash' | 'uploads' | 'prompts';

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('dash');

  useEffect(() => {
    checkAdminSession().then(setAuthed);
  }, []);

  const doLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setLoginErr(null);
    try {
      await adminLogin(pw);
      setAuthed(true);
      setPw('');
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    await adminLogout();
    setAuthed(false);
  };

  if (authed === null) {
    return (
      <main className={styles.page}>
        <div className={styles.center}>확인 중…</div>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className={styles.page}>
        <form className={styles.loginCard} onSubmit={doLogin}>
          <h1 className={styles.loginTitle}>관리자 로그인</h1>
          <p className={styles.loginSub}>관리자 비밀번호를 입력하세요.</p>
          <input
            className={styles.loginInput}
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="비밀번호"
            autoFocus
          />
          {loginErr && <div className={styles.loginErr}>{loginErr}</div>}
          <button className={styles.loginBtn} type="submit" disabled={busy || !pw}>
            {busy ? '확인 중…' : '로그인'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>관리자 대시보드</h1>
        <button className={styles.logout} onClick={doLogout}>
          로그아웃
        </button>
      </header>
      <nav className={styles.tabs}>
        <button
          className={tab === 'dash' ? styles.tabOn : styles.tab}
          onClick={() => setTab('dash')}
        >
          대시보드
        </button>
        <button
          className={tab === 'uploads' ? styles.tabOn : styles.tab}
          onClick={() => setTab('uploads')}
        >
          업로드
        </button>
        <button
          className={tab === 'prompts' ? styles.tabOn : styles.tab}
          onClick={() => setTab('prompts')}
        >
          프롬프트
        </button>
      </nav>
      {tab === 'dash' && <DashTab />}
      {tab === 'uploads' && <UploadsTab />}
      {tab === 'prompts' && <PromptsTab />}
    </main>
  );
}

/* ─── 대시보드 ─── */
function DashTab() {
  const [a, setA] = useState<AdminAnalytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getAnalytics()
      .then(setA)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  if (err) return <div className={styles.err}>{err}</div>;
  if (!a) return <div className={styles.center}>불러오는 중…</div>;
  const cards = [
    { label: '총 방문수', v: a.total_visits },
    { label: '오늘 사용자 (DAU)', v: a.dau },
    { label: '주간 사용자 (WAU)', v: a.wau },
    { label: '월간 사용자 (MAU)', v: a.mau },
    { label: '총 업로드', v: a.total_uploads },
  ];
  const maxV = Math.max(1, ...a.daily.map((d) => d.visits));
  return (
    <section className={styles.section}>
      <div className={styles.cards}>
        {cards.map((c) => (
          <div key={c.label} className={styles.card}>
            <div className={styles.cardNum}>{c.v.toLocaleString()}</div>
            <div className={styles.cardLabel}>{c.label}</div>
          </div>
        ))}
      </div>

      <h2 className={styles.h2}>일별 추이 (최근 30일)</h2>
      <div className={styles.bars}>
        {a.daily.length === 0 ? (
          <div className={styles.muted}>아직 데이터가 없어요.</div>
        ) : (
          a.daily.map((d) => (
            <div key={d.d} className={styles.barRow}>
              <span className={styles.barDate}>{d.d.slice(5)}</span>
              <span className={styles.barTrack}>
                <span
                  className={styles.barFill}
                  style={{ width: `${(d.visits / maxV) * 100}%` }}
                />
              </span>
              <span className={styles.barVal}>
                {d.visits}회 · {d.users}명
              </span>
            </div>
          ))
        )}
      </div>

      <h2 className={styles.h2}>서비스별 업로드</h2>
      <div className={styles.svcRow}>
        {Object.keys(a.uploads_by_service).length === 0 ? (
          <div className={styles.muted}>없음</div>
        ) : (
          Object.entries(a.uploads_by_service).map(([k, v]) => (
            <span key={k} className={styles.svcChip}>
              {k} <strong>{v}</strong>
            </span>
          ))
        )}
      </div>
    </section>
  );
}

/* ─── 업로드 ─── */
function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

function UploadsTab() {
  const [rows, setRows] = useState<UploadRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<UploadRow | null>(null);
  useEffect(() => {
    getUploads({ limit: 200 })
      .then((r) => {
        setRows(r.items);
        setTotal(r.total);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  if (err) return <div className={styles.err}>{err}</div>;
  if (!rows) return <div className={styles.center}>불러오는 중…</div>;
  return (
    <section className={styles.section}>
      <div className={styles.muted}>
        총 {total.toLocaleString()}건 · 업로더는 익명 처리됩니다 · 보관기간 후 자동 삭제
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>시각</th>
              <th>서비스</th>
              <th>파일명</th>
              <th>종류</th>
              <th>크기</th>
              <th>파일</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.muted}>
                  업로드 기록이 없어요.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.ts.replace('T', ' ')}</td>
                  <td>{r.service}</td>
                  <td className={styles.fname} title={r.filename}>
                    {r.filename || '(이름 없음)'}
                  </td>
                  <td>{r.ext || r.mime}</td>
                  <td>{fmtSize(r.size)}</td>
                  <td>
                    {r.has_file ? (
                      <button className={styles.linkBtn} onClick={() => setPreview(r)}>
                        보기
                      </button>
                    ) : (
                      <span className={styles.muted}>만료</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {preview && (
        <div className={styles.modal} onClick={() => setPreview(null)}>
          <div className={styles.modalBody} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <span className={styles.fname} title={preview.filename}>
                {preview.filename || '(이름 없음)'}
              </span>
              <a
                href={uploadFileUrl(preview.id)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.linkBtn}
              >
                새 탭에서 열기
              </a>
              <button className={styles.linkBtn} onClick={() => setPreview(null)}>
                닫기
              </button>
            </div>
            {(preview.mime || '').startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={styles.previewImg}
                src={uploadFileUrl(preview.id)}
                alt={preview.filename}
              />
            ) : (
              <iframe
                className={styles.previewFrame}
                src={uploadFileUrl(preview.id)}
                title={preview.filename}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ─── 프롬프트 ─── */
function PromptsTab() {
  const [items, setItems] = useState<PromptItem[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getPrompts()
      .then(setItems)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const current = items?.find((i) => i.key === sel) || null;
  const select = (k: string) => {
    const it = items?.find((i) => i.key === k);
    setSel(k);
    setDraft(it?.content || '');
    setMsg(null);
  };
  const doSave = async () => {
    if (!sel) return;
    setSaving(true);
    setMsg(null);
    try {
      await savePrompt(sel, draft);
      setMsg('✓ 저장됨 — 다음 호출부터 즉시 적용됩니다.');
      load();
    } catch (e) {
      setMsg('저장 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (err) return <div className={styles.err}>{err}</div>;
  if (!items) return <div className={styles.center}>불러오는 중…</div>;

  const groups: Record<string, PromptItem[]> = {};
  items.forEach((i) => {
    (groups[i.group] ||= []).push(i);
  });
  const dirty = current ? draft !== current.content : false;

  return (
    <section className={styles.promptLayout}>
      <aside className={styles.promptList}>
        {Object.entries(groups).map(([g, gi]) => (
          <div key={g} className={styles.promptGroup}>
            <div className={styles.promptGroupName}>{g}</div>
            {gi.map((i) => (
              <button
                key={i.key}
                className={i.key === sel ? styles.promptItemOn : styles.promptItem}
                onClick={() => select(i.key)}
              >
                {i.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <div className={styles.promptEditor}>
        {!current ? (
          <div className={styles.muted}>왼쪽에서 편집할 프롬프트를 선택하세요.</div>
        ) : (
          <>
            <div className={styles.promptHead}>
              <strong>{current.label}</strong>{' '}
              <span className={styles.muted}>({current.key})</span>
            </div>
            <textarea
              className={styles.promptArea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            <div className={styles.promptFoot}>
              <span className={styles.muted}>{msg}</span>
              <button
                className={styles.saveBtn}
                onClick={doSave}
                disabled={saving || !dirty}
              >
                {saving ? '저장 중…' : '저장 (즉시 적용)'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
