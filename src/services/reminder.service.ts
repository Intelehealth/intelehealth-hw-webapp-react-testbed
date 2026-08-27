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

const SCHEDULE_BATCH_SIZE = 10;

export const scheduleMany = async (reminders: Reminder[]) => {
  const results: PromiseSettledResult<unknown>[] = [];
  for (let i = 0; i < reminders.length; i += SCHEDULE_BATCH_SIZE) {
    const batch = reminders.slice(i, i + SCHEDULE_BATCH_SIZE);
    results.push(
      ...(await Promise.allSettled(
        batch.map(reminder => scheduleReminder(reminder))
      ))
    );
  }

  const failures = results.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : []
  );
  if (failures.length) {
    throw new AggregateError(
      failures,
      `${failures.length} of ${reminders.length} reminders failed to schedule`
    );
  }
  return results;
};
