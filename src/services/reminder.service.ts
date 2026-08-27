/**
 * Schedules appointment reminders through the reminders API.
 */

interface Reminder {
  id: string;
  patientId: string;
  message?: string;
  sendAt: string;
}

const REMINDERS_ENDPOINT = '/api/reminders';
const REMINDER_PREVIEW_LENGTH = 40;

export const scheduleReminder = async (reminder: Reminder) => {
  const response = await fetch(REMINDERS_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reminder),
  });
  if (!response.ok) {
    throw new Error(`Reminder scheduling failed: ${response.status}`);
  }
  return response.json();
};

export const formatReminderLabel = (reminder: Reminder) => {
  const preview = (reminder.message ?? '').slice(0, REMINDER_PREVIEW_LENGTH);
  return `${reminder.sendAt} — ${preview}`.trim();
};

export const scheduleMany = async (reminders: Reminder[]) => {
  const results = await Promise.allSettled(
    reminders.map(reminder => scheduleReminder(reminder))
  );
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) {
    throw new Error(`${failed.length} of ${reminders.length} reminders failed to schedule`);
  }
  return results;
};
