import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { name: 'plus' | 'minus' | 'close' | 'arrow' | 'copy' | 'check' | 'external' | 'circle-plus' };
export function Icon({ name, ...props }: Props) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {name === 'plus' && <path d="M12 5v14M5 12h14" />}
    {name === 'minus' && <path d="M5 12h14" />}
    {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
    {name === 'arrow' && <path d="m9 6 6 6-6 6" />}
    {name === 'check' && <path d="m5 13 4 4L19 7" />}
    {name === 'copy' && <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>}
    {name === 'external' && <><path d="M14 4h6v6m0-6L10 14M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></>}
    {name === 'circle-plus' && <><circle cx="12" cy="12" r="9" /><path d="M12 8v8m-4-4h8" /></>}
  </svg>;
}
