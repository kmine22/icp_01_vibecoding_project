const byId = (id) => document.getElementById(id);
const storageKey = 'study-planner-v1';
const defaultBoard = { id: 'general', name: 'General' };
const defaultSettings = { name: 'Study Planner', theme: 'graphite', appearance: 'dark', iconType: 'default', iconValue: '' };
let data = { settings: defaultSettings, boards: [defaultBoard], tasks: [], taskTags: [], tagColors: {}, scraps: [], events: [], filters: { tasks: true, events: true, hiddenTags: [], untagged: true } };
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && Array.isArray(saved.tasks) && Array.isArray(saved.scraps)) {
    const events = (Array.isArray(saved.events) ? saved.events : []).map(({ tag, ...event }) => ({
      ...event,
      tags: Array.isArray(event.tags) ? event.tags : tag ? [tag] : [],
    }));
    const tags = Array.isArray(saved.taskTags) ? saved.taskTags : [];
    data = {
      ...data,
      ...saved,
      events,
      taskTags: [...new Set([...tags, ...saved.tasks.flatMap((task) => task.tags || []), ...events.flatMap((event) => event.tags)])],
      tagColors: saved.tagColors || {},
      boards: Array.isArray(saved.boards) ? saved.boards : [defaultBoard],
      scraps: saved.scraps.map((scrap) => ({ ...scrap, boardId: scrap.boardId || defaultBoard.id })),
      filters: {
        ...data.filters, ...saved.filters,
        hiddenTags: Array.isArray(saved.filters?.hiddenTags) ? saved.filters.hiddenTags : [],
      },
      settings: {
        ...defaultSettings,
        appearance: saved.settings?.theme === 'rose' ? 'light' : defaultSettings.appearance,
        ...saved.settings,
      },
    };
  }
} catch {
  // The planner can still be used when browser storage is unavailable.
}
let month = new Date();
let activeDay = '';
let activeTask = '';
let selectedTag = data.taskTags[0] || '';
let editingTag = '';
let chosenTagColor = '';
const tagPalette = [
  ['Graphite', '#84909e'], ['Red', '#e56670'], ['Orange', '#e89953'],
  ['Gold', '#d4ab3b'], ['Green', '#59a676'], ['Teal', '#36a6a1'],
  ['Blue', '#568fe0'], ['Purple', '#9578d4'], ['Pink', '#d67fa9'],
];
let activeEvent = '';
let activeScrap = '';
let scrapBaseline;
let scrapImageRemoved = false;
let scrapSession = 0;
let activeBoard = data.boards[0]?.id || '';
let boardToDelete = '';
let editingBoard = '';
let draggedTask = '';
let statusTimeout;
let previewTimer;
let previewRequest;
let draftPreview;
let suggestedTitle = '';
const previewCache = new Map();

function parseWebUrl(link) {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function isPinterestLink(link) {
  const url = parseWebUrl(link);
  return url && (url.hostname === 'pin.it' || (/(^|\.)pinterest\.(com|co\.kr|co\.uk|ca|de|fr)$/.test(url.hostname) && url.pathname.startsWith('/pin/')));
}

function pinterestTitle(link, preview) {
  return isPinterestLink(link) ? preview?.title?.trim().slice(0, 100) || '' : '';
}

function scrapbookImageLink(image, pageUrl) {
  if (!parseWebUrl(pageUrl)) return image;
  const link = element('a', 'scrap-image-link');
  link.href = pageUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Open original link in a new window');
  link.append(image);
  link.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    window.open(link.href, '_blank', 'popup,width=900,height=760,noopener,noreferrer');
    event.preventDefault();
  });
  return link;
}

function previewCard(preview, pin = false, pageUrl = '') {
  const card = element('div', pin ? 'preview-card pin-preview' : 'preview-card');
  if (preview.image) {
    const image = element('img');
    image.src = preview.image;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    const thumbnail = scrapbookImageLink(image, pageUrl);
    image.onerror = () => thumbnail.remove();
    card.append(thumbnail);
  }
  if (!pin && preview.title) card.append(element('strong', '', preview.title));
  if (preview.description && (!pin || !preview.image)) card.append(element('p', '', preview.description));
  return card;
}

function showDraft(...content) {
  const container = byId('link-preview');
  container.replaceChildren(...content);
  container.hidden = !content.length;
}

function showDraftPreview(preview) {
  const status = element('p', 'hint', preview.image ? 'Preview available.' : 'Text preview available. No thumbnail provided.');
  const card = previewCard(preview, isPinterestLink(byId('scrap-link').value.trim()));
  card.querySelector('img')?.addEventListener('error', () => {
    status.textContent = 'The thumbnail could not load. You can add an image manually.';
  });
  showDraft(status, card);
}

function cancelPreview() {
  clearTimeout(previewTimer);
  previewRequest?.abort();
}

async function loadPreview(url) {
  if (previewCache.has(url)) return previewCache.get(url);
  if (location.protocol === 'file:') throw new Error('Open the planner through the local server to load previews.');
  const controller = new AbortController();
  previewRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch('/api/preview?' + new URLSearchParams({ url }), { signal: controller.signal });
    const preview = await response.json().catch(() => null);
    if (!response.ok || !preview) {
      throw new Error(preview?.error || 'Could not check the preview. You can still save this link.');
    }
    if (!preview.title && !preview.description && !preview.image) throw new Error('No preview found. You can still save this link.');
    previewCache.set(url, preview);
    return preview;
  } finally {
    clearTimeout(timeout);
  }
}

byId('scrap-link').addEventListener('input', () => {
  cancelPreview();
  draftPreview = undefined;
  const titleInput = byId('scrap-title');
  if (suggestedTitle && titleInput.value === suggestedTitle) titleInput.value = '';
  suggestedTitle = '';
  const url = byId('scrap-link').value.trim();
  showDraft();
  if (!/^https?:\/\//i.test(url)) return;
  showDraft(element('p', 'hint', 'Loading preview…'));
  previewTimer = setTimeout(async () => {
    const isCurrent = () => byId('scrap-dialog').open && byId('scrap-link').value.trim() === url;
    try {
      const preview = await loadPreview(url);
      if (isCurrent()) {
        draftPreview = preview;
        if (!titleInput.value.trim()) {
          suggestedTitle = pinterestTitle(url, preview);
          titleInput.value = suggestedTitle;
        }
        showDraftPreview(preview);
      }
    } catch (error) {
      if (isCurrent()) showDraft(element('p', 'hint', error.name === 'AbortError' ? 'Preview unavailable. You can still save this link.' : error.message));
    }
  }, 350);
});
byId('scrap-dialog').addEventListener('close', cancelPreview);

const number = (value) => String(value).padStart(2, '0');
const keyFor = (date) => [date.getFullYear(), number(date.getMonth() + 1), number(date.getDate())].join('-');
const dateLabel = (key, options) => new Date(key + 'T12:00:00').toLocaleDateString(undefined, options);
const shortDate = (key) => dateLabel(key, { month: 'short', day: 'numeric' });

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function announce(message) {
  byId('status').textContent = message;
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => { byId('status').textContent = ''; }, 3500);
}

function save(next, message = '') {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    announce('Could not save to this browser. Try a smaller image or free up browser storage.');
    return false;
  }
  data = next;
  render();
  if (message) announce(message);
  return true;
}

