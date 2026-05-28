import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import Icon, { type IconName } from './Icon';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  fullWidth?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 15, md: 16, lg: 18 };

/** 기본 버튼 (시안 `Button`). */
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  fullWidth = false,
  children,
  style,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    styles.btn,
    styles[size],
    styles[variant],
    fullWidth && styles.fullWidth,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} style={style} {...rest}>
      {icon && <Icon name={icon} size={ICON_SIZE[size]} />}
      {children}
      {iconRight && <Icon name={iconRight} size={ICON_SIZE[size]} />}
    </button>
  );
}

export default Button;
