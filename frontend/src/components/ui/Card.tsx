import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps {
  children: ReactNode;
  padding?: number | string;
  style?: CSSProperties;
  className?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

/** 흰 카드 컨테이너 (시안 `Card`). */
export function Card({ children, padding = 24, style, className, onClick }: CardProps) {
  const classes = [styles.card, onClick ? styles.clickable : '', className].filter(Boolean).join(' ');
  return (
    <div className={classes} style={{ padding, ...style }} onClick={onClick}>
      {children}
    </div>
  );
}

export default Card;
