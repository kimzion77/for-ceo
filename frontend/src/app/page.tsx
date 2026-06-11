'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import Button from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';

import SiteHeader from '@/components/layout/SiteHeader';
import Hero from '@/components/home/Hero';
import SectionHeading from '@/components/home/SectionHeading';
import DocTypePicker from '@/components/home/DocTypePicker';
import FileDropzone from '@/components/home/FileDropzone';
import HomeGuidePreview from '@/components/home/HomeGuidePreview';
import WorkplaceForm, {
  DEFAULT_WORKPLACE,
  toWorkplaceContext,
  type WorkplaceFormState,
} from '@/components/home/WorkplaceForm';

import { postReviewWorkRules } from '@/lib/api/review';
import { postEcExtract, postEcStructure } from '@/lib/api/ec';
import { postWsAnalyze, postWsExtract } from '@/lib/api/ws';
import { postScExtract, postScStructure } from '@/lib/api/sc';
import { ApiCallError } from '@/lib/api/client';
import {
  makeTempCaseId,
  setCaseError,
  setCaseResult,
  startCase,
  updateEc,
  updateSc,
  updateWs,
} from '@/lib/reviewStore';

import type { DocumentType } from '@/types/review';

import styles from './page.module.css';

/**
 * 홈 — 문서 종류 + 업로드 + 사업장 정보.
 *
 * 시안 `screens-home.jsx` 의 흐름을 그대로 옮긴 클라이언트 페이지.
 * 검토 시작은 다음 단계에서 백엔드 `POST /api/review` 로 교체.
 */
