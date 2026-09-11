import { useState } from 'react';
import type { WalletDescriptor } from './WalletProvider';
import { Modal } from './Modal';
import { Icon } from './Icon';
import s from '../App.module.css';

function WalletMark({ wallet }: { wallet: WalletDescriptor }) {
  const [failed, setFailed] = useState(false);
  if (wallet.icon && !failed) {
    return <img className={s.walletIcon} src={wallet.icon} alt="" onError={() => setFailed(true)} />;
  }
  return <span className={s.walletIconFallback} aria-hidden="true">{wallet.name.slice(0, 1).toUpperCase()}</span>;
}

export function WalletSelector({
  wallets,
  selectedWalletId,
  onSelect,
  onClose,
}: {
  wallets: readonly WalletDescriptor[];
  selectedWalletId?: string;
  onSelect: (walletId: string) => void;
  onClose: () => void;
}) {
  return <Modal title="Select wallet" onClose={onClose}>
    <p className={s.modalDescription}>Choose an installed browser wallet. This faucet will not request a signature or send a transaction from your wallet.</p>
    {wallets.length ? <div className={s.walletList}>
      {wallets.map(wallet => <button
        className={s.walletOption}
        type="button"
        key={wallet.id}
        onClick={() => onSelect(wallet.id)}
        aria-label={`Connect ${wallet.name}${wallet.rdns ? ` (${wallet.rdns})` : ''}`}
      >
        <WalletMark wallet={wallet} />
        <span className={s.walletIdentity}>
          <strong>{wallet.name}</strong>
          <small>{wallet.rdns || 'Installed browser wallet'}</small>
        </span>
        {selectedWalletId === wallet.id && <span className={s.walletSelected}><Icon name="check" width="16" height="16" />Selected</span>}
      </button>)}
    </div> : <p className={s.walletEmpty}>No compatible browser wallet was detected. Install or enable a wallet extension, then try again.</p>}
    <p className={s.walletNotice}>Wallet names are supplied by browser extensions. Confirm the wallet prompt before approving access.</p>
  </Modal>;
}
