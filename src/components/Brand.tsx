import { brand } from '../lib/brand';
import s from '../App.module.css';

export function Brand() {
  return <span className={s.brandLockup}>
    <img src={brand.logo} width="1352" height="257" alt="Anubis" />
  </span>;
}
