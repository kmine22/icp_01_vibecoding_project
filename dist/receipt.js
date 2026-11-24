// The on-screen proof and the downloadable PNG use the same canvas.
function drawMonthlyReceipt(canvas, recap) {
  const width = 420;
  const margin = 28;
  const inner = width - 2 * margin;
  const taskRows = recap.tasks.slice(0, 6);
  const height = 562 + taskRows.length * 28 + Math.max(1, recap.boards.length) * 28 + Math.max(1, recap.eventGroups.length) * 38;
  canvas.width = width * 3;
  canvas.height = height * 3;
  const ctx = canvas.getContext('2d');
  ctx.scale(3, 3);
  const paper = '#faf7ef';
  const ink = '#292620';
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  const mono = 'Menlo, Consolas, monospace';
  const serif = 'Georgia, "Times New Roman", serif';

  function text(value, x, y, font, align = 'left', limit = inner) {
    ctx.font = font;
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

  ctx.fillStyle = ink;
  ctx.fillRect(margin, 28, inner, 26);
  ctx.fillStyle = paper;
  text('MONTHLY RECEIPT', margin + 9, 45, 'bold 12px ' + mono);
  text(recap.key, width - margin - 9, 45, '12px ' + mono, 'right');
  ctx.fillStyle = ink;
  text(recap.name, width / 2, 82, '14px ' + mono, 'center');
  text(recap.monthLabel, width / 2, 129, 'italic 40px ' + serif, 'center');
  rule(148);

  const done = recap.tasks.filter((task) => task.done).length;
  text(recap.tasks.length ? Math.round(done * 100 / recap.tasks.length) + '%' : '—', margin, 209, '52px ' + serif);
  text('TASK COMPLETION', margin + 148, 183, 'bold 13px ' + mono);
  text(done + ' of ' + recap.tasks.length + ' scheduled', margin + 148, 207, '15px ' + serif);
  rule(228, true);

  let y = 255;
  for (const [label, value] of [['Scheduled events', recap.eventCount], ['Scraps last saved', recap.scrapCount], ['Days with entries', recap.days]]) {
    text(label, margin, y, '16px ' + serif);
    text(value, width - margin, y, '15px ' + mono, 'right');
    y += 25;
  }
  rule(y - 6);
  y += 19;
  function section(name, shown, total) {
    text(name, margin, y, 'bold 12px ' + mono);
    text(shown + ' / ' + total, width - margin, y, '12px ' + mono, 'right');
    y += 30;
  }
  section('TASK LOG', taskRows.length, recap.tasks.length);
  for (const task of taskRows) {
    text(task.done ? '[x]' : '[ ]', margin, y, '14px ' + mono);
    text(task.title, margin + 35, y, '16px ' + serif, 'left', inner - 80);
    text(task.date.slice(-2), width - margin, y, '13px ' + mono, 'right');
    y += 28;
  }
  rule(y, true);
  y += 28;
  text('EVENT COMPLETION BY TAG', margin, y, 'bold 12px ' + mono);
  y += 28;
  if (!recap.eventGroups.length) {
    text('No scheduled events', margin, y, 'italic 16px ' + serif);
    y += 38;
  }
  for (const group of recap.eventGroups) {
    const fraction = group.done / group.total;
    text(group.label, margin, y, '16px ' + serif, 'left', inner - 140);
    text(group.done + '/' + group.total + '  ' + Math.round(fraction * 100) + '%', width - margin, y, '13px ' + mono, 'right');
    ctx.fillStyle = '#d9d5cd';
    ctx.fillRect(margin, y + 6, inner, 5);
    ctx.fillStyle = ink;
    ctx.fillRect(margin, y + 6, inner * fraction, 5);
    y += 38;
  }
  rule(y, true);
  y += 25;
  text('MOODBOARD SAVES', margin, y, 'bold 12px ' + mono);
  y += 28;
  if (!recap.boards.length) {
    text('No scraps last saved this month', margin, y, 'italic 16px ' + serif);
    y += 28;
  }
  for (const board of recap.boards) {
    text(board.name, margin, y, '16px ' + serif, 'left', inner - 70);
    text(board.count, width - margin, y, '15px ' + mono, 'right');
    y += 28;
  }
  rule(y);
  text(recap.monthLabel + '  /  END OF RECEIPT', width / 2, y + 33, '12px ' + mono, 'center');
  canvas.setAttribute('aria-label', recap.monthLabel + ': ' + done + ' of ' + recap.tasks.length +
    ' tasks complete, ' + recap.eventCount + ' events, ' + recap.scrapCount + ' scraps, ' + recap.days + ' days with entries. ' +
    recap.eventGroups.map((group) => group.label + ': ' + group.done + ' of ' + group.total + ' events complete.').join(' ') +
    ' ' + recap.boards.map((board) => board.name + ': ' + board.count + ' scraps.').join(' '));
}
