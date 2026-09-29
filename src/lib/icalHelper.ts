import { buildIcsContent, icsFilename } from './icsBuilder';

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
  const icsContent = buildIcsContent({
    title: reminder.eventTitle,
    note: reminder.shortNote,
    location: reminder.hospitalName,
    recipient: reminder.patientName,
    date: reminder.appointmentDate,
    time: reminder.appointmentTime,
  });
  const filename = icsFilename(reminder.eventTitle);

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


