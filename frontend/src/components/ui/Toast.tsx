'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import Icon, { type IconName } from './Icon';
import styles from './Toast.module.css';

interface ToastState {
  message: string;
  icon?: IconName;
}

/** 단일 토스트를 띄우고 자동으로 사라지게 한다. */
export function useToast(durationMs = 1800) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string, icon?: IconName) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, icon });
      timer.current = setTimeout(() => setToast(null), durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, show };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div className={styles.host} role="status" aria-live="polite">
      <div className={styles.toast}>
        {toast.icon && <Icon name={toast.icon} size={14} />}
        {toast.message}
      </div>
    </div>
  );
}

export default Toast;