function changeTask(id, changes, message) {
  return save({ ...data, tasks: data.tasks.map((task) => task.id === id ? { ...task, ...changes } : task) }, message);
}

function addTask(input, date) {
  const title = input.value.trim();
  if (!title) return;
  const task = { id: crypto.randomUUID(), title, date, done: false };
  if (save({ ...data, tasks: [...data.tasks, task] })) input.value = '';
}

function eventsFor(date) {
  return data.events.filter((event) => {
    if (event.date === date) return true;
    if (!event.endDate || date < event.date || date > event.endDate) return false;
    return date !== event.endDate || event.end !== '00:00';
  }).sort((a, b) => (a.date === date ? a.start : '').localeCompare(b.date === date ? b.start : ''));
}

function displayTime(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function eventTime(event, date) {
  if (!event.start) return 'All day';
  if (date !== event.date) return date === event.endDate && event.end ? 'Until ' + displayTime(event.end) : 'Continues';
  const start = displayTime(event.start);
  if (event.endDate && event.endDate !== event.date) return 'From ' + start;
  return event.end ? start + ' – ' + displayTime(event.end) : start;
}

function openEvent(date, event) {
  activeEvent = event?.id || '';
  byId('event-heading').textContent = event ? 'Edit event' : 'Add event';
  byId('event-title').value = event?.title || '';
  byId('event-date').value = event?.date || date;
  byId('event-end-date').value = event?.endDate && event.endDate !== event.date ? event.endDate : '';
  byId('event-start').value = event?.start || '';
  byId('event-end').value = event?.end || '';
  eventTagEditor.set(event?.tags);
  byId('event-done').checked = Boolean(event?.done);
  byId('event-error').textContent = '';
  byId('delete-event').hidden = !event;
  byId('event-dialog').showModal();
}

function lastCalendarDay(event) {
  if (!event.endDate || event.endDate <= event.date) return event.date;
  if (event.end !== '00:00') return event.endDate;
  const day = new Date(event.endDate + 'T12:00:00');
  day.setDate(day.getDate() - 1);
  return keyFor(day);
}

function appendWeekBars(fragment, week, row) {
  const laneEnds = [];
  const columnLanes = [];
  const spans = [...week.spans.values()].sort((a, b) => a.first - b.first || b.last - a.last);
  for (const { event, first, last, firstDate, lastDate } of spans) {
    let lane = laneEnds.findIndex((end) => end < first);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = last;
    for (let column = first; column <= last; column++) {
      columnLanes[column] = Math.max(columnLanes[column] || 0, lane + 1);
    }
    const bar = element('button', 'calendar-span', event.title);
    bar.style.gridRow = String(row);
    bar.style.gridColumn = first + ' / ' + (last + 1);
    bar.style.setProperty('--lane', String(lane));
    if (event.date < firstDate) bar.classList.add('from-previous');
    if (lastCalendarDay(event) > lastDate) bar.classList.add('into-next');
    applyTagColor(bar, data.tagColors[event.tags?.[0]]);
    bar.title = event.title + ' · ' + event.date + ' – ' + lastCalendarDay(event);
    bar.setAttribute('aria-label', bar.title);
    bar.onclick = () => openEvent(event.date, event);
    fragment.append(bar);
  }
  week.cells.forEach(({ cell, tasks, events }, column) => {
    const lanes = columnLanes[column] || 0;
    if (lanes) cell.style.setProperty('--span-lanes', String(lanes));
    appendDayItems(cell, tasks, events, lanes);
  });
}

function appendDayItems(cell, tasks, events, lanes) {
  const availableRows = Math.max(1, 4 - lanes);
  const total = tasks.length + events.length;
  const itemRows = total > availableRows ? availableRows - 1 : availableRows;
  const eventRows = tasks.length ? Math.max(0, itemRows - 1) : itemRows;
  const eventChips = events.slice(0, eventRows).map((event) =>
    element('span', 'chip event-chip', (event.start ? displayTime(event.start) + ' ' : '') + event.title)
  );
  const taskChips = tasks.slice(0, itemRows - eventChips.length).map((task) =>
    element('span', task.done ? 'chip done' : 'chip', task.title)
  );
  cell.append(...eventChips, ...taskChips);
  const remaining = total - taskChips.length - eventChips.length;
  if (remaining) cell.append(element('span', 'more', '+' + remaining + ' more'));
}

function renderCalendar() {
  const year = month.getFullYear();
  const index = month.getMonth();
  const start = new Date(year, index, 1).getDay();
  const length = new Date(year, index + 1, 0).getDate();
  const today = keyFor(new Date());
  byId('month-title').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const cells = document.createDocumentFragment();
  const weeks = [];
  for (let i = 0; i < Math.ceil((start + length) / 7) * 7; i++) {
    const day = i - start + 1;
    const row = Math.floor(i / 7) + 1;
    const column = i % 7 + 1;
    if (column === 1) weeks.push({ spans: new Map(), cells: [] });
    const week = weeks[row - 1];
    if (day < 1 || day > length) {
      const blank = element('div', 'day blank');
      blank.style.gridRow = String(row);
      blank.style.gridColumn = String(column);
      cells.append(blank);
      continue;
    }
    const date = keyFor(new Date(year, index, day));
    const tasks = data.filters.tasks ? data.tasks.filter((task) => task.date === date && matchesTagFilter(task)) : [];
    const events = data.filters.events ? eventsFor(date).filter(matchesTagFilter) : [];
    const cell = element('button', date === today ? 'day current' : 'day');
    cell.style.gridRow = String(row);
    cell.style.gridColumn = String(column);
    const singleDayEvents = [];
    for (const event of events) {
      if (lastCalendarDay(event) === event.date) {
        singleDayEvents.push(event);
      } else {
        const span = week.spans.get(event.id) || { event, first: column, firstDate: date };
        span.last = column;
        span.lastDate = date;
        week.spans.set(event.id, span);
      }
    }
    week.cells[column] = { cell, tasks, events: singleDayEvents };
    cell.setAttribute('aria-label', dateLabel(date, { dateStyle: 'full' }) + ', ' + tasks.length + ' tasks, ' + events.length + ' events');
    if (date === today) cell.setAttribute('aria-current', 'date');
    cell.append(element('span', 'number', day));
    cell.addEventListener('click', () => {
      activeDay = date;
      byId('day-title').textContent = dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' });
      byId('day-input').value = '';
      renderDay();
      byId('day-dialog').showModal();
    });
    cell.addEventListener('dragover', (event) => {
      if (!draggedTask) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      cell.classList.add('drop');
    });
    cell.addEventListener('dragleave', (event) => {
      if (!cell.contains(event.relatedTarget)) cell.classList.remove('drop');
    });
    cell.addEventListener('drop', (event) => {
      event.preventDefault();
      cell.classList.remove('drop');
      if (draggedTask) changeTask(draggedTask, { date }, 'Scheduled for ' + shortDate(date));
      draggedTask = '';
      byId('days').classList.remove('dragging-task');
    });
    cells.append(cell);
  }
  weeks.forEach((week, i) => appendWeekBars(cells, week, i + 1));
  byId('days').replaceChildren(cells);
}

function applyTagColor(node, color) {
  if (/^#[0-9a-f]{6}$/i.test(color)) node.style.setProperty('--tag-color', color);
}

function createTagEditor(listId, inputId, optionsId, addId) {
  const input = byId(inputId);
  let tags = [];
  function renderEditor() {
    byId(listId).replaceChildren(...tags.map((tag) => {
      const remove = element('button', 'task-tag remove-tag', tag + ' ×');
      applyTagColor(remove, data.tagColors[tag]);
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove tag ' + tag);
      remove.onclick = () => {
        tags = tags.filter((item) => item !== tag);
        renderEditor();
        input.focus();
      };
      return remove;
    }));
    byId(optionsId).replaceChildren(...data.taskTags.filter((tag) => !tags.includes(tag)).map((tag) => {
      const option = element('option');
      option.value = tag;
      return option;
    }));
  }
  function addTag() {
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const tag = data.taskTags.find((item) => item.toLowerCase() === name.toLowerCase()) || name;
    if (!tags.some((item) => item.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    input.value = '';
    renderEditor();
  }
  byId(addId).onclick = () => {
    addTag();
    input.focus();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && input.value.trim()) {
      event.preventDefault();
      addTag();
    }
  });
  return {
    set(value = []) {
      tags = [...value];
      input.value = '';
      renderEditor();
    },
    read() {
      addTag();
      return tags;
    },
  };
}

const taskTagEditor = createTagEditor('edit-tags', 'tag-name', 'known-tags', 'add-tag');
const eventTagEditor = createTagEditor('event-edit-tags', 'event-tag-name', 'event-known-tags', 'add-event-tag');

function openTask(task, focusTags = false) {
  activeTask = task.id;
  byId('edit-title').value = task.title;
  byId('edit-date').value = task.date;
  taskTagEditor.set(task.tags);
  byId('task-dialog').showModal();
  if (focusTags) byId('tag-name').focus();
}

function taskRow(task, showDate, draggable = showDate) {
  const row = element('div', 'task');
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  checkbox.setAttribute('aria-label', 'Mark ' + task.title + (task.done ? ' incomplete' : ' complete'));
  checkbox.addEventListener('change', () => {
    if (!changeTask(task.id, { done: checkbox.checked })) checkbox.checked = task.done;
  });
  const title = element('button', task.done ? 'task-name done' : 'task-name', task.title);
  if (showDate && task.date) title.append(element('span', 'task-date', shortDate(task.date)));
  title.addEventListener('click', () => openTask(task));
  const shortcut = element('button', 'tag-shortcut', '+ Tag');
  shortcut.setAttribute('aria-label', 'Add a tag to ' + task.title);
  shortcut.onclick = () => openTask(task, true);
  row.append(checkbox, title, shortcut);
  if (task.tags?.length) {
    const tags = element('div', 'task-tags');
    tags.append(...task.tags.map((tag) => {
      const chip = element('span', 'task-tag', tag);
      applyTagColor(chip, data.tagColors[tag]);
      return chip;
    }));
    row.append(tags);
  }
  if (draggable) {
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      draggedTask = task.id;
      byId('days').classList.add('dragging-task');
      event.dataTransfer.setData('text/plain', task.id);
      event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      draggedTask = '';
      byId('days').classList.remove('dragging-task');
      document.querySelectorAll('.drop').forEach((cell) => cell.classList.remove('drop'));
    });
  }
  return row;
}

