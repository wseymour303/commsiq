import { sendScheduledDigests, type DigestWindow } from '../../lib/server/digest-notifications';

export const config = { schedule: '0 * * * *' };

function mountainParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return { hour: Number(get('hour')), localDate: `${get('year')}-${get('month')}-${get('day')}` };
}

export default async () => {
  const { hour, localDate } = mountainParts(new Date());
  const windowByHour: Record<number, DigestWindow | undefined> = { 9: '9am', 13: '1pm', 18: '6pm' };
  const window = windowByHour[hour];
  if (!window) return new Response(JSON.stringify({ skipped: true, hour, localDate }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const result = await sendScheduledDigests({ window, localDate });
    return new Response(JSON.stringify({ window, localDate, ...result }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    console.error('CommsIQ scheduled digest failed', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Digest failed.' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
