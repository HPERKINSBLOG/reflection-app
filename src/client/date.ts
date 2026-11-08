export function date(value: string, dateOnly = false): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    ...(dateOnly ? {} : { timeStyle: 'short' }),
  });
}
/** "Oct 28" within the current year, "Oct 28, 2025" outside it. */
export function shortDate(value: string, now = new Date()): string {
  const at = new Date(value);
  return at.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
/** Whether two instants fall on the same local calendar day. */
export function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