function matchesTagFilter(item) {
  if (!item.tags?.length) return data.filters.untagged;
  return item.tags.some((tag) => !data.filters.hiddenTags.includes(tag));
}

function renderTagFilter() {
  const options = byId('tag-filter-options');
  const tags = [...data.taskTags, ''];
  const rows = tags.map((tag, index) => {
    const label = element('label', 'tag-filter-option');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    const visible = tag ? !data.filters.hiddenTags.includes(tag) : data.filters.untagged;
    checkbox.checked = visible;
    checkbox.onchange = () => {
      const filters = { ...data.filters };
      if (tag) {
        filters.hiddenTags = checkbox.checked
          ? filters.hiddenTags.filter((hidden) => hidden !== tag) : [...filters.hiddenTags, tag];
      } else {
        filters.untagged = checkbox.checked;
      }
      if (save({ ...data, filters })) options.children[index]?.firstElementChild?.focus();
      else checkbox.checked = visible;
    };
    label.append(checkbox);
    if (tag) {
      const dot = element('span', 'tag-dot');
      dot.setAttribute('aria-hidden', 'true');
      applyTagColor(dot, data.tagColors[tag]);
      label.append(dot);
    }
    label.append(element('span', '', tag || 'Untagged'));
    return label;
  });
  options.replaceChildren(...rows);
  const hidden = data.taskTags.filter((tag) => data.filters.hiddenTags.includes(tag)).length + Number(!data.filters.untagged);
  byId('tag-filter-status').textContent = hidden ? hidden + ' hidden' : '';
}

byId('reset-tag-filter').onclick = () => {
  const filters = { ...data.filters, hiddenTags: [], untagged: true };
  save({ ...data, filters });
};

function renderTasks() {
  const tasks = byId('tasks');
  tasks.replaceChildren();
  const visible = data.tasks.filter(matchesTagFilter);
  byId('task-count').textContent = visible.length;
  const unscheduled = visible.filter((task) => !task.date);
  const scheduled = visible.filter((task) => task.date).sort((a, b) => a.date.localeCompare(b.date));
  for (const [label, group, empty] of [
    ['Unscheduled', unscheduled, 'New tasks start here.'],
    ['Scheduled', scheduled, 'Tasks with a date appear here.'],
  ]) {
    tasks.append(element('h3', 'group', label));
    if (!group.length) tasks.append(element('p', 'empty', visible.length < data.tasks.length ? 'No matching tasks.' : empty));
    group.forEach((task) => tasks.append(taskRow(task, true)));
  }
}

function scrapLabel(scrap) {
  return scrap.title || scrap.preview?.title || scrap.note?.slice(0, 60) || scrap.link || 'Image scrap';
}

function lastScrapSave(scrap) {
  return scrap.updatedOn || scrap.createdOn;
}

function renderDayScraps() {
  const rows = data.scraps.filter((scrap) => lastScrapSave(scrap) === activeDay).map((scrap) => {
    const row = element('button', 'event-row', scrapLabel(scrap));
    row.onclick = () => {
      activeBoard = scrap.boardId;
      byId('day-dialog').close();
      view('board');
      renderScraps();
      const card = byId('scraps').querySelector('[data-scrap-id="' + CSS.escape(scrap.id) + '"]');
      card?.querySelector('button')?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: 'nearest' });
    };
    return row;
  });
  byId('day-scraps').replaceChildren(...(rows.length ? rows : [element('p', 'empty', 'No scraps were last saved on this date.')]));
}

function eventRow(event, date, showDate = false) {
  const row = element('button', 'event-row');
  const time = eventTime(event, date);
  row.append(element('span', 'task-date', showDate ? shortDate(date) + ' · ' + time : time),
    element('span', event.done ? 'done' : '', event.title));
  for (const tag of event.tags || []) {
    const chip = element('span', 'task-tag', tag);
    applyTagColor(chip, data.tagColors[tag]);
    row.append(chip);
  }
  row.onclick = () => openEvent(date, event);
  return row;
}

function renderDay() {
  renderDayScraps();
  const events = eventsFor(activeDay).filter(matchesTagFilter).map((event) => eventRow(event, activeDay));
  byId('day-events').replaceChildren(...(events.length ? events : [element('p', 'empty', 'No events scheduled.')]));
  const tasks = data.tasks.filter((task) => task.date === activeDay && matchesTagFilter(task));
  byId('day-tasks').replaceChildren(...(tasks.length ? tasks.map((task) => taskRow(task, false)) : [element('p', 'empty', 'No tasks scheduled.')]));
}

