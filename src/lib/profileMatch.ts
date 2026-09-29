/**
 * Decides whether a person's name refers to the signed-in profile owner.
 * Replaces several hard-coded /promise/i checks that only worked for one specific user.
 */
export function isSelfName(name: string | undefined, profileName: string | undefined): boolean {
  const n = (name || '').toLowerCase().trim();
  if (!n) return false;
  if (n === 'self' || n === 'primary') return true;
  const p = (profileName || '').toLowerCase().trim();
  if (!p) return false;
  if (n === p) return true;
  const first = p.split(/\s+/)[0];
  return first.length > 0 && n.includes(first);
}

export function selfMatchLabel(name: string | undefined, profileName: string | undefined): 'Matches Profile: Self' | 'Matches Profile: Household' {
  return isSelfName(name, profileName) ? 'Matches Profile: Self' : 'Matches Profile: Household';
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
