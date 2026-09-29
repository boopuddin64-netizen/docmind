import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcsContent, escapeIcsText, parseIcsTime } from '../src/lib/icsBuilder';
import { isSelfName, selfMatchLabel, escapeRegExp } from '../src/lib/profileMatch';
import { normalizeDate, sanitizeAndValidateDocData } from '../src/lib/sanitizer';
import { generateCompositeDedupHash } from '../src/lib/deduplication';

const NOW = new Date(2026, 8, 29, 10, 0, 0);

test('ics: end time rolls over month/year boundary', () => {
  const ics = buildIcsContent({ title: 'x', date: '31/12/2026', time: '11:30 PM', now: NOW });
  assert.match(ics, /DTSTART:20261231T233000\r\n/);
  assert.match(ics, /DTEND:20270101T003000\r\n/);
});

test('ics: end time rolls over end of February (non-leap)', () => {
  const ics = buildIcsContent({ title: 'x', date: '28/02/2027', time: '23:15', now: NOW });
  assert.match(ics, /DTEND:20270301T001500\r\n/);
});

test('ics: CRLF injection in title cannot add properties', () => {
  const ics = buildIcsContent({ title: 'Hi\r\nATTENDEE:mailto:x@y', now: NOW });
  assert.ok(!/\r\nATTENDEE:/.test(ics));
  assert.match(ics, /SUMMARY:Hi\\nATTENDEE:mailto:x@y/);
});

test('ics: text escaping', () => {
  assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('ics: DTSTAMP is real UTC now, not the event time', () => {
  const ics = buildIcsContent({ title: 'x', date: '01/01/2030', time: '09:00 AM', now: new Date(Date.UTC(2026, 8, 29, 9, 0, 0)) });
  assert.match(ics, /DTSTAMP:20260929T090000Z/);
});

test('ics: 12 AM / 12 PM and bad times', () => {
  assert.deepEqual(parseIcsTime('12:00 AM'), { h: 0, min: 0 });
  assert.deepEqual(parseIcsTime('12:30 PM'), { h: 12, min: 30 });
  assert.deepEqual(parseIcsTime('99:99'), { h: 8, min: 0 });
  assert.deepEqual(parseIcsTime(undefined), { h: 8, min: 0 });
});

test('ics: impossible date falls back instead of emitting 20261232-style values', () => {
  const ics = buildIcsContent({ title: 'x', date: '31/02/2026', now: NOW });
  assert.match(ics, /DTSTART:20260929T080000/);
});

test('profile match is not hard-coded to a single user', () => {
  assert.equal(isSelfName('Alice Smith', 'Alice Smith'), true);
  assert.equal(isSelfName('Self', 'Alice Smith'), true);
  assert.equal(isSelfName('Bob Jones', 'Alice Smith'), false);
  assert.equal(selfMatchLabel('Promise Ledum', 'Alice Smith'), 'Matches Profile: Household');
  assert.equal(selfMatchLabel('Promise Ledum', 'Promise Ledum'), 'Matches Profile: Self');
});

test('escapeRegExp makes names with regex metacharacters safe', () => {
  const name = 'Dr. (Sarah';
  assert.doesNotThrow(() => new RegExp(escapeRegExp(name), 'i'));
  assert.ok(new RegExp(escapeRegExp(name), 'i').test('see dr. (sarah today'));
});

test('normalizeDate rejects impossible calendar dates', () => {
  assert.equal(normalizeDate('15/03/2026').formatted, '15/03/2026');
  assert.equal(normalizeDate('2026-03-15').isValid, true);
  assert.equal(normalizeDate('31/02/2026').isValid, false);
  assert.equal(normalizeDate('31/04/2026').isValid, false);
  assert.equal(normalizeDate('29/02/2028').isValid, true);
});

test('sanitizer: household name is not marked Self for another profile owner', () => {
  const r = sanitizeAndValidateDocData(
    { patientName: 'Promise Ledum', eventTitle: 'X', appointmentDate: '01/10/2026' },
    { name: 'Alice Smith' } as any
  );
  assert.equal(r.patientMatch, 'Matches Profile: Household');
});

test('dedup hash is stable', () => {
  assert.equal(generateCompositeDedupHash('A B', '01/02/2026', 'T'), generateCompositeDedupHash('a-b', '01-02-2026', 't'));
});

test('parseIcsTime shares the fixed parser (no "Program" => midnight, first time of a range)', () => {
  assert.deepEqual(parseIcsTime('12:00 Program'), { h: 12, min: 0 });
  assert.deepEqual(parseIcsTime('9:00 AM - 5:00 PM'), { h: 9, min: 0 });
});
