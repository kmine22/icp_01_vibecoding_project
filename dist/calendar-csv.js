function readCalendarCsvRows(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else if (quoted || !value) {
        quoted = !quoted;
      } else {
        throw new Error('A quoted field in the CSV is invalid.');
      }
    } else if (!quoted && (character === ',' || character === '\n')) {
      row.push(value);
      value = '';
      if (character === '\n') {
        if (row.some((field) => field.trim())) rows.push(row);
        row = [];
      }
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error('A quoted field in the CSV is unfinished.');
  row.push(value);
  if (row.some((field) => field.trim())) rows.push(row);
  return rows;
}

function calendarCsvDate(value) {
  let date = value;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (us) date = [us[3], us[1].padStart(2, '0'), us[2].padStart(2, '0')].join('-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : '';
}

function calendarCsvTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(value);
  if (!match) return '';
  let hour = Number(match[1]);
  const meridiem = match[3]?.toUpperCase();
  if (Number(match[2]) > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12))) return '';
  if (meridiem) hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
  return String(hour).padStart(2, '0') + ':' + match[2];
}

function parseCalendarCsv(text) {
  const [firstRow, ...rows] = readCalendarCsvRows(text);
  const headers = firstRow?.map((value) => value.trim().toLowerCase()) || [];
  const titleIndex = headers.indexOf('subject');
  const dateIndex = headers.indexOf('start date');
  if (titleIndex < 0 || dateIndex < 0) throw new Error('CSV requires Subject and Start Date columns.');
  const endingDate = headers.indexOf('end date');
  const startTime = headers.indexOf('start time');
  const endTime = headers.indexOf('end time');
  const isAllDay = headers.indexOf('all day event');

  const events = [];
  let skipped = 0;
  for (const row of rows) {
    const value = (index) => row[index]?.trim() || '';
    const title = value(titleIndex).slice(0, 160);
    const date = calendarCsvDate(value(dateIndex));
    const endDate = value(endingDate) ? calendarCsvDate(value(endingDate)) : date;
    const allDay = value(isAllDay).toLowerCase() === 'true';
    const start = allDay ? '' : calendarCsvTime(value(startTime));
    const end = allDay ? '' : calendarCsvTime(value(endTime));
    const invalidTime = !allDay && ((value(startTime) && !start) || (value(endTime) && !end));
    if (!title || !date || !endDate || endDate < date || invalidTime || (end && (!start || (endDate === date && end < start)))) {
      skipped++;
      continue;
    }
    events.push({ title, date, endDate, start, end, importKey: 'csv:' + JSON.stringify([title, date, start, endDate, end]) });
  }
  return { events, skipped };
}
