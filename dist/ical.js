function readIcalDate(field) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(field.value);
  if (!match) throw new Error('Invalid calendar date.');

  const [, year, month, day, hour, minute, second, utc] = match;
  const date = [year, month, day].join('-');
  const time = hour ? hour + ':' + minute + ':' + second : '00:00:00';
  const wallTime = Date.parse(date + 'T' + time + 'Z');
  if (!Number.isFinite(wallTime) || new Date(wallTime).toISOString().slice(0, 19) !== date + 'T' + time) {
    throw new Error('Invalid calendar date.');
  }
  if (!hour) return { date, time: '' };

  const zone = /(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i.exec(field.params);
  if (!utc && !zone) return { date, time: time.slice(0, 5) };
  let instant = wallTime;
  if (!utc) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone[1] || zone[2], hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      const fields = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
      const formatted = Date.parse(fields.year + '-' + fields.month + '-' + fields.day + 'T' +
        fields.hour + ':' + fields.minute + ':' + fields.second + 'Z');
      if (formatted === wallTime) break;
      if (attempt === 3) throw new Error('Unsupported calendar time.');
      instant += wallTime - formatted;
    }
  }
  const local = new Date(instant);
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date: [local.getFullYear(), pad(local.getMonth() + 1), pad(local.getDate())].join('-'),
    time: pad(local.getHours()) + ':' + pad(local.getMinutes()),
  };
}

function readIcalEvent(fields) {
  if (['RRULE', 'RDATE', 'RECURRENCE-ID'].some((key) => fields[key])) return null;
  if (!fields.DTSTART || (!fields.DTEND && fields.DURATION) || fields.STATUS?.value.toUpperCase() === 'CANCELLED') return null;

  const start = readIcalDate(fields.DTSTART);
  const end = fields.DTEND ? readIcalDate(fields.DTEND) : start;
  if (Boolean(start.time) !== Boolean(end.time) || end.date < start.date ||
      (start.time && fields.DTEND && end.date === start.date && end.time < start.time)) return null;

  let endDate = end.date;
  if (!start.time && fields.DTEND && endDate > start.date) {
    const exclusiveEnd = Date.parse(endDate + 'T00:00:00Z');
    endDate = new Date(exclusiveEnd - 86400000).toISOString().slice(0, 10);
  }
  const title = fields.SUMMARY?.value.replace(/\\([\\,;nN])/g, (_, char) => /n/i.test(char) ? ' ' : char).trim().slice(0, 160) || 'Untitled event';
  const importKey = fields.UID?.value.trim() || JSON.stringify([title, start.date, start.time, endDate, end.time]);
  return { title, date: start.date, endDate, start: start.time, end: fields.DTEND ? end.time : '', importKey };
}

function parseIcal(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  if (lines[0]?.trim().toUpperCase() !== 'BEGIN:VCALENDAR' ||
      lines.findLast((line) => line.trim())?.trim().toUpperCase() !== 'END:VCALENDAR') {
    throw new Error('Choose a valid .ics calendar file.');
  }

  const events = [];
  let skipped = 0;
  let fields;
  let depth = 0;
  for (const line of lines) {
    if (line.toUpperCase() === 'BEGIN:VEVENT' && !fields) {
      fields = Object.create(null);
      depth = 0;
      continue;
    }
    if (!fields) continue;
    if (line.toUpperCase() === 'END:VEVENT' && depth === 0) {
      try {
        const event = readIcalEvent(fields);
        if (event) events.push(event);
        else skipped++;
      } catch {
        skipped++;
      }
      fields = undefined;
    } else if (/^BEGIN:/i.test(line)) {
      depth++;
    } else if (/^END:/i.test(line)) {
      depth--;
    } else if (!depth) {
      const property = /^([^:;]+)([^:]*):(.*)$/.exec(line);
      if (property) fields[property[1].toUpperCase()] ??= { params: property[2], value: property[3] };
    }
  }
  if (fields) skipped++;
  return { events, skipped };
}