function openBoardEditor(board) {
  editingBoard = board?.id || '';
  byId('board-heading').textContent = board ? 'Rename board' : 'New board';
  byId('board-name').value = board?.name || '';
  byId('board-error').textContent = '';
  byId('board-dialog').showModal();
}

function openScrap(scrap) {
  scrapSession++;
  activeScrap = scrap?.id || '';
  byId('scrap-form').reset();
  scrapImageRemoved = false;
  updateScrapImageControls(scrap);
  const select = byId('scrap-board');
  select.replaceChildren(...data.boards.map((board) => {
    const option = element('option', '', board.name);
    option.value = board.id;
    return option;
  }));
  select.value = scrap?.boardId || activeBoard;
  const legacyTitle = !scrap?.title ? pinterestTitle(scrap?.link, scrap?.preview) : '';
  suggestedTitle = scrap?.titleFromPreview ? scrap.title : legacyTitle;
  byId('scrap-title').value = scrap?.title || legacyTitle;
  byId('scrap-note').value = scrap?.note || '';
  byId('scrap-link').value = scrap?.link || '';
  draftPreview = scrap?.preview;
  if (draftPreview) showDraftPreview(draftPreview);
  else showDraft();
  byId('scrap-heading').textContent = scrap ? 'Edit scrap' : 'Add scrap';
  byId('scrap-error').textContent = '';
  byId('delete-scrap').hidden = !scrap;
  scrapBaseline = scrapFields();
  byId('scrap-dialog').showModal();
}

function updateScrapImageControls(scrap) {
  byId('remove-scrap-image').hidden = !byId('scrap-image').files.length && (!scrap?.image || scrapImageRemoved);
  byId('scrap-image-hint').textContent = scrapImageRemoved && !byId('scrap-image').files.length
    ? 'Image will be removed when you save.'
    : 'Up to 20 MB. Large images are resized for storage.';
}

const boardMenu = byId('board-actions');
const boardCreate = byId('board-create');
const createToggle = byId('board-create-toggle');
const createActions = byId('board-create-actions');

function closeCreateMenu(restoreFocus = false) {
  createActions.hidden = true;
  createToggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) createToggle.focus();
}

for (const button of createActions.querySelectorAll('button')) {
  button.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const origin = createActions.getBoundingClientRect();
    const halfWidth = button.offsetWidth / 2;
    const halfHeight = button.offsetHeight / 2;
    const x = Math.max(-1, Math.min(1, (event.clientX - origin.left - button.offsetLeft - halfWidth) / halfWidth));
    const y = Math.max(-1, Math.min(1, (event.clientY - origin.top - button.offsetTop - halfHeight) / halfHeight));
    const corners = [x + y, -x + y, -x - y, x - y].map((offset) => (50 + offset * 7) + '%');
    button.style.setProperty('--pull-x', x * 6 + 'px');
    button.style.setProperty('--pull-y', y * 6 + 'px');
    button.style.setProperty('--pull-shape', corners.join(' '));
  });
  button.addEventListener('pointerleave', () => {
    for (const property of ['--pull-x', '--pull-y', '--pull-shape']) button.style.removeProperty(property);
  });
}

createToggle.onclick = () => {
  if (!createActions.hidden) {
    closeCreateMenu();
    return;
  }
  closeBoardMenu();
  createActions.hidden = false;
  createToggle.setAttribute('aria-expanded', 'true');
};
let boardMenuTrigger;
let draggedBoardId = '';

function closeBoardMenu(restoreFocus = false) {
  boardMenu.hidden = true;
  boardMenuTrigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) boardMenuTrigger?.focus();
}

function moveBoard(from, to) {
  if (from < 0 || to < 0 || to >= data.boards.length || from === to) return false;
  const boards = [...data.boards];
  const [board] = boards.splice(from, 1);
  boards.splice(to, 0, board);
  return save({ ...data, boards }, board.name + ' moved to position ' + (to + 1) + '.');
}

