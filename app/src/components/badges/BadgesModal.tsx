/*
 * Badges popup for the generator: the same panel as /badges, in the popup
 * frame Support uses. Twitch sign-in leaves the page, so it returns to the
 * generator with ?badges=1, which opens this popup again. The panel's code
 * loads only when the popup first opens.
 */
import dynamic from 'next/dynamic';
import { PopupShell } from '@/components/support/SupportModal';

const BadgesDashboard = dynamic(() => import('./BadgesDashboard'), {
  ssr: false,
  loading: () => <div className="support-modal-loading" aria-hidden="true" />,
});

/** Generator URL that reopens the popup after Twitch sign-in. */
export const BADGES_POPUP_RETURN = '/multichat?badges=1';

export default function BadgesModal({
  open,
  onClose,
  onGetBadge,
}: {
  open: boolean;
  onClose: () => void;
  /** Switch to the Support popup (signed in without the badge). */
  onGetBadge?: () => void;
}) {
  return (
    <PopupShell open={open} onClose={onClose} label="Your FlossChat badges" width="860px">
      <BadgesDashboard variant="modal" signInNext={BADGES_POPUP_RETURN} onGetBadge={onGetBadge} />
    </PopupShell>
  );
}
