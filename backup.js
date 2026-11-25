const plannerBackupFormat = 'study-planner';
const plannerBackupVersion = 1;

function encodePlannerBackup(planner) {
  return JSON.stringify({ format: plannerBackupFormat, version: plannerBackupVersion, planner }, null, 2);
}

function decodePlannerBackup(text) {
  const backup = JSON.parse(text);
  if (backup?.format !== plannerBackupFormat || backup.version !== plannerBackupVersion || !backup.planner) {
    throw new Error('Choose a Study Planner backup file.');
  }
  const saved = backup.planner;
  const isText = (value) => typeof value === 'string';
  const optionalText = (value) => value === undefined || isText(value);
  const optionalDate = (value) => value === undefined || value === '' || Boolean(calendarCsvDate(value));
  const tagsAreValid = (item) => item.tags === undefined || (Array.isArray(item.tags) && item.tags.every(isText));
  const inPage = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
  const validPostits = (notes) => notes === undefined || (Array.isArray(notes)
    && notes.every((note) => note && isText(note.id) && isText(note.text) && inPage(note.x) && inPage(note.y))
    && new Set(notes.map(({ id }) => id)).size === notes.length);
  const validators = {
    boards: (item) => isText(item.name) && optionalText(item.color),
    tasks: (item) => isText(item.title) && optionalDate(item.date) && tagsAreValid(item),
    events: (item) => isText(item.title) && Boolean(calendarCsvDate(item.date))
      && optionalDate(item.endDate) && isText(item.start) && isText(item.end) && tagsAreValid(item),
    scraps: (item) => ['boardId', 'title', 'note', 'link', 'image'].every((key) => optionalText(item[key]))
      && optionalDate(item.createdOn) && optionalDate(item.updatedOn) && validPostits(item.postits)
      && (item.preview == null || (typeof item.preview === 'object'
        && ['title', 'description', 'image'].every((key) => optionalText(item.preview[key])))),
  };
  for (const [key, validItem] of Object.entries(validators)) {
    if (!Array.isArray(saved[key]) || saved[key].some((item) => !item || !isText(item.id) || !validItem(item))) {
      throw new Error('The backup contains invalid ' + key + '.');
    }
  }
  if (!Array.isArray(saved.taskTags) || !saved.taskTags.every(isText) || !isText(saved.settings?.name)
      || !['light', 'dark', 'system'].includes(saved.settings.appearance)
      || !['graphite', 'midnight', 'forest', 'plum', 'rose'].includes(saved.settings.theme)
      || !['default', 'emoji', 'photo'].includes(saved.settings.iconType)
      || !isText(saved.settings.iconValue) || !saved.tagColors || !saved.filters
      || !Array.isArray(saved.filters.hiddenTags) || !saved.filters.hiddenTags.every(isText)
      || !['tasks', 'events', 'untagged'].every((key) => typeof saved.filters[key] === 'boolean')) {
    throw new Error('The backup settings are invalid.');
  }
  return saved;
}