function enableBoardDrag(button, board, index, boardList) {
  button.draggable = true;
  const clearDropMarker = () => button.classList.remove('drop-before', 'drop-after');
  const dropsAfter = (event) => {
    const bounds = button.getBoundingClientRect();
    return event.clientX > bounds.left + bounds.width / 2;
  };
  button.addEventListener('dragstart', (event) => {
    closeBoardMenu();
    draggedBoardId = board.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', board.id);
  });
  button.addEventListener('dragover', (event) => {
    if (!draggedBoardId || draggedBoardId === board.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const after = dropsAfter(event);
    button.classList.toggle('drop-before', !after);
    button.classList.toggle('drop-after', after);
  });
  button.addEventListener('dragleave', clearDropMarker);
  button.addEventListener('drop', (event) => {
    if (!draggedBoardId) return;
    event.preventDefault();
    clearDropMarker();
    const from = data.boards.findIndex((item) => item.id === draggedBoardId);
    const to = index + Number(dropsAfter(event)) - Number(from < index);
    const movedOntoItself = draggedBoardId === board.id;
    draggedBoardId = '';
    if (!movedOntoItself) moveBoard(from, to);
  });
  button.addEventListener('dragend', () => {
    draggedBoardId = '';
    for (const target of boardList.querySelectorAll('.drop-before, .drop-after')) {
      target.classList.remove('drop-before', 'drop-after');
    }
  });
}

function renderScraps() {
  closeBoardMenu();
  boardMenuTrigger = undefined;
  byId('new-scrap').disabled = !activeBoard;
  const boardList = byId('board-list');
  boardList.replaceChildren(...data.boards.map((board, index) => {
    const item = element('div', 'board-picker');
    const button = element('button', 'board-button', board.name);
    const selected = board.id === activeBoard;
    button.setAttribute('aria-pressed', String(selected));
    if (data.boards.length > 1) enableBoardDrag(button, board, index, boardList);
    item.append(button);
    if (selected) {
      boardMenuTrigger = button;
      byId('move-board-left').disabled = index === 0;
      byId('move-board-right').disabled = index === data.boards.length - 1;
      button.setAttribute('aria-controls', 'board-actions');
      button.setAttribute('aria-expanded', 'false');
      item.append(boardMenu);
    }
    button.onclick = () => {
      if (board.id !== activeBoard) {
        activeBoard = board.id;
        renderScraps();
        boardMenuTrigger?.focus();
        return;
      }
      if (!boardMenu.hidden) {
        closeBoardMenu();
        return;
      }
      boardMenu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      boardMenu.classList.remove('align-right');
      if (boardMenu.getBoundingClientRect().right > byId('board').getBoundingClientRect().right) {
        boardMenu.classList.add('align-right');
      }
    };
    return item;
  }));
  const cards = data.scraps.filter((scrap) => scrap.boardId === activeBoard).map((scrap) => {
    const card = element('article', 'scrap');
    card.dataset.scrapId = scrap.id;
    if (scrap.image) {
      const img = element('img');
      img.src = scrap.image;
      img.alt = scrap.title || 'Moodboard scrap';
      card.append(scrapbookImageLink(img, scrap.link));
    }
    const pin = isPinterestLink(scrap.link);
    const title = scrap.title || pinterestTitle(scrap.link, scrap.preview);
    if (pin && scrap.preview?.image && !scrap.image) card.append(previewCard(scrap.preview, true, scrap.link));
    const pageUrl = parseWebUrl(scrap.link);
    if (pageUrl) {
      const heading = element('h2', title ? '' : 'scrap-link-fallback');
      const link = element('a', 'scrap-title-link', title || pageUrl.hostname);
      link.href = scrap.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      heading.append(link);
      card.append(heading);
    } else if (title) card.append(element('h2', '', title));
    if (scrap.note) card.append(element('p', '', scrap.note));
    if (scrap.preview && (!pin || !scrap.preview.image)) card.append(previewCard(scrap.preview, pin, scrap.link));
    const lastSaved = lastScrapSave(scrap);
    if (lastSaved) card.append(element('p', 'task-date', 'Last saved ' + dateLabel(lastSaved, { dateStyle: 'medium' })));
    if (!scrap.title && !scrap.note && !scrap.link && !scrap.image) card.append(element('p', 'empty', 'Empty scrap'));
    const edit = element('button', '', 'Edit');
    edit.addEventListener('click', () => openScrap(scrap));
    card.append(edit);
    return card;
  });
  const empty = activeBoard ? 'Add images, notes, or links to this board.' : 'Create a board to start collecting scraps.';
  byId('scraps').replaceChildren(...(cards.length ? cards : [element('p', 'empty', empty)]));
}

const settingsTheme = byId('settings-theme');
const themeSwatches = byId('theme-swatches');
const appearance = byId('settings-form').elements.namedItem('appearance');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const settingsIconType = byId('settings-icon-type');
let settingsSession = 0;
let settingsPhotoRemoved = false;
const maxImageBytes = 20 * 1024 * 1024;

function showIconFields() {
  byId('settings-emoji-fields').hidden = settingsIconType.value !== 'emoji';
  byId('settings-photo-fields').hidden = settingsIconType.value !== 'photo';
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function storeImage(file, maxDimension, maxBytes) {
  if (file.size <= maxBytes) return readImage(file);

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    let scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
      if (blob && blob.size <= maxBytes) return readImage(blob);
      scale *= 0.65;
    }
    throw new Error('Could not resize image.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function updateSettingsPhotoControls() {
  const hasSavedPhoto = data.settings.iconType === 'photo' && !settingsPhotoRemoved;
  byId('remove-settings-photo').hidden = !hasSavedPhoto && !byId('settings-photo').files.length;
  byId('settings-photo-hint').textContent = hasSavedPhoto
    ? 'Your current photo is saved. Choose a file to replace it.'
    : 'Up to 20 MB. Large photos are resized for storage.';
}

function appearanceMode(value) {
  if (value === 'system') return systemDark.matches ? 'dark' : 'light';
  return value;
}

function renderSwatches() {
  themeSwatches.dataset.theme = settingsTheme.value;
  themeSwatches.dataset.mode = appearanceMode(appearance.value);
}

function renderSettings() {
  document.documentElement.dataset.theme = data.settings.theme;
  document.documentElement.dataset.mode = appearanceMode(data.settings.appearance);
  document.title = data.settings.name;
  byId('planner-name').textContent = data.settings.name;
  const icon = byId('planner-icon');
  const { iconType, iconValue } = data.settings;
  icon.textContent = iconType === 'emoji' ? iconValue : '▦';
  if (iconType === 'photo' && iconValue) {
    const photo = element('img', 'planner-icon-photo');
    photo.src = iconValue;
    photo.alt = '';
    icon.replaceChildren(photo);
  }
}

byId('open-settings').onclick = () => {
  settingsSession++;
  byId('settings-error').textContent = '';
  settingsIconType.value = data.settings.iconType;
  byId('settings-emoji').value = data.settings.iconType === 'emoji' ? data.settings.iconValue : '';
  byId('settings-photo').value = '';
  settingsPhotoRemoved = false;
  updateSettingsPhotoControls();
  showIconFields();
  byId('settings-name').value = data.settings.name;
  settingsTheme.value = data.settings.theme;
  appearance.value = data.settings.appearance;
  renderSwatches();
  byId('settings-dialog').showModal();
};
byId('settings-form').addEventListener('change', renderSwatches);
settingsIconType.onchange = showIconFields;
byId('settings-photo').onchange = updateSettingsPhotoControls;
byId('remove-settings-photo').onclick = () => {
  byId('settings-photo').value = '';
  settingsPhotoRemoved = true;
  settingsIconType.value = 'default';
  showIconFields();
  updateSettingsPhotoControls();
  settingsIconType.focus();
};
document.querySelectorAll('[data-emoji]').forEach((button) => {
  button.onclick = () => { byId('settings-emoji').value = button.dataset.emoji; };
});
systemDark.addEventListener('change', () => {
  if (data.settings.appearance === 'system') renderSettings();
  if (byId('settings-dialog').open) renderSwatches();
});
byId('settings-form').onsubmit = async (event) => {
  event.preventDefault();
  const session = settingsSession;
  const error = byId('settings-error');
  const dialog = byId('settings-dialog');
  error.textContent = '';
  const name = byId('settings-name').value.trim() || defaultSettings.name;
  const iconType = settingsIconType.value;
  const settings = { name, theme: settingsTheme.value, appearance: appearance.value, iconType, iconValue: '' };
  if (iconType === 'emoji') {
    const emoji = byId('settings-emoji').value.trim();
    if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(emoji)) {
      error.textContent = 'Choose or enter an emoji.';
      return;
    }
    settings.iconValue = emoji;
  }
  if (iconType === 'photo') {
    const file = byId('settings-photo').files[0];
    if (file) {
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type) || file.size > maxImageBytes) {
        error.textContent = 'Choose a PNG, JPEG, WebP, GIF, or AVIF image up to 20 MB.';
        return;
      }
      try {
        settings.iconValue = await storeImage(file, 256, 128 * 1024);
      } catch {
        if (dialog.open && session === settingsSession) error.textContent = 'Could not read that photo.';
        return;
      }
      if (!dialog.open || session !== settingsSession || settingsIconType.value !== 'photo' || byId('settings-photo').files[0] !== file) return;
    } else if (data.settings.iconType === 'photo' && !settingsPhotoRemoved) {
      settings.iconValue = data.settings.iconValue;
    } else {
      error.textContent = 'Choose a photo for your planner icon.';
      return;
    }
  }
  if (save({ ...data, settings })) dialog.close();
  else error.textContent = 'Could not save your settings. Try a smaller photo.';
};
function renderTagPalette(palette, selected, choose) {
  palette.replaceChildren(...tagPalette.map(([name, color]) => {
    const button = element('button', 'tag-swatch');
    button.type = 'button';
    button.value = color;
    button.title = name;
    button.setAttribute('aria-label', name);
    button.setAttribute('aria-pressed', String(color === selected));
    applyTagColor(button, color);
    button.onclick = () => choose(color);
    return button;
  }));
}

