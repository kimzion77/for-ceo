import Icon from '@/components/ui/Icon';
import styles from './Hero.module.css';

/** 홈 상단 히어로 영역 — 시안의 인트로 카피. */
export function Hero() {
  return (
    <div className={styles.wrap}>
      <div className={styles.chip}>
        <Icon name="sparkle" size={13} /> 무료 · 회원가입 없이 바로 검토
      </div>
      <h1 className={styles.title}>
        우리 사업장의 노동법 서류,
        <br />
        <span className={styles.titleAccent}>스스로 점검</span>해 보세요.
      </h1>
      <p className={styles.subtitle}>
        서류를 올리면 위반·누락 항목을 위험도별로 정리하고, <br />
        <strong>어떻게 시정하면 되는지</strong> 법령 근거와 함께 안내합니다.
      </p>
    </div>
  );
}

export default Hero;
