import 'server-only';

import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';

export type NormalizedCommunicationEvent = {
  source_fingerprint: string;
  customer_key: string;
  dealer: string | null;
  user_group: string | null;
  salesperson: string | null;
  customer_name: string;
  activity_at: string;
  direction: 'Inbound' | 'Outbound';
  channel: string;
  communication_type: string | null;
  interaction_result: string | null;
  lead_type: string | null;
  lead_status_type: string | null;
  lead_status: string | null;
  lead_source: string | null;
  lead_created_at: string | null;
  message_content: string | null;
  message_clean: string | null;
  actor_type: 'human' | 'automation';
  is_automated: boolean;
};

const EXPECTED_HEADERS = [
  'Dealer', 'User Group', 'User', 'Customer', 'Activity Date', 'Direction',
  'Comm Channel', 'Comm Type', 'Interaction Result', 'Lead Type',
  'Lead Status Type', 'Lead Status', 'Lead Source', 'Lead Created Date', 'Message Content'
] as const;

const REPORT_TIME_ZONE = 'America/Denver';

function text(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'object' && value && 'text' in value) return String((value as { text: unknown }).text ?? '').trim();
  if (typeof value === 'object' && value && 'richText' in value) {
    return ((value as { richText: Array<{ text?: string }> }).richText ?? []).map(part => part.text ?? '').join('').trim();
  }
  return String(value).trim();
}

function nullable(value: unknown) {
  const valueText = text(value);
  return valueText && valueText.toLowerCase() !== 'unknown' ? valueText : null;
}

function cleanMessage(value: string | null) {
  if (!value) return null;
  return value
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function sha(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second)
  };
}

function denverLocalToIso(raw: string) {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) throw new Error(`Unsupported report date: ${raw}`);
  const [, monthText, dayText, yearText, hourText, minuteText, meridiem] = match;
  let hour = Number(hourText) % 12;
  if (meridiem.toUpperCase() === 'PM') hour += 12;
  const target = {
    year: Number(yearText), month: Number(monthText), day: Number(dayText),
    hour, minute: Number(minuteText), second: 0
  };
  let guess = new Date(Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0));
  for (let i = 0; i < 3; i += 1) {
    const got = localParts(guess);
    const targetMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
    const gotMs = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const delta = targetMs - gotMs;
    if (delta === 0) break;
    guess = new Date(guess.getTime() + delta);
  }
  return guess.toISOString();
}

function parseReportDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    const year = value.getFullYear();
    let hour = value.getHours();
    const minute = String(value.getMinutes()).padStart(2, '0');
    const meridiem = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return denverLocalToIso(`${month}/${day}/${year} ${hour}:${minute} ${meridiem}`);
  }
  const raw = text(value);
  return raw ? denverLocalToIso(raw) : null;
}

function findHeaderRow(sheet: ExcelJS.Worksheet) {
  const scanLimit = Math.min(sheet.rowCount, 10);
  for (let rowNumber = 1; rowNumber <= scanLimit; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const headers = EXPECTED_HEADERS.map((_, index) => text(row.getCell(index + 1).value));
    if (headers.every((header, index) => header === EXPECTED_HEADERS[index])) return rowNumber;
  }
  throw new Error('Could not find the expected MotoSnap communication report headers.');
}

export async function parseCommunicationWorkbook(buffer: Buffer): Promise<NormalizedCommunicationEvent[]> {
  const workbook = new ExcelJS.Workbook();
  const loadInput = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(loadInput);
  const sheet = workbook.worksheets.find(ws => ws.name.toLowerCase() === 'report') ?? workbook.worksheets[0];
  if (!sheet) throw new Error('Workbook has no worksheets.');

  const headerRow = findHeaderRow(sheet);
  const events: NormalizedCommunicationEvent[] = [];
  const seen = new Set<string>();

  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const customerName = text(row.getCell(4).value);
    const activityRaw = row.getCell(5).value;
    const direction = text(row.getCell(6).value);
    const channel = text(row.getCell(7).value);
    if (!customerName || !activityRaw || !direction || !channel) continue;
    if (direction !== 'Inbound' && direction !== 'Outbound') throw new Error(`Unexpected direction on row ${rowNumber}: ${direction}`);

    const dealer = nullable(row.getCell(1).value);
    const userGroup = nullable(row.getCell(2).value);
    const salesperson = nullable(row.getCell(3).value);
    const activityAt = parseReportDate(activityRaw);
    if (!activityAt) continue;
    const communicationType = nullable(row.getCell(8).value);
    const leadCreatedAt = parseReportDate(row.getCell(14).value);
    const leadSource = nullable(row.getCell(13).value);
    const messageContent = nullable(row.getCell(15).value);
    const automated = Boolean(salesperson && /ava\s+virtual\s+assistant/i.test(salesperson));

    const identity = [
      dealer ?? '', userGroup ?? '', salesperson ?? '', customerName,
      activityAt, direction, channel, communicationType ?? '', leadCreatedAt ?? ''
    ].join('|').toLowerCase();
    let fingerprint = sha(identity);
    if (seen.has(fingerprint)) {
      const collisionKey = [identity, nullable(row.getCell(10).value) ?? '', leadSource ?? '', cleanMessage(messageContent) ?? ''].join('|');
      fingerprint = sha(collisionKey.toLowerCase());
    }
    seen.add(fingerprint);

    const customerKey = sha([
      dealer ?? '', customerName, leadCreatedAt ?? '', leadSource ?? ''
    ].join('|').toLowerCase());

    events.push({
      source_fingerprint: fingerprint,
      customer_key: customerKey,
      dealer,
      user_group: userGroup,
      salesperson,
      customer_name: customerName,
      activity_at: activityAt,
      direction,
      channel,
      communication_type: communicationType,
      interaction_result: nullable(row.getCell(9).value),
      lead_type: nullable(row.getCell(10).value),
      lead_status_type: nullable(row.getCell(11).value),
      lead_status: nullable(row.getCell(12).value),
      lead_source: leadSource,
      lead_created_at: leadCreatedAt,
      message_content: messageContent,
      message_clean: cleanMessage(messageContent),
      actor_type: automated ? 'automation' : 'human',
      is_automated: automated
    });
  }

  if (!events.length) throw new Error('The report contained no communication events.');
  return events;
}
