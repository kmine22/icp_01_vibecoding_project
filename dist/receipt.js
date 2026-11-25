function summarizeReceiptItems(items) {
  const tags = new Map();
  let done = 0;
  for (const item of items) {
    if (item.done) done++;
    for (const tag of new Set(item.tags?.length ? item.tags : [''])) {
      if (!tags.has(tag)) tags.set(tag, { label: tag || 'Untagged', total: 0, done: 0 });
      const group = tags.get(tag);
      group.total++;
      if (item.done) group.done++;
    }
  }
  const groups = [...tags.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  return { total: items.length, done, groups };
}

// Use one canvas for the proof and the exported PNG.
function drawMonthlyReceipt(canvas, recap) {
  const tasks = summarizeReceiptItems(recap.tasks);
  const events = recap.events;
  const width = 420;
  const margin = 28;
  const inner = width - 2 * margin;
  const height = 530 + 38 * Math.max(1, tasks.groups.length) + 25 * Math.max(1, events.length)
    + 28 * Math.max(1, recap.boards.length);
  const scale = Math.min(3, 4096 / height);
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const paper = '#faf7ef';
  const ink = '#292620';
  const mono = 'Menlo, Consolas, monospace';
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);

  function text(value, x, y, size, align = 'left', limit = inner, bold = false) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px ' + mono;
    ctx.textAlign = align;
    let label = String(value);
    if (ctx.measureText(label).width > limit) {
      const chars = Array.from(label);
      while (chars.length && ctx.measureText(chars.join('') + '…').width > limit) chars.pop();
      label = chars.join('') + '…';
    }
    ctx.fillText(label, x, y);
  }

  function rule(y, dashed = false) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.8;
    ctx.setLineDash(dashed ? [3, 4] : []);
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(width - margin, y);
    ctx.stroke();
  }

  function percentage({ done, total }) {
    return total ? Math.round(done * 100 / total) + '%' : '—';
  }

  ctx.fillStyle = ink;
  ctx.fillRect(margin, 28, inner, 26);
  ctx.fillStyle = paper;
  text('MONTHLY RECEIPT', margin + 9, 45, 12, 'left', inner, true);
  text(recap.key, width - margin - 9, 45, 12, 'right');
  ctx.fillStyle = ink;
  text(recap.name, width / 2, 82, 14, 'center');
  text(recap.monthLabel, width / 2, 128, 29, 'center', inner, true);
  rule(148);

  text('TASKS', margin, 175, 12, 'left', inner / 2, true);
  text(percentage(tasks), margin, 215, 38);
  text(tasks.done + ' of ' + tasks.total + ' complete', margin, 239, 12, 'left', inner / 2);
  text('EVENTS', width / 2, 175, 12, 'left', inner / 2, true);
  text(events.length, width / 2, 215, 38);
  rule(257, true);
  text('Scraps last saved', margin, 283, 13);
  text(recap.scrapCount, width - margin, 283, 13, 'right');
  text('Days with entries', margin, 307, 13);
  text(recap.days, width - margin, 307, 13, 'right');
  rule(324);

  let y = 352;
  text('TASKS BY TAG', margin, y, 13, 'left', inner, true);
  y += 28;
  if (!tasks.groups.length) {
    text('No tasks this month', margin, y, 13);
    y += 38;
  }
  for (const group of tasks.groups) {
    text(group.label, margin, y, 14, 'left', inner - 130);
    text(group.done + '/' + group.total + '  ' + percentage(group), width - margin, y, 13, 'right');
    ctx.fillStyle = '#d9d5cd';
    ctx.fillRect(margin, y + 6, inner, 5);
    ctx.fillStyle = ink;
    ctx.fillRect(margin, y + 6, inner * group.done / group.total, 5);
    y += 38;
  }
  rule(y - 5, true);
  y += 24;

  text('EVENT LIST', margin, y, 13, 'left', inner, true);
  y += 28;
  if (!events.length) {
    text('No events this month', margin, y, 13);
    y += 25;
  }
  const shortDate = (date) => date.slice(5).replace('-', '/');
  for (const event of events) {
    const date = shortDate(event.date);
    const range = event.lastDate === event.date ? date : date + '–' + shortDate(event.lastDate);
    text(event.title, margin, y, 13, 'left', inner - 100);
    text(range, width - margin, y, 12, 'right');
    y += 25;
  }
  rule(y - 5, true);
  y += 24;

  text('MOODBOARD SAVES', margin, y, 13, 'left', inner, true);
  y += 28;
  if (!recap.boards.length) {
    text('No scraps last saved this month', margin, y, 13);
    y += 28;
  }
  for (const board of recap.boards) {
    text(board.name, margin, y, 14, 'left', inner - 52);
    text(board.count, width - margin, y, 13, 'right');
    y += 28;
  }
  rule(y - 5);
  text('END OF RECEIPT', width / 2, y + 24, 12, 'center');
  canvas.setAttribute('aria-label', recap.monthLabel + '. ' + tasks.done + ' of ' + tasks.total +
    ' tasks completed. ' + events.length + ' events. ' +
    recap.scrapCount + ' scraps last saved. ' + recap.days + ' days with entries.');
}
