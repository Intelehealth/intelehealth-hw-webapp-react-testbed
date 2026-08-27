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
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Reminder scheduling failed: ${response.status}${detail ? ` — ${detail}` : ''}`
    );
  }
  return response.json();
};

export const formatReminderLabel = (reminder: Reminder) => {
  const preview = (reminder.message ?? '').slice(0, REMINDER_PREVIEW_LENGTH);
  return `${reminder.sendAt} — ${preview}`.trim();
};

const DEFAULT_SCHEDULE_CONCURRENCY = 10;

export const scheduleMany = async (
  reminders: Reminder[],
  concurrency: number = DEFAULT_SCHEDULE_CONCURRENCY
) => {
  const laneCount = Math.max(1, Math.min(concurrency, reminders.length));
  const results: PromiseSettledResult<unknown>[] = new Array(reminders.length);

  /*
   * Each lane owns a fixed, disjoint set of indices (lane 0 takes 0, N, 2N…),
   * so no counter is shared between lanes and the work split is decided before
   * any request starts.
   */
  const lane = async (offset: number) => {
    for (let index = offset; index < reminders.length; index += laneCount) {
      results[index] = await scheduleReminder(reminders[index]).then(
        value => ({ status: 'fulfilled', value }) as const,
        reason => ({ status: 'rejected', reason }) as const
      );
    }
  };

  await Promise.all(Array.from({ length: laneCount }, (_, i) => lane(i)));

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
