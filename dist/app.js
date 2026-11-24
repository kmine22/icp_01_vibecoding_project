const byId = (id) => document.getElementById(id);
const storageKey = 'study-planner-v1';
let data = { tasks: [], scraps: [] };
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && Array.isArray(saved.tasks) && Array.isArray(saved.scraps)) data = saved;
} catch {
  // The planner can still be used when browser storage is unavailable.
}
let month = new Date();
let activeDay = '';
let activeTask = '';
let activeScrap = '';
let draggedTask = '';
let statusTimeout;
let previewTimer;
let previewRequest;
let draftPreview;
const previewCache = new Map();

function previewCard(preview) {
  const card = element('div', 'preview-card');
  if (preview.image) {
    const image = element('img');
    image.src = preview.image;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => image.remove();
    card.append(image);
  }
  if (preview.title) card.append(element('strong', '', preview.title));
  if (preview.description) card.append(element('p', '', preview.description));
  return card;
}

function showDraft(content) {
  const container = byId('link-preview');
  container.replaceChildren(...(content ? [content] : []));
  container.hidden = !content;
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
    if (!response.ok) throw new Error('Preview unavailable. You can still save this link.');
    const preview = await response.json();
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
  const url = byId('scrap-link').value.trim();
  showDraft(null);
  if (!/^https?:\/\//i.test(url)) return;
  showDraft(element('p', 'hint', 'Loading preview…'));
  previewTimer = setTimeout(async () => {
    const isCurrent = () => byId('scrap-dialog').open && byId('scrap-link').value.trim() === url;
    try {
      const preview = await loadPreview(url);
      if (isCurrent()) {
        draftPreview = preview;
        showDraft(previewCard(preview));
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

function renderCalendar() {
  const year = month.getFullYear();
  const index = month.getMonth();
  const start = new Date(year, index, 1).getDay();
  const length = new Date(year, index + 1, 0).getDate();
  const today = keyFor(new Date());
  byId('month-title').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const cells = document.createDocumentFragment();
  for (let i = 0; i < Math.ceil((start + length) / 7) * 7; i++) {
    const day = i - start + 1;
    if (day < 1 || day > length) {
      cells.append(element('div', 'day blank'));
      continue;
    }
    const date = keyFor(new Date(year, index, day));
    const tasks = data.tasks.filter((task) => task.date === date);
    const cell = element('button', date === today ? 'day current' : 'day');
    cell.setAttribute('aria-label', dateLabel(date, { dateStyle: 'full' }) + ', ' + tasks.length + ' tasks');
    if (date === today) cell.setAttribute('aria-current', 'date');
    cell.append(element('span', 'number', day));
    tasks.slice(0, 2).forEach((task) => cell.append(element('span', task.done ? 'chip done' : 'chip', task.title)));
    if (tasks.length > 2) cell.append(element('span', 'more', '+' + (tasks.length - 2) + ' more'));
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
    });
    cells.append(cell);
  }
  byId('days').replaceChildren(cells);
}

function taskRow(task, inSidebar) {
  const row = element('div', 'task');
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  checkbox.setAttribute('aria-label', 'Mark ' + task.title + (task.done ? ' incomplete' : ' complete'));
  checkbox.addEventListener('change', () => {
    if (!changeTask(task.id, { done: checkbox.checked })) checkbox.checked = task.done;
  });
  const title = element('button', task.done ? 'task-name done' : 'task-name', task.title);
  if (inSidebar && task.date) title.append(element('span', 'task-date', shortDate(task.date)));
  title.addEventListener('click', () => {
    activeTask = task.id;
    byId('edit-title').value = task.title;
    byId('edit-date').value = task.date;
    byId('task-dialog').showModal();
  });
  row.append(checkbox, title);
  if (inSidebar) {
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      draggedTask = task.id;
      event.dataTransfer.setData('text/plain', task.id);
      event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      draggedTask = '';
      document.querySelectorAll('.drop').forEach((cell) => cell.classList.remove('drop'));
    });
  }
  return row;
}

function renderTasks() {
  const tasks = byId('tasks');
  tasks.replaceChildren();
  byId('task-count').textContent = data.tasks.length;
  const unscheduled = data.tasks.filter((task) => !task.date);
  const scheduled = data.tasks.filter((task) => task.date).sort((a, b) => a.date.localeCompare(b.date));
  for (const [label, group, empty] of [
    ['Unscheduled', unscheduled, 'New tasks start here.'],
    ['Scheduled', scheduled, 'Tasks with a date appear here.'],
  ]) {
    tasks.append(element('h3', 'group', label));
    if (!group.length) tasks.append(element('p', 'empty', empty));
    group.forEach((task) => tasks.append(taskRow(task, true)));
  }
}

function renderDay() {
  const tasks = data.tasks.filter((task) => task.date === activeDay);
  byId('day-tasks').replaceChildren(...(tasks.length ? tasks.map((task) => taskRow(task, false)) : [element('p', 'empty', 'No tasks scheduled.')]));
}

function openScrap(scrap) {
  activeScrap = scrap?.id || '';
  byId('scrap-form').reset();
  byId('scrap-title').value = scrap?.title || '';
  byId('scrap-note').value = scrap?.note || '';
  byId('scrap-link').value = scrap?.link || '';
  draftPreview = scrap?.preview;
  showDraft(draftPreview ? previewCard(draftPreview) : null);
  byId('scrap-heading').textContent = scrap ? 'Edit scrap' : 'Add scrap';
  byId('scrap-error').textContent = '';
  byId('delete-scrap').hidden = !scrap;
  byId('scrap-dialog').showModal();
}

function renderScraps() {
  const cards = data.scraps.map((scrap) => {
    const card = element('article', 'scrap');
    if (scrap.image) {
      const img = element('img');
      img.src = scrap.image;
      img.alt = scrap.title || 'Moodboard scrap';
      card.append(img);
    }
    if (scrap.title) card.append(element('h2', '', scrap.title));
    if (scrap.note) card.append(element('p', '', scrap.note));
    if (scrap.preview) card.append(previewCard(scrap.preview));
    if (scrap.link) {
      const link = element('a', '', 'Open link');
      link.href = scrap.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      card.append(link);
    }
    const edit = element('button', '', 'Edit');
    edit.addEventListener('click', () => openScrap(scrap));
    card.append(edit);
    return card;
  });
  byId('scraps').replaceChildren(...(cards.length ? cards : [element('p', 'empty', 'Add images, notes, or links to start your moodboard.')]));
}

function render() {
  renderCalendar();
  renderTasks();
  if (activeDay) renderDay();
  renderScraps();
}

function view(showBoard) {
  byId('planner').hidden = showBoard;
  byId('board').hidden = !showBoard;
  byId('planner-tab').setAttribute('aria-pressed', String(!showBoard));
  byId('board-tab').setAttribute('aria-pressed', String(showBoard));
}

byId('planner-tab').onclick = () => view(false);
byId('board-tab').onclick = () => view(true);
byId('new-scrap').onclick = () => openScrap();
byId('today').onclick = () => { month = new Date(); renderCalendar(); };
for (const [id, step] of [['previous', -1], ['next', 1]]) {
  byId(id).onclick = () => {
    month = new Date(month.getFullYear(), month.getMonth() + step, 1);
    renderCalendar();
  };
}
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.setAttribute('aria-labelledby', dialog.querySelector('h2').id || 'edit-heading');
  dialog.querySelector('.close').onclick = () => dialog.close();
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }
  });
});
for (const [form, input] of [['task-form', 'task-input'], ['day-form', 'day-input']]) {
  byId(form).onsubmit = (event) => {
    event.preventDefault();
    addTask(byId(input), form === 'day-form' ? activeDay : '');
  };
}
byId('edit-form').onsubmit = (event) => {
  event.preventDefault();
  const title = byId('edit-title').value.trim();
  if (title && changeTask(activeTask, { title, date: byId('edit-date').value })) byId('task-dialog').close();
};
byId('delete-task').onclick = () => {
  if (save({ ...data, tasks: data.tasks.filter((task) => task.id !== activeTask) })) byId('task-dialog').close();
};
byId('delete-scrap').onclick = () => {
  if (save({ ...data, scraps: data.scraps.filter((scrap) => scrap.id !== activeScrap) })) byId('scrap-dialog').close();
};
byId('scrap-form').onsubmit = async (event) => {
  event.preventDefault();
  const error = byId('scrap-error');
  error.textContent = '';
  const id = activeScrap || crypto.randomUUID();
  const previous = data.scraps.find((scrap) => scrap.id === id);
  const file = byId('scrap-image').files[0];
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
  let image = previous?.image || '';
  if (file) {
    if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
      error.textContent = 'Choose an image under 2 MB.';
      return;
    }
    try {
      image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } catch {
      error.textContent = 'Could not read that image.';
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
  if (!byId('scrap-dialog').open || byId('scrap-link').value.trim() !== link) return;
  const scrap = { id, title, note, link, image, preview };
  const scraps = previous ? data.scraps.map((item) => item.id === id ? scrap : item) : [...data.scraps, scrap];
  if (save({ ...data, scraps })) byId('scrap-dialog').close();
  else error.textContent = 'Browser storage is full. Try a smaller image.';
};

render();