export default function HomePage() {
  const router = useRouter();

  // 기본 진입은 근로계약서 — 풀 이식의 메인 트랙.
  const [docType, setDocType] = useState<DocumentType>('employment-contract');
  const [files, setFiles] = useState<File[]>([]);
  const [workplace, setWorkplace] = useState<WorkplaceFormState>(DEFAULT_WORKPLACE);
  const [submitting, setSubmitting] = useState(false);

  // work-rules / employment-contract / wage-statement / service-provider-contract 모두 허용.
  const docReady =
    docType === 'work-rules' ||
    docType === 'employment-contract' ||
    docType === 'wage-statement' ||
    docType === 'service-provider-contract';
  const canSubmit = files.length > 0 && docReady && !submitting;

  const startReview = async () => {
    if (files.length === 0 || !docReady) return;
    setSubmitting(true);

    const caseId = makeTempCaseId();

    // 결과 페이지 좌측 미리보기용 — 첫 파일이 이미지면 blob URL 만들어 store 에 동봉.
    // docx/hwp/pdf 는 미리보기 없이 카드만.
    const first = files[0];
    const isImage = first.type.startsWith('image/');
    const originalUrl = isImage ? URL.createObjectURL(first) : undefined;
    startCase(caseId, docType, {
      originalUrl,
      originalFilename: first.name,
      originalKind: isImage ? 'image' : 'doc',
    });

    // 로딩 페이지로 즉시 이동
    router.push(`/review/${caseId}/loading`);

    // 백엔드 호출 (백그라운드) — document_type 으로 분기.
    try {
      const ctx = toWorkplaceContext(workplace);
      if (docType === 'employment-contract') {
        // 풀 이식 4단계 — 1) extract + 2) structure 까지 자동 연쇄.
        // 사용자가 검토 페이지(Step2)에서 표를 수정한 뒤 analyze → result → contract 로 진행.
        updateEc(caseId, { phase: 'extracting' });
        const extracted = await postEcExtract(first);

        updateEc(caseId, {
          phase: 'structuring',
          extractedText: extracted.extracted_text,
        });
        const structured = await postEcStructure(extracted.extracted_text);

        // 응답 검증 — LLM 이 가끔 빈 dict 나 누락된 응답을 줄 때가 있어, 그대로 review 단계로
        // 넘어가면 사용자 화면에 "구조화 데이터가 없어요" 가 뜬다. 명시적 검증으로 catch 로 보냄.
        const sd = structured?.structured_data;
        if (!sd || typeof sd !== 'object' || Object.keys(sd).length === 0) {
          throw new Error(
            '계약서 구조화 결과가 비어있어요. OCR 텍스트가 짧거나 형식이 표준 계약서가 아닐 수 있습니다.',
          );
        }

        // 사업장 컨텍스트(폼에서 받은 것)를 ec 워크플로에 같이 박아둠.
        // 사용자가 검토 페이지에서 다시 바꿀 수 있고, analyze 호출 직전에 최신값으로 덮어씀.
        updateEc(caseId, {
          phase: 'review',
          structuredData: sd,
          businessSize: ctx.businessSize ?? '',
          workerTypes: ctx.workerTypes,
        });
        // LoadingScreen 이 status='done' 을 트리거로 다음 라우트로 보내므로,
        // EC 풀 이식에선 result 가 아닌 phase='review' 가 그 신호.
        // → LoadingScreen 측 폴링에서 phase 를 보고 /ec/review 로 라우팅.
      } else if (docType === 'service-provider-contract') {
        // 노무제공자 계약서 (Phase 17) — extract + structure 자동 연쇄.
        //   1) /sc/extract   파일 → 텍스트
        //   2) /sc/structure 텍스트 → 4섹션·16슬롯 JSON
        //   3) (사용자 검토) → /sc/analyze (LoadingScreen 후 sc/review 페이지)
        updateSc(caseId, { phase: 'extracting' });
        const scExtracted = await postScExtract(first);

        updateSc(caseId, {
          phase: 'structuring',
          extractedText: scExtracted.extracted_text,
        });
        const scStructured = await postScStructure(scExtracted.extracted_text);

        updateSc(caseId, {
          phase: 'review',
          structuredData: scStructured.structured_data,
          businessSize: ctx.businessSize ?? '',
        });
        // LoadingScreen 은 sc.phase='review' 를 보고 /review/[id]/sc/review 로 라우팅.
      } else if (docType === 'wage-statement') {
        // 임금명세서 (beta) — extract + analyze 자동 연쇄.
        //   1) /ws/extract  파일 → 텍스트 (이미지면 OCR)
        //   2) /ws/analyze  텍스트 + 컨텍스트 → 11 슬롯 위반 분석 (LLM)
        // 결과는 EC analysis 와 동일 스키마 → /review/[id]/ws 에서 같은 UI 로 렌더.
        updateWs(caseId, { phase: 'extracting' });
        const wsExtracted = await postWsExtract(first);

        updateWs(caseId, {
          phase: 'analyzing',
          extractedText: wsExtracted.extracted_text,
          businessSize: ctx.businessSize ?? '',
          workerTypes: ctx.workerTypes,
        });
        const wsAnalyzed = await postWsAnalyze({
          wage_text: wsExtracted.extracted_text,
          business_size: ctx.businessSize ?? '',
          worker_types: ctx.workerTypes ?? [],
          pay_period_year: ctx.payPeriodYear ?? undefined,
          pay_period_month: ctx.payPeriodMonth ?? undefined,
          contract_type: ctx.contractType ?? undefined,
          pay_cycle: ctx.payCycle ?? undefined,
          weekly_hours: ctx.weeklyHours ?? undefined,
        });

        updateWs(caseId, {
          phase: 'result',
          analysisResult: wsAnalyzed.analysis_result,
        });
        // LoadingScreen 은 ws.phase='result' 를 보고 /review/[id]/ws 로 라우팅.
      } else {
        const result = await postReviewWorkRules({
          files,
          context: ctx,
          documentType: docType,
        });
        setCaseResult(caseId, result);
      }
    } catch (err) {
      const rawMsg =
        err instanceof ApiCallError
          ? err.detail
          : err instanceof Error
            ? err.message
            : String(err);
      // 사용자 친화 변환 — 빈번한 백엔드 메시지를 한국어로 풀어 안내
      const friendly = humanizeError(rawMsg, err instanceof ApiCallError ? err.status : undefined);
      setCaseError(caseId, friendly);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * 백엔드 에러를 사용자가 이해할 수 있는 메시지로 변환.
   * 원본 detail 도 부가 정보로 포함 (운영자가 트러블슈팅 시 유용).
   */
  function humanizeError(detail: string, status?: number): string {
    const d = (detail || '').toLowerCase();
    // OCR 관련
    if (d.includes('텍스트 추출 실패') || d.includes('parse_to_text') || d.includes('ocr')) {
      return (
        '📷 OCR 텍스트 추출에 실패했어요.\n' +
        '  • 이미지가 흐릿하거나 빛 반사가 있는 경우, 글자가 선명한 사진으로 다시 시도해 주세요.\n' +
        '  • PDF 가 스캔본이면 같은 페이지를 PNG/JPG 로 저장해서 올려주세요.\n' +
        `(상세: ${detail.slice(0, 200)})`
      );
    }
    if (d.includes('quota') || d.includes('rate limit') || d.includes('429')) {
      return (
        '⏳ LLM 요청이 잠시 몰리고 있어요.\n' +
        '  잠시 후 (10~30초) 다시 시도해 주세요.'
      );
    }
    if (d.includes('timeout') || d.includes('timed out')) {
      return (
        '⏱ 검토에 시간이 오래 걸려서 끊겼어요.\n' +
        '  파일이 너무 크거나 OCR 이 무거운 경우입니다.\n' +
        '  더 작은 파일·이미지로 다시 시도해 주세요.'
      );
    }
    if (status === 401 || d.includes('api key')) {
      return (
        '🔑 인증 키 문제로 백엔드에 접근하지 못했어요. 운영자에게 문의해 주세요.\n' +
        `(상세: ${detail.slice(0, 120)})`
      );
    }
    if (status === 503 || d.includes('503')) {
      return (
        '🚧 백엔드 서비스가 일시적으로 사용 불가입니다. 잠시 후 다시 시도해 주세요.'
      );
    }
    if (d.includes('502') || d.includes('백엔드 호출 실패') || d.includes('connect')) {
      return (
        '🔌 백엔드 연결에 실패했어요.\n' +
        '  네트워크 상태를 확인하시거나 잠시 후 다시 시도해 주세요.'
      );
    }
    if (d.includes('analysis_result') || d.includes('응답 형식이 올바르지 않')) {
      return (
        '⚠️ AI 응답을 해석하지 못했어요.\n' +
        '  파일 내용이 너무 짧거나 형식이 명세서·계약서가 아닐 수 있어요.'
      );
    }
    if (!detail) {
      return '알 수 없는 오류가 발생했어요. 새로고침 후 다시 시도해 주세요.';
    }
    // 기본 — 원본 detail 그대로
    return detail;
  }

  return (
    <div className={styles.page}>
      <SiteHeader />

      <div className={styles.container}>
        <Hero />

        {/* 1. 문서 종류 */}
        <section className={styles.section}>
          <SectionHeading step={1} title="어떤 문서를 검토하시나요?" />
          <DocTypePicker value={docType} onChange={setDocType} />
        </section>

        {/* 2. 업로드 */}
        <section className={styles.sectionTight}>
          <SectionHeading
            step={2}
            title="파일을 올려주세요"
            hint={
              <>
                <Icon name="shield" size={11} /> 파일은 검토 후 즉시 삭제됩니다
              </>
            }
          />
          <FileDropzone value={files} onChange={setFiles} />
        </section>

        {/* 3. 사업장 정보 */}
        <section className={styles.section}>
          <SectionHeading step={3} title="사업장 기본 정보" />
          <WorkplaceForm
            value={workplace}
            onChange={setWorkplace}
            documentType={docType}
          />
        </section>

        {/* CTA */}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          icon="search"
          disabled={!canSubmit}
          onClick={startReview}
          className={styles.cta}
        >
          {submitting ? '검토 준비 중…' : '검토 시작하기'}
        </Button>
        <div className={styles.footnote}>
          평균 1~2분 소요됩니다 · 결과는 PDF로 저장하여 사업장 보관 가능
        </div>

        {/* 꿀팁 가이드 미리보기 — 사업장 규모 선택 시 의무 자동 표시 */}
        <HomeGuidePreview
          businessSize={
            workplace.businessSize === 'unknown' ? null : workplace.businessSize
          }
        />
      </div>

      {/* 모바일 전용 — 우하단 플로팅 챗봇(노무 가이드) 버튼 */}
      <Link href="/guide" className={styles.chatFab} aria-label="노무 가이드 챗봇 열기">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          aria-hidden
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
        </svg>
        <span>노무 가이드</span>
      </Link>
    </div>
  );
}