function renderTagView() {
  if (!data.taskTags.includes(selectedTag)) selectedTag = data.taskTags[0] || '';
  byId('tags-month').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const monthKey = keyFor(month).slice(0, 7);
  const monthlyTasks = data.tasks.filter((task) => task.date?.slice(0, 7) === monthKey);
  const firstDay = monthKey + '-01';
  const lastDay = keyFor(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const monthlyEvents = data.events.filter((event) => event.date <= lastDay && lastCalendarDay(event) >= firstDay);
  let selectedButton;
  const items = data.taskTags.map((tag) => {
    const item = element('button', 'tag-list-item');
    item.setAttribute('aria-pressed', String(tag === selectedTag));
    if (tag === selectedTag) selectedButton = item;
    const dot = element('span', 'tag-dot');
    dot.setAttribute('aria-hidden', 'true');
    applyTagColor(dot, data.tagColors[tag]);
    const count = monthlyTasks.filter((task) => task.tags?.includes(tag)).length
      + monthlyEvents.filter((event) => event.tags?.includes(tag)).length;
    item.append(dot, element('span', 'tag-list-name', tag), element('span', 'tag-list-count', count));
    item.onclick = () => {
      selectedTag = tag;
      renderTagView()?.focus();
    };
    return item;
  });
  byId('tag-list').replaceChildren(...(items.length ? items : [element('p', 'empty', 'Create a tag or add one to a task or event.')]));
  byId('tag-tasks-heading').textContent = selectedTag || 'Tasks and events';
  byId('manage-tag').hidden = !selectedTag;
  const palette = byId('quick-tag-palette');
  palette.hidden = !selectedTag;
  if (selectedTag) renderTagPalette(palette, data.tagColors[selectedTag], (color) => {
    if (save({ ...data, tagColors: { ...data.tagColors, [selectedTag]: color } })) {
      [...palette.children].find((swatch) => swatch.value === color)?.focus();
    }
  });
  const tasks = monthlyTasks.filter((task) => task.tags?.includes(selectedTag))
    .sort((a, b) => a.date.localeCompare(b.date));
  const events = monthlyEvents.filter((event) => event.tags?.includes(selectedTag))
    .sort((a, b) => a.date.localeCompare(b.date));
  byId('tag-tasks').replaceChildren(...(selectedTag ? [
    element('h3', 'group', 'Tasks'),
    ...(tasks.length ? tasks.map((task) => taskRow(task, true, false)) : [element('p', 'empty', 'No tasks this month.')]),
  ] : []));
  byId('tag-events').replaceChildren(...(selectedTag ? [
    element('h3', 'group', 'Events'),
    ...(events.length ? events.map((event) => eventRow(event, event.date < firstDay ? firstDay : event.date, true))
      : [element('p', 'empty', 'No events this month.')]),
  ] : []));
  return selectedButton;
}

function showTagEditor(tag = '') {
  editingTag = tag;
  chosenTagColor = Object.hasOwn(data.tagColors, tag) ? data.tagColors[tag] : tag ? '' : tagPalette[0][1];
  byId('tag-dialog-title').textContent = tag ? 'Edit tag' : 'New tag';
  byId('manage-tag-name').value = tag;
  byId('tag-error').textContent = '';
  byId('delete-tag').hidden = !tag;
  renderTagPalette(byId('tag-palette'), chosenTagColor, (color) => {
    chosenTagColor = color;
    [...byId('tag-palette').children].forEach((swatch) => swatch.setAttribute('aria-pressed', String(swatch.value === color)));
  });
  byId('tag-dialog').showModal();
}

byId('new-tag').onclick = () => showTagEditor();
byId('manage-tag').onclick = () => showTagEditor(selectedTag);

function replaceTag(items, previous, replacement) {
  return items.map((item) => {
    if (!item.tags?.includes(previous)) return item;
    const tags = replacement ? item.tags.map((tag) => tag === previous ? replacement : tag)
      : item.tags.filter((tag) => tag !== previous);
    return { ...item, tags };
  });
}

byId('tag-form').onsubmit = (event) => {
  event.preventDefault();
  const name = byId('manage-tag-name').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (data.taskTags.some((tag) => tag !== editingTag && tag.toLowerCase() === name.toLowerCase())) {
    byId('tag-error').textContent = 'A tag already uses that name.';
    return;
  }
  const taskTags = editingTag ? data.taskTags.map((tag) => tag === editingTag ? name : tag) : [...data.taskTags, name];
  const tagColors = { ...data.tagColors };
  delete tagColors[editingTag];
  if (chosenTagColor) Object.defineProperty(tagColors, name, { value: chosenTagColor, enumerable: true, configurable: true });
  const renamed = editingTag && editingTag !== name;
  const tasks = renamed ? replaceTag(data.tasks, editingTag, name) : data.tasks;
  const events = renamed ? replaceTag(data.events, editingTag, name) : data.events;
  const filters = { ...data.filters, hiddenTags: data.filters.hiddenTags.map((tag) => tag === editingTag ? name : tag) };
  if (save({ ...data, taskTags, tasks, tagColors, events, filters })) {
    selectedTag = name;
    renderTagView();
    byId('tag-dialog').close();
  }
};
byId('delete-tag').onclick = () => {
  if (!editingTag || !window.confirm('Remove this tag from all tasks and events?')) return;
  const taskTags = data.taskTags.filter((tag) => tag !== editingTag);
  const tasks = replaceTag(data.tasks, editingTag, '');
  const tagColors = { ...data.tagColors };
  delete tagColors[editingTag];
  const events = replaceTag(data.events, editingTag, '');
  const filters = { ...data.filters, hiddenTags: data.filters.hiddenTags.filter((tag) => tag !== editingTag) };
  if (save({ ...data, taskTags, tasks, tagColors, events, filters })) {
    byId('tag-dialog').close();
    byId('new-tag').focus();
  }
};

function render() {
  renderSettings();
  renderCalendar();
  renderTasks();
  renderTagFilter();
  if (activeDay) renderDay();
  renderScraps();
  renderTagView();
}

function view(section) {
  if (section !== 'board') {
    closeBoardMenu();
    closeCreateMenu();
  }
  for (const [viewId, tabId] of [['planner', 'planner-tab'], ['board', 'board-tab'], ['tags-view', 'tags-tab']]) {
    byId(viewId).hidden = viewId !== section;
    byId(tabId).setAttribute('aria-pressed', String(viewId === section));
  }
}

for (const filter of ['tasks', 'events']) {
  const checkbox = byId('show-' + filter);
  checkbox.checked = data.filters[filter];
  checkbox.onchange = () => {
    if (!save({ ...data, filters: { ...data.filters, [filter]: checkbox.checked } })) {
      checkbox.checked = data.filters[filter];
    }
  };
}
byId('day-new-event').onclick = () => openEvent(activeDay);
byId('event-form').onsubmit = (submit) => {
  submit.preventDefault();
  const title = byId('event-title').value.trim();
  const date = byId('event-date').value;
  const endDate = byId('event-end-date').value || date;
  const start = byId('event-start').value;
  const end = byId('event-end').value;
  const error = byId('event-error');
  error.textContent = '';
  if (!title || !date) {
    error.textContent = 'Enter an event name and date.';
    return;
  }
  if (endDate < date) {
    error.textContent = 'Choose an end date on or after the start date.';
    return;
  }
  if (end && (!start || (endDate === date && end <= start))) {
    error.textContent = 'Choose an end time after the start time.';
    return;
  }
  const tags = eventTagEditor.read();
  const taskTags = [...new Set([...data.taskTags, ...tags])];
  const event = { id: activeEvent || crypto.randomUUID(), title, date, endDate, start, end, tags, done: byId('event-done').checked };
  const events = activeEvent ? data.events.map((item) => item.id === activeEvent ? { ...item, ...event } : item) : [...data.events, event];
  if (save({ ...data, events, taskTags }, 'Event saved for ' + shortDate(date))) byId('event-dialog').close();
};
const icalDialog = byId('ical-dialog');
const icalFile = byId('ical-file');
const icalResult = byId('ical-result');
let importSession = 0;

byId('open-ical-import').onclick = () => {
  importSession++;
  icalFile.value = '';
  icalResult.textContent = '';
  byId('settings-dialog').close();
  icalDialog.showModal();
};

byId('ical-form').onsubmit = async (event) => {
  event.preventDefault();
  const session = importSession;
  const file = icalFile.files[0];
  if (!file || file.size > 10 * 1024 * 1024) {
    icalResult.textContent = 'Choose a .ics file up to 10 MB.';
    return;
  }
  const importButton = byId('import-ical');
  importButton.disabled = true;
  try {
    const text = await file.text();
    if (!icalDialog.open || session !== importSession || icalFile.files[0] !== file) return;
    const { events, skipped } = parseIcal(text);
    const seen = new Set(data.events.map((item) => item.importKey).filter(Boolean));
    const imported = [];
    for (const item of events) {
      if (seen.has(item.importKey)) continue;
      seen.add(item.importKey);
      imported.push({ ...item, id: crypto.randomUUID() });
    }
    if (!imported.length || save({ ...data, events: [...data.events, ...imported] })) {
      const duplicates = events.length - imported.length;
      const message = [imported.length + ' imported'];
      if (duplicates) message.push(duplicates + ' already in your planner');
      if (skipped) message.push(skipped + ' skipped');
      icalResult.textContent = message.join(' · ');
    } else {
      icalResult.textContent = 'Could not save these events to browser storage.';
    }
  } catch (error) {
    if (icalDialog.open && session === importSession) icalResult.textContent = error.message;
  } finally {
    importButton.disabled = false;
  }
};

byId('delete-event').onclick = () => {
  if (save({ ...data, events: data.events.filter((event) => event.id !== activeEvent) })) byId('event-dialog').close();
};

byId('planner-tab').onclick = () => view('planner');
byId('board-tab').onclick = () => view('board');
byId('tags-tab').onclick = () => view('tags-view');
byId('new-board').onclick = () => {
  closeCreateMenu(true);
  openBoardEditor();
};
document.addEventListener('click', (event) => {
  if (!createActions.hidden && !boardCreate.contains(event.target)) closeCreateMenu();
  if (!boardMenu.hidden && !boardMenu.contains(event.target) && !boardMenuTrigger?.contains(event.target)) closeBoardMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!createActions.hidden) {
    event.preventDefault();
    closeCreateMenu(true);
  }
  if (!boardMenu.hidden) {
    event.preventDefault();
    closeBoardMenu(true);
  }
});
byId('rename-board').onclick = () => {
  closeBoardMenu(true);
  openBoardEditor(data.boards.find((board) => board.id === activeBoard));
};
for (const [id, offset] of [['move-board-left', -1], ['move-board-right', 1]]) {
  byId(id).onclick = () => {
    const index = data.boards.findIndex((board) => board.id === activeBoard);
    if (moveBoard(index, index + offset)) boardMenuTrigger?.focus();
  };
}
byId('board-form').onsubmit = (submit) => {
  submit.preventDefault();
  const name = byId('board-name').value.trim();
  const error = byId('board-error');
  error.textContent = '';
  if (!name) {
    error.textContent = 'Enter a board name.';
    return;
  }
  if (data.boards.some((board) => board.id !== editingBoard && board.name.toLowerCase() === name.toLowerCase())) {
    error.textContent = 'A board already uses that name.';
    return;
  }
  const board = { id: editingBoard || crypto.randomUUID(), name };
  const boards = editingBoard ? data.boards.map((item) => item.id === editingBoard ? board : item) : [...data.boards, board];
  const previousBoard = activeBoard;
  activeBoard = board.id;
  if (save({ ...data, boards })) byId('board-dialog').close();
  else activeBoard = previousBoard;
};
const deleteBoardDialog = byId('delete-board-dialog');
const moveScrapsTo = byId('move-scraps-to');

