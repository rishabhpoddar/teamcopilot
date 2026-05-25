import cronstrue from 'cronstrue';

interface CronjobSchedule {
  cron_expression: string;
  timezone: string;
  effective_cron_expression: string;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) {
    return 'th';
  }
  const lastDigit = day % 10;
  if (lastDigit === 1) return 'st';
  if (lastDigit === 2) return 'nd';
  if (lastDigit === 3) return 'rd';
  return 'th';
}

function parseCronNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function formatCronTime(hour: number, minute: number): string {
  const date = new Date(2026, 0, 1, hour, minute);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: minute === 0 ? undefined : '2-digit',
  }).format(date);
}

function formatSimpleCronExpression(cronExpression: string): string | null {
  const parts = cronExpression.trim().split(/\s+/);
  const normalizedParts = parts.length === 6 && parts[0] === '0' ? parts.slice(1) : parts;
  if (normalizedParts.length !== 5) return null;

  const [minutePart, hourPart, dayOfMonthPart, monthPart, dayOfWeekPart] = normalizedParts;
  if (monthPart !== '*') return null;

  const minute = parseCronNumber(minutePart, 0, 59);
  const hour = parseCronNumber(hourPart, 0, 23);
  if (minute === null || hour === null) return null;

  const time = formatCronTime(hour, minute);

  if (dayOfMonthPart === '*' && dayOfWeekPart === '*') {
    return `Every day at ${time}`;
  }

  if (dayOfMonthPart !== '*' && dayOfWeekPart === '*') {
    const dayOfMonth = parseCronNumber(dayOfMonthPart, 1, 31);
    if (dayOfMonth === null) return null;
    return `Monthly on the ${dayOfMonth}${ordinalSuffix(dayOfMonth)} at ${time}`;
  }

  if (dayOfMonthPart === '*' && dayOfWeekPart !== '*') {
    const days = dayOfWeekPart.split(',').map((day) => {
      const parsed = parseCronNumber(day, 0, 7);
      if (parsed === null) return null;
      return parsed === 7 ? 0 : parsed;
    });
    if (days.some((day) => day === null)) return null;

    const uniqueDays = Array.from(new Set(days as number[])).sort((a, b) => a - b);
    if (uniqueDays.join(',') === '1,2,3,4,5') {
      return `Every weekday at ${time}`;
    }
    if (uniqueDays.length === 1) {
      return `Every ${WEEKDAY_NAMES[uniqueDays[0]]} at ${time}`;
    }
  }

  return null;
}

export function formatCronjobSchedule(schedule: CronjobSchedule): string {
  const cronExpression = schedule.effective_cron_expression || schedule.cron_expression;
  const simpleDescription = formatSimpleCronExpression(cronExpression);
  if (simpleDescription) return simpleDescription;

  try {
    return cronstrue.toString(cronExpression);
  } catch {
    return 'Custom schedule';
  }
}

export function formatCronjobTimestamp(value: number | null): string {
  if (value === null) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function cronjobRunSummaryText(summary: string | null): string {
  return summary ?? 'Summary of result not available';
}
