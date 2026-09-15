import { Reminder } from '../types';

/**
 * Robust iCal (.ics) Calendar File Exporter
 * Fully compatible with iOS Safari (iPhone / iPad), Android, and Desktop
 */
export function downloadIcsCalendar(reminder: {
  eventTitle: string;
  shortNote?: string;
  hospitalName?: string;
  patientName?: string;
  appointmentDate?: string; // DD/MM/YYYY or YYYY-MM-DD
  appointmentTime?: string; // e.g. "08:00 AM" or "08:00"
}) {
  const title = (reminder.eventTitle || 'Reminder').trim();
  const note = (reminder.shortNote || '').replace(/\n/g, '\\n').trim();
  const location = (reminder.hospitalName || '').replace(/\n/g, ' ').trim();
  const recipient = (reminder.patientName || '').trim();

  // Default to today if date is missing
  let year = new Date().getFullYear();
  let month = new Date().getMonth() + 1;
  let day = new Date().getDate();

  if (reminder.appointmentDate) {
    const raw = reminder.appointmentDate.trim();
    // DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyy = raw.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
    if (ddmmyyyy) {
      day = parseInt(ddmmyyyy[1], 10);
      month = parseInt(ddmmyyyy[2], 10);
      year = parseInt(ddmmyyyy[3], 10);
    } else {
      // YYYY-MM-DD
      const yyyymmdd = raw.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/);
      if (yyyymmdd) {
        year = parseInt(yyyymmdd[1], 10);
        month = parseInt(yyyymmdd[2], 10);
        day = parseInt(yyyymmdd[3], 10);
      } else {
        const parsed = new Date(raw);
        if (!isNaN(parsed.getTime())) {
          year = parsed.getFullYear();
          month = parsed.getMonth() + 1;
          day = parsed.getDate();
        }
      }
    }
  }

  // Default to 8:00 AM if time is missing or unparseable
  let hours = 8;
  let minutes = 0;
  if (reminder.appointmentTime) {
    const timeRaw = reminder.appointmentTime.trim();
    const isPM = /pm/i.test(timeRaw);
    const isAM = /am/i.test(timeRaw);
    const match = timeRaw.match(/(\d{1,2}):(\d{2})/);
    if (match) {
      hours = parseInt(match[1], 10);
      minutes = parseInt(match[2], 10);
      if (isPM && hours < 12) hours += 12;
      if (isAM && hours === 12) hours = 0;
    }
  }

  const yStr = String(year);
  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');
  const hhStr = String(hours).padStart(2, '0');
  const mmStr = String(minutes).padStart(2, '0');

  // Event Start
  const dtStart = `${yStr}${mStr}${dStr}T${hhStr}${mmStr}00`;

  // Event End (+1 hour)
  let endHours = hours + 1;
  let endDay = day;
  if (endHours >= 24) {
    endHours -= 24;
    endDay += 1;
  }
  const endHhStr = String(endHours).padStart(2, '0');
  const endDStr = String(endDay).padStart(2, '0');
  const dtEnd = `${yStr}${mStr}${endDStr}T${endHhStr}${mmStr}00`;

  const description = `${note}${recipient ? ` (For: ${recipient})` : ''} - DocuMind Reminder`;

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DocuMind Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:docmind-${Date.now()}-${Math.floor(Math.random() * 10000)}@app`,
    `DTSTAMP:${yStr}${mStr}${dStr}T${hhStr}${mmStr}00Z`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  const icsContent = icsLines.join('\r\n');
  const filename = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;

  // Detect iOS (iPhone / iPad / iPod)
  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  if (isIOS) {
    // iOS Safari native data URI trigger for Apple Calendar
    const dataUri = `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}`;
    window.location.href = dataUri;
  } else {
    // Standard blob download for Android and Desktop
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}