byId('delete-board').onclick = () => {
  const board = data.boards.find((item) => item.id === activeBoard);
  if (!board) return;
  closeBoardMenu(true);
  boardToDelete = board.id;
  const count = data.scraps.filter((scrap) => scrap.boardId === board.id).length;
  const otherBoards = data.boards.filter((item) => item.id !== board.id);
  const needsDestination = count > 0;
  const canDelete = !needsDestination || otherBoards.length > 0;
  byId('delete-board-heading').textContent = 'Delete ' + board.name + '?';
  byId('delete-board-message').textContent = !canDelete
    ? 'Create another board first so you have somewhere to move these scraps.'
    : needsDestination
      ? 'Choose where to move the ' + (count === 1 ? 'scrap' : count + ' scraps') + ' from this board.'
      : 'This board is empty and will be removed.';
  byId('move-scraps-field').hidden = !needsDestination || !canDelete;
  byId('confirm-board-delete').disabled = !canDelete;
  byId('confirm-board-delete').textContent = needsDestination ? 'Move scraps and delete' : 'Delete board';
  moveScrapsTo.required = needsDestination && canDelete;
  const placeholder = element('option', '', 'Choose a board');
  placeholder.value = '';
  moveScrapsTo.replaceChildren(placeholder, ...otherBoards.map((destination) => {
    const option = element('option', '', destination.name);
    option.value = destination.id;
    return option;
  }));
  moveScrapsTo.value = '';
  deleteBoardDialog.showModal();
};

byId('cancel-board-delete').onclick = () => deleteBoardDialog.close();
byId('delete-board-form').onsubmit = (event) => {
  event.preventDefault();
  if (!data.boards.some((board) => board.id === boardToDelete)) return;
  const boards = data.boards.filter((board) => board.id !== boardToDelete);
  const destination = boards.find((board) => board.id === moveScrapsTo.value);
  if (!destination && data.scraps.some((scrap) => scrap.boardId === boardToDelete)) return;
  const scraps = destination
    ? data.scraps.map((scrap) => scrap.boardId === boardToDelete ? { ...scrap, boardId: destination.id } : scrap)
    : data.scraps;
  const previousBoard = activeBoard;
  activeBoard = destination?.id || boards[0]?.id || '';
  if (save({ ...data, boards, scraps }, 'Board deleted.')) {
    deleteBoardDialog.close();
    (boardMenuTrigger || createToggle).focus();
  } else {
    activeBoard = previousBoard;
  }
};
byId('new-scrap').onclick = () => {
  if (!activeBoard) return;
  closeCreateMenu(true);
  openScrap();
};
byId('today').onclick = () => { month = new Date(); renderCalendar(); renderTagView(); };
for (const [id, step] of [['previous', -1], ['next', 1], ['tags-previous', -1], ['tags-next', 1]]) {
  byId(id).onclick = () => {
    month = new Date(month.getFullYear(), month.getMonth() + step, 1);
    renderCalendar();
    renderTagView();
  };
}
function scrapFields() {
  return JSON.stringify([scrapImageRemoved, ...['scrap-board', 'scrap-title', 'scrap-note', 'scrap-link'].map((id) => byId(id).value)]);
}

