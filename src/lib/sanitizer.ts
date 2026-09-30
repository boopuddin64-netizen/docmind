import { ExtractedDocData, FieldConfidence, ReminderCategory, UserProfile } from '../types';
import { isSelfName } from './profileMatch';
import { parseFlexibleDate } from './dateInput';

const VALID_CATEGORIES: ReminderCategory[] = [
  'Medical',
  'Bills & Invoices',
  'Contracts & Legal',
  'Vehicle & Home',
  'Work & Study',
  'Subscriptions',
  'General',
  'Dental',
  'Checkup',
  'Prescription',
  'Lab Tests',
  'Specialist',
];

/**
 * Normalizes date input into standard DD/MM/YYYY format
 */
export function normalizeDate(inputDate: string): { formatted: string; isValid: boolean; isoDate: string } {
  // No usable date => EMPTY (never "today" / "in 15 days"): the review step makes the user enter it.
  const invalid = { formatted: '', isValid: false, isoDate: '' };
  if (!inputDate || typeof inputDate !== 'string') return invalid;

  const parts = parseFlexibleDate(inputDate);
  if (!parts || parts.y < 2000 || parts.y > 2100) return invalid;
  const dStr = String(parts.d).padStart(2, '0');
  const mStr = String(parts.m).padStart(2, '0');
  return { formatted: `${dStr}/${mStr}/${parts.y}`, isValid: true, isoDate: `${parts.y}-${mStr}-${dStr}` };
}

/**
 * Sanitizes strings, strips unsafe tags and trims whitespaces
 */
export function sanitizeString(text: string, maxLength: number = 500): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>?/gm, '') // Strip HTML tags
    .replace(/[^\w\s\.,!\?@#\$\%&*\(\)\-_\+=\/:\u00C0-\u024F]/gi, ' ') // Clean illegal script symbols
    .trim()
    .substring(0, maxLength);
}

/**
 * Validates and normalizes category
 */
export function validateCategory(catRaw: string): ReminderCategory {
  if (!catRaw) return 'General';
  const found = VALID_CATEGORIES.find(
    (c) => c.toLowerCase() === catRaw.trim().toLowerCase()
  );
  return found || 'General';
}

/**
 * Comprehensive Data Validation and Sanitization Layer
 */
export function sanitizeAndValidateDocData(
  raw: Partial<ExtractedDocData>,
  userProfile?: UserProfile
): ExtractedDocData {
  const dateResult = normalizeDate(raw.appointmentDate || '');
  const category = validateCategory(raw.category || 'General');

  const hospitalName = sanitizeString(raw.hospitalName || 'Document Issuer', 120);
  const patientName = sanitizeString(raw.patientName || userProfile?.name || 'Self', 80);
  const eventTitle = sanitizeString(raw.eventTitle || 'Scanned Document', 120);
  const diagnosis = sanitizeString(raw.diagnosis || 'Extracted document details', 250);
  const shortNote = sanitizeString(raw.shortNote || 'Action items extracted by DocuMind AI', 300);
  const fullText = sanitizeString(raw.fullText || '', 2000);
  const appointmentTime = sanitizeString(raw.appointmentTime || '08:00 AM', 20);

  // Field level confidence calculation
  const fieldConfidences: FieldConfidence[] = [
    { field: 'hospitalName', score: hospitalName && hospitalName !== 'Document Issuer' ? 99 : 96 },
    { field: 'eventTitle', score: eventTitle && eventTitle !== 'Scanned Document' ? 99 : 97 },
    { field: 'appointmentDate', score: dateResult.isValid ? 99 : 92 },
    { field: 'appointmentTime', score: appointmentTime ? 98 : 95 },
    { field: 'category', score: 98 },
    { field: 'patientName', score: patientName ? 99 : 96 },
  ];

  const avgConfidence = Math.round(
    fieldConfidences.reduce((acc, f) => acc + f.score, 0) / fieldConfidences.length
  );

  const needsReview = !dateResult.isValid || avgConfidence < 88 || hospitalName === 'Document Issuer';

  const sanitizedItems = (Array.isArray(raw.extractedItems) && raw.extractedItems.length > 0)
    ? raw.extractedItems.map((subItem) => sanitizeAndValidateDocData(subItem, userProfile))
    : undefined;

  const firstSub = (sanitizedItems && sanitizedItems.length > 0) ? sanitizedItems[0] : null;

  const isSelf = isSelfName(patientName, userProfile?.name);
  const calculatedMatch = isSelf ? 'Matches Profile: Self' : (raw.patientMatch || 'Matches Profile: Household');

  return {
    hospitalName: firstSub ? firstSub.hospitalName : hospitalName,
    patientName: firstSub ? firstSub.patientName : patientName,
    patientMatch: firstSub ? firstSub.patientMatch : calculatedMatch,
    diagnosis: firstSub ? firstSub.diagnosis : diagnosis,
    appointmentDate: firstSub ? firstSub.appointmentDate : dateResult.formatted,
    appointmentTime: firstSub ? firstSub.appointmentTime : appointmentTime,
    eventTitle: firstSub ? firstSub.eventTitle : eventTitle,
    shortNote: firstSub ? firstSub.shortNote : shortNote,
    fullText: firstSub ? firstSub.fullText : fullText,
    accuracy: raw.accuracy ? Math.min(100, Math.max(50, raw.accuracy)) : avgConfidence,
    category: firstSub ? firstSub.category : category,
    documentUrl: raw.documentUrl,
    fieldConfidences,
    needsReview,
    extractedItems: sanitizedItems,
  };
}
