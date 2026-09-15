import { ExtractedDocData, Reminder } from '../types';

/**
 * Computes a normalized composite hash string for a document
 */
export function generateCompositeDedupHash(
  issuer: string,
  dateStr: string,
  titleOrAmount: string
): string {
  const normIssuer = (issuer || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normDate = (dateStr || '').replace(/[^0-9]/g, '');
  const normTitle = (titleOrAmount || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);

  const rawKey = `${normIssuer}_${normDate}_${normTitle}`;

  // Simple quick hash integer string
  let hash = 0;
  for (let i = 0; i < rawKey.length; i++) {
    const char = rawKey.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `HASH-${Math.abs(hash).toString(16).toUpperCase()}`;
}

/**
 * Calculates Token Jaccard Similarity between two text strings
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  const words1 = new Set(
    text1.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2)
  );
  const words2 = new Set(
    text2.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2)
  );

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

export interface DuplicateMatchResult {
  isDuplicate: boolean;
  matchingReminder: Reminder | null;
  similarityScore: number;
  reason: string;
}

/**
 * Finds potential duplicate reminders in the existing collection
 */
export function checkForDuplicateReminder(
  newDoc: ExtractedDocData,
  existingReminders: Reminder[]
): DuplicateMatchResult {
  if (!existingReminders || existingReminders.length === 0) {
    return { isDuplicate: false, matchingReminder: null, similarityScore: 0, reason: 'No existing reminders' };
  }

  const newHash = generateCompositeDedupHash(
    newDoc.hospitalName,
    newDoc.appointmentDate,
    newDoc.eventTitle
  );

  for (const existing of existingReminders) {
    // Exact hash match
    if (existing.dedupHash && existing.dedupHash === newHash) {
      return {
        isDuplicate: true,
        matchingReminder: existing,
        similarityScore: 1.0,
        reason: 'Exact composite hash match (Same issuer, date, and document title)',
      };
    }

    // Check same issuer and same appointment/due date
    const sameIssuer =
      existing.hospitalName.toLowerCase().trim() === newDoc.hospitalName.toLowerCase().trim() ||
      calculateTextSimilarity(existing.hospitalName, newDoc.hospitalName) > 0.7;

    const sameDate = existing.appointmentDate === newDoc.appointmentDate;

    if (sameIssuer && sameDate) {
      const titleSim = calculateTextSimilarity(existing.eventTitle, newDoc.eventTitle);
      if (titleSim > 0.4) {
        return {
          isDuplicate: true,
          matchingReminder: existing,
          similarityScore: Number((0.8 + titleSim * 0.2).toFixed(2)),
          reason: `High similarity upload (${Math.round((0.8 + titleSim * 0.2) * 100)}%) matching existing record from ${existing.hospitalName} due on ${existing.appointmentDate}.`,
        };
      }
    }
  }

  return { isDuplicate: false, matchingReminder: null, similarityScore: 0, reason: 'Unique document' };
}