function mayCloseScrap() {
  const dirty = scrapFields() !== scrapBaseline || byId('scrap-image').files.length > 0;
  return !dirty || window.confirm('Discard your unsaved scrap changes?');
}

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.setAttribute('aria-labelledby', dialog.querySelector('h2').id || 'edit-heading');
  const isScrap = dialog.id === 'scrap-dialog';
  dialog.querySelector('.close').onclick = () => {
    if (!isScrap || mayCloseScrap()) dialog.close();
  };
  if (isScrap) {
    dialog.addEventListener('cancel', (event) => {
      if (!mayCloseScrap()) event.preventDefault();
    });
    return;
  }
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }
  });
});
byId('open-recap').onclick = () => {
  const key = keyFor(month).slice(0, 7);
  const tasks = data.tasks.filter((task) => task.date?.startsWith(key + '-'))
    .sort((a, b) => a.date.localeCompare(b.date));
  const days = new Set(tasks.map((task) => task.date));
  const counts = new Map();
  let scrapCount = 0;
  for (const scrap of data.scraps) {
    const date = lastScrapSave(scrap);
    if (!date?.startsWith(key + '-')) continue;
    days.add(date);
    counts.set(scrap.boardId, (counts.get(scrap.boardId) || 0) + 1);
    scrapCount++;
  }
  const boards = data.boards.filter((board) => counts.has(board.id))
    .map((board) => ({ name: board.name, count: counts.get(board.id) }))
    .sort((a, b) => b.count - a.count);
  const events = new Map();
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= lastDay; day++) {
    const date = key + '-' + number(day);
    for (const event of eventsFor(date)) {
      events.set(event.id, event);
      days.add(date);
    }
  }
  const groups = new Map();
  for (const event of events.values()) {
    for (const tag of event.tags?.length ? event.tags : ['']) {
      if (!groups.has(tag)) groups.set(tag, { label: tag || 'Untagged', total: 0, done: 0 });
      const group = groups.get(tag);
      group.total++;
      if (event.done) group.done++;
    }
  }
  const eventGroups = [...groups.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const canvas = byId('monthly-receipt');
  drawMonthlyReceipt(canvas, { key, name: data.settings.name, tasks, boards, scrapCount, eventGroups, days: days.size,
    eventCount: events.size, monthLabel: month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
  const download = byId('download-receipt');
  download.href = canvas.toDataURL('image/png');
  download.download = 'planner-receipt-' + key + '.png';
  byId('recap-dialog').showModal();
};

const historyList = byId('history-list');
const historyEntries = [...releaseHistory].reverse();
if (unreleasedChanges.length) historyEntries.unshift(['Unreleased', ...unreleasedChanges]);

historyList.replaceChildren(...historyEntries.map(([version, ...notes]) => {
  const entry = element('li', 'history-entry');
  const heading = element('h3', 'history-version', version);
  if (version !== 'Unreleased') {
    const [, minor = 0, patch = 0] = version.slice(1).split('.').map(Number);
    const kind = patch > 0 ? 'Patch' : minor > 0 ? 'Minor' : 'Major';
    heading.append(element('span', 'release-kind', kind));
  }
  entry.append(heading);
  if (notes.length === 1) {
    entry.append(element('p', '', notes[0]));
  } else {
    const changes = element('ul', 'release-notes');
    changes.append(...notes.map((note) => element('li', '', note)));
    entry.append(changes);
  }
  return entry;
}));
byId('open-history').onclick = () => {
  byId('history-dialog').showModal();
  historyList.scrollTop = 0;
};

for (const [form, input] of [['task-form', 'task-input'], ['day-form', 'day-input']]) {
  byId(form).onsubmit = (event) => {
    event.preventDefault();
    addTask(byId(input), form === 'day-form' ? activeDay : '');
  };
}
byId('edit-form').onsubmit = (event) => {
  event.preventDefault();
  const title = byId('edit-title').value.trim();
  if (!title) return;
  const tags = taskTagEditor.read();
  const date = byId('edit-date').value;
  const tasks = data.tasks.map((task) => task.id === activeTask ? { ...task, title, date, tags } : task);
  const taskTags = [...new Set([...data.taskTags, ...tags])];
  if (save({ ...data, tasks, taskTags })) byId('task-dialog').close();
};
byId('delete-task').onclick = () => {
  if (save({ ...data, tasks: data.tasks.filter((task) => task.id !== activeTask) })) byId('task-dialog').close();
};
byId('delete-scrap').onclick = () => {
  if (save({ ...data, scraps: data.scraps.filter((scrap) => scrap.id !== activeScrap) })) byId('scrap-dialog').close();
};
byId('scrap-image').onchange = () => updateScrapImageControls(data.scraps.find((scrap) => scrap.id === activeScrap));
byId('remove-scrap-image').onclick = () => {
  const input = byId('scrap-image');
  input.value = '';
  const scrap = data.scraps.find((item) => item.id === activeScrap);
  scrapImageRemoved = Boolean(scrap?.image);
  updateScrapImageControls(scrap);
  input.focus();
};
byId('scrap-form').onsubmit = async (event) => {
  event.preventDefault();
  const error = byId('scrap-error');
  error.textContent = '';
  const session = scrapSession;
  const fields = scrapFields();
  const id = activeScrap || crypto.randomUUID();
  const previous = data.scraps.find((scrap) => scrap.id === id);
  const file = byId('scrap-image').files[0];
  const boardId = byId('scrap-board').value;
  const title = byId('scrap-title').value.trim();
  const note = byId('scrap-note').value.trim();
  const link = byId('scrap-link').value.trim();
  if (link && !/^https?:\/\//i.test(link)) {
    error.textContent = 'Use an http or https link.';
    return;
  }
  if (!title && !note && !link && !file && !previous?.image) {
    error.textContent = 'Add a title, note, link, or image.';
    return;
  }
  let image = scrapImageRemoved ? '' : previous?.image || '';
  if (file) {
    if (!file.type.startsWith('image/') || file.size > maxImageBytes) {
      error.textContent = 'Choose an image up to 20 MB.';
      return;
    }
    try {
      image = await storeImage(file, 1600, 512 * 1024);
    } catch {
      if (byId('scrap-dialog').open && session === scrapSession) error.textContent = 'Could not process that image. Try a smaller file or another format.';
      return;
    }
  }
  let preview = draftPreview;
  if (link && !preview) {
    cancelPreview();
    try {
      showDraft(element('p', 'hint', 'Loading preview…'));
      preview = await loadPreview(link);
    } catch {
      // Links can still be saved when a source does not provide metadata.
    }
  }
  if (!byId('scrap-dialog').open || session !== scrapSession) return;
  if (scrapFields() !== fields || byId('scrap-image').files[0] !== file) {
    error.textContent = 'Your scrap changed while saving. Select Save scrap again.';
    return;
  }
  const updatedOn = keyFor(new Date());
  const createdOn = previous ? previous.createdOn : updatedOn;
  const previewTitle = pinterestTitle(link, preview);
  const savedTitle = title || previewTitle;
  const titleFromPreview = Boolean(savedTitle && (!title || title === suggestedTitle));
  const scrap = { ...previous, id, title: savedTitle, titleFromPreview, note, link, image, preview, boardId, createdOn, updatedOn };
  const scraps = previous ? data.scraps.map((item) => item.id === id ? scrap : item) : [...data.scraps, scrap];
  const message = boardId === activeBoard ? '' : 'Saved to ' + data.boards.find((board) => board.id === boardId).name;
  if (save({ ...data, scraps }, message)) byId('scrap-dialog').close();
  else error.textContent = 'Browser storage is full. Try a smaller image.';
};

render();
