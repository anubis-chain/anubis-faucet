import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import s from '../App.module.css';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const focusBeforeOpen = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      focusBeforeOpen?.focus();
    };
  }, []);
  return <dialog ref={ref} aria-labelledby={id} className={s.modal} onCancel={onClose} onClick={e => {
    if (e.target === e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    }
  }}>
    <button className={s.close} type="button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button>
    <h2 id={id} className={s.modalTitle}>{title}</h2>
    {children}
  </dialog>;
}
