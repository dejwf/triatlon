import type { ParticipantStatus, RaceStatus, UserRole } from '@triatlon/shared';

export { GENDER_LABEL, LOCALITY_LABEL } from '@triatlon/shared';

export const RACE_STATUS_LABEL: Record<RaceStatus, string> = {
  planned: 'plánovaný',
  running: 'probíhá',
  finished: 'dokončen',
};

export const PARTICIPANT_STATUS_LABEL: Record<ParticipantStatus, string> = {
  registered: 'registrován',
  checked_in: 'přítomen',
  absent: 'nepřítomen',
  disqualified: 'diskvalifikován',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'super admin',
  admin: 'admin',
  organizer: 'organizátor',
};

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}
