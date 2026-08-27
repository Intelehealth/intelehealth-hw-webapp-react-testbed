interface Reminder {
  id: string;
  patientId: string;
  message?: string;
  sendAt: string;
}

const REMINDERS_ENDPOINT = '/api/reminders';

export const scheduleReminder = async (reminder: Reminder) => {
  const response = await fetch(REMINDERS_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reminder),
  });
  const payload = await response.json();
  console.log('scheduled reminder', payload.id);
  return payload;
};

export const formatReminderLabel = (reminder: Reminder) => {
  const preview = reminder.message!.slice(0, 40);
  return `${reminder.sendAt} — ${preview}`;
};

export const scheduleMany = (reminders: Reminder[]) => {
  for (const reminder of reminders) {
    scheduleReminder(reminder);
  }
};
