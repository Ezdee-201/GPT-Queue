'use strict';

const CHAT_URL = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4M4.5 4.5v4h4"/>',
  play: '<path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4L9.2 5.1A.8.8 0 0 0 8 5.8z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/></g>'
};

function icon(name, size = 16) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const parsePrompts = (text) => text.split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const autosize = (ta) => {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, ta === els.input ? 120 : 180) + 'px';
};

const els = {
  pill: $('pill'), pillText: $('pillText'),
  banner: $('banner'), bannerText: $('bannerText'),
  head: $('head'), count: $('count'), clear: $('clear'),
  scroll: $('scroll'), list: $('list'), empty: $('empty'),
  composer: $('composer'), input: $('input'), add: $('add'),
  restart: $('restart'), primary: $('primary'), pIcon: $('pIcon'), pLabel: $('pLabel')
};

const state = {
  queue: [],                 // [{ id, text }]
  run: { phase: 'idle' },    // mirrors runState written by the content script
  runTabId: null,
  tab: { id: null, state: 'checking' },
  stopping: false,
  celebrate: false,
  focusId: null,
  justAdded: new Set(),
  dragId: null,
  clearArmed: null
};

/* ---------- state helpers ---------- */

const saveQueue = () => chrome.storage.local.set({ queue: state.queue });

function setRun(r) {
  state.run = r;
  chrome.storage.local.set({ runState: r });
}

// Any edit to the queue invalidates the previous run's progress.
function queueChanged() {
  saveQueue();
  if (state.run.phase !== 'idle') setRun({ phase: 'idle' });
  render();
}

function view() {
  const r = state.run;
  if (!r || r.phase === 'idle' || r.total !== state.queue.length) return { phase: 'idle' };
  return r;
}

function itemStatus(i, v) {
  if (v.phase === 'idle') return 'queued';
  const cur = v.index - 1;
  if (i < cur) return 'done';
  if (i > cur) return 'queued';
  return { running: 'running', failed: 'failed', stopped: 'paused', done: 'done' }[v.phase] || 'queued';
}

/* ---------- tab / messaging ---------- */

async function ping(tabId) {
  if (tabId == null) return null;
  try { return await chrome.tabs.sendMessage(tabId, { type: 'ping' }); } catch { return null; }
}

async function refreshTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!t || !CHAT_URL.test(t.url || '')) {
    state.tab = { id: null, state: 'no-chatgpt' };
  } else {
    const res = await ping(t.id);
    state.tab = { id: t.id, state: res ? 'ready' : 'needs-reload' };
  }
  return state.tab;
}

async function start(from = 0) {
  const t = await refreshTab();
  if (t.state !== 'ready') { render(); return; }
  const prompts = state.queue.slice(from).map((q) => q.text);
  if (!prompts.length) return;
  state.runTabId = t.id;
  await chrome.storage.local.set({ runTabId: t.id });
  state.celebrate = false;
  setRun({ phase: 'running', running: true, index: from + 1, total: state.queue.length, startedAt: Date.now() });
  render();
  try {
    const res = await chrome.tabs.sendMessage(t.id, { type: 'start', prompts, offset: from });
    if (!res?.ok) throw new Error(res?.error || 'Could not start');
  } catch {
    setRun({ phase: 'idle' });
    await refreshTab();
    render();
  }
}

async function stop() {
  state.stopping = true;
  render();
  const id = state.runTabId ?? state.tab.id;
  try { await chrome.tabs.sendMessage(id, { type: 'stop' }); } catch { /* tab gone */ }
  // If the tab can't answer, don't leave the UI stuck.
  setTimeout(async () => {
    if (state.stopping && !(await ping(id))) { state.stopping = false; setRun({ phase: 'idle' }); render(); }
  }, 2500);
}

/* ---------- rendering ---------- */

function render() {
  const v = view();
  renderPill(v);
  renderBanner(v);
  renderList(v);
  renderComposer(v);
  renderFooter(v);
}

function renderPill(v) {
  let st = 'idle', text = 'Ready';
  if (state.stopping && v.phase === 'running') { st = 'running'; text = 'Stopping…'; }
  else if (v.phase === 'running') { st = 'running'; text = `Running ${v.index} of ${v.total}`; }
  else if (v.phase === 'done') { st = 'done'; text = 'Finished'; }
  else if (v.phase === 'stopped') { st = 'paused'; text = `Paused at ${v.index}`; }
  else if (v.phase === 'failed') { st = 'failed'; text = `Failed at ${v.index}`; }
  els.pill.dataset.state = st;
  els.pillText.textContent = text;
}

function renderBanner(v) {
  const msg = {
    'no-chatgpt': 'Open a ChatGPT tab and switch to it to run the queue.',
    'needs-reload': 'Reload your ChatGPT tab once to finish setup.'
  }[state.tab.state];
  const show = !!msg && v.phase !== 'running';
  els.banner.hidden = !show;
  if (show) els.bannerText.textContent = msg;
}

function renderComposer(v) {
  const locked = v.phase === 'running';
  els.composer.dataset.locked = String(locked);
  els.input.disabled = locked;
  els.input.placeholder = locked ? 'Queue is running' : 'Write a prompt, press Enter to add';
  els.add.disabled = locked || !els.input.value.trim();
}

function renderFooter(v) {
  const n = state.queue.length;
  const ready = state.tab.state === 'ready';
  let action = 'run', label, ico, disabled = false, restart = false;

  if (v.phase === 'running') {
    action = 'stop'; ico = 'stop';
    label = state.stopping ? 'Stopping…' : 'Stop queue';
    disabled = state.stopping;
  } else if (v.phase === 'stopped' || v.phase === 'failed') {
    action = 'resume'; ico = 'play';
    label = `Resume at prompt ${v.index}`;
    disabled = !ready; restart = true;
  } else if (v.phase === 'done') {
    action = 'run'; ico = 'restart';
    label = 'Run again';
    disabled = !ready;
  } else {
    ico = 'play';
    label = n ? `Run ${plural(n, 'prompt')}` : 'Run queue';
    disabled = !n || !ready;
  }

  els.primary.dataset.action = action;
  els.primary.disabled = disabled;
  els.pLabel.textContent = label;
  els.pIcon.replaceChildren(icon(ico, 16));

  els.restart.hidden = !restart;
  if (restart) {
    els.restart.replaceChildren(icon('restart', 15), el('span', '', 'Restart'));
    els.restart.disabled = !ready;
  }
}

function renderList(v) {
  const n = state.queue.length;
  const locked = v.phase === 'running';

  els.empty.hidden = n > 0;
  els.list.hidden = n === 0;
  els.head.hidden = n === 0;
  els.count.textContent = plural(n, 'prompt');
  els.clear.disabled = locked;
  if (!state.clearArmed) { els.clear.textContent = 'Clear all'; delete els.clear.dataset.confirm; }

  els.list.classList.remove('celebrate');
  const frag = document.createDocumentFragment();
  state.queue.forEach((q, i) => frag.append(buildItem(q, i, v, locked)));
  els.list.replaceChildren(frag);
  if (state.celebrate) { els.list.classList.add('celebrate'); state.celebrate = false; }
  state.justAdded.clear();

  if (v.phase === 'running') {
    els.list.children[v.index - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (state.focusId) {
    els.list.querySelector(`[data-id="${state.focusId}"] .text`)?.focus();
    state.focusId = null;
  }
}

function buildItem(q, i, v, locked) {
  const status = itemStatus(i, v);
  const li = el('li', 'item');
  li.dataset.status = status;
  li.dataset.id = q.id;
  li.style.setProperty('--i', i);
  if (state.justAdded.has(q.id)) li.classList.add('enter');

  const node = el('div', 'node');
  node.setAttribute('aria-hidden', 'true');
  if (status === 'done') node.append(icon('check', 12));
  else if (status === 'failed') node.append(icon('x', 12));
  else node.textContent = String(i + 1);

  const card = el('div', 'card');
  const text = el('div', 'text', q.text);
  card.append(text);

  const meta = el('div', 'meta');
  if (status === 'running') {
    meta.append(el('span', '', 'Waiting for reply'), el('span', 'timer', fmt(Date.now() - (v.startedAt || Date.now()))));
  } else if (status === 'failed') {
    meta.classList.add('err');
    meta.textContent = v.error || 'Something went wrong.';
  } else if (status === 'paused') {
    meta.textContent = 'Paused here';
  }
  card.append(meta);

  if (!locked) {
    text.tabIndex = 0;
    text.setAttribute('role', 'button');
    text.setAttribute('aria-label', `Edit prompt ${i + 1}`);
    text.addEventListener('click', () => startEdit(q, text));
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); startEdit(q, text); }
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); nudge(q.id, -1); }
      else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); nudge(q.id, 1); }
      else if (e.key === 'Delete') { e.preventDefault(); removeItem(q.id); }
    });

    const tools = el('div', 'tools');
    const grip = el('button', 'icon grip'); grip.type = 'button';
    grip.setAttribute('aria-label', 'Drag to reorder'); grip.title = 'Drag to reorder';
    grip.append(icon('grip', 16));
    const del = el('button', 'icon del'); del.type = 'button';
    del.setAttribute('aria-label', 'Remove prompt'); del.title = 'Remove';
    del.append(icon('trash', 15));
    del.addEventListener('click', () => removeItem(q.id));
    tools.append(grip, del);
    card.append(tools);
    wireDrag(li, grip, q);
  }

  li.append(node, card, el('div', 'dropline'));
  return li;
}

/* ---------- actions ---------- */

function removeItem(id) {
  state.queue = state.queue.filter((q) => q.id !== id);
  queueChanged();
}

function nudge(id, dir) {
  const i = state.queue.findIndex((q) => q.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.queue.length) return;
  [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  state.focusId = id;
  queueChanged();
}

function startEdit(q, textEl) {
  if (view().phase === 'running') return;
  const ta = el('textarea', 'edit');
  ta.value = q.text;
  ta.rows = 2;
  ta.setAttribute('aria-label', 'Edit prompt');
  textEl.replaceWith(ta);
  autosize(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  let finished = false;
  const commit = (save) => {
    if (finished) return;
    finished = true;
    const v = ta.value.trim();
    if (save && v && v !== q.text) { q.text = v; queueChanged(); } else { render(); }
  };
  ta.addEventListener('input', () => autosize(ta));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  ta.addEventListener('blur', () => commit(true));
}

function wireDrag(li, grip, q) {
  grip.addEventListener('mousedown', () => { li.draggable = true; });
  li.addEventListener('dragstart', (e) => {
    state.dragId = q.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', q.id);
    const card = li.querySelector('.card');
    e.dataTransfer.setDragImage(card, 20, 20);
    requestAnimationFrame(() => li.classList.add('dragging'));
  });
  li.addEventListener('dragend', () => {
    li.draggable = false;
    state.dragId = null;
    clearDropMarks();
    li.classList.remove('dragging');
  });
  li.addEventListener('dragover', (e) => {
    if (!state.dragId || state.dragId === q.id) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearDropMarks();
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    const r = li.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    moveItem(state.dragId, q.id, after);
  });
}

const clearDropMarks = () =>
  els.list.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));

function moveItem(dragId, targetId, after) {
  if (!dragId || dragId === targetId) return;
  const from = state.queue.findIndex((q) => q.id === dragId);
  const [item] = state.queue.splice(from, 1);
  let to = state.queue.findIndex((q) => q.id === targetId);
  if (after) to += 1;
  state.queue.splice(to, 0, item);
  state.dragId = null;
  state.focusId = null;
  queueChanged();
}

function addFromInput() {
  const items = parsePrompts(els.input.value);
  if (!items.length) return;
  items.forEach((text) => {
    const q = { id: uid(), text };
    state.queue.push(q);
    state.justAdded.add(q.id);
  });
  els.input.value = '';
  autosize(els.input);
  queueChanged();
  requestAnimationFrame(() => els.scroll.scrollTo({ top: els.scroll.scrollHeight, behavior: 'smooth' }));
  els.input.focus();
}

/* ---------- events ---------- */

els.input.addEventListener('input', () => {
  autosize(els.input);
  els.add.disabled = !els.input.value.trim();
});
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addFromInput(); }
});
els.add.append(icon('plus', 18));
els.add.addEventListener('click', addFromInput);

els.clear.addEventListener('click', () => {
  if (state.clearArmed) {
    clearTimeout(state.clearArmed); state.clearArmed = null;
    state.queue = [];
    queueChanged();
    return;
  }
  els.clear.textContent = 'Click again to confirm';
  els.clear.dataset.confirm = 'true';
  state.clearArmed = setTimeout(() => {
    state.clearArmed = null;
    els.clear.textContent = 'Clear all';
    delete els.clear.dataset.confirm;
  }, 2500);
});

els.primary.addEventListener('click', () => {
  const v = view();
  const action = els.primary.dataset.action;
  if (action === 'stop') stop();
  else if (action === 'resume') start(v.index - 1);
  else start(0);
});
els.restart.addEventListener('click', () => start(0));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.runState) return;
  const prev = state.run;
  const next = changes.runState.newValue || { phase: 'idle' };
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  if (prev.phase === 'running' && next.phase === 'done') state.celebrate = true;
  if (next.phase !== 'running') state.stopping = false;
  state.run = next;
  render();
});

setInterval(() => {
  const v = view();
  if (v.phase !== 'running') return;
  const t = els.list.querySelector('.item[data-status="running"] .timer');
  if (t) t.textContent = fmt(Date.now() - (v.startedAt || Date.now()));
}, 1000);

/* ---------- init ---------- */

(async function init() {
  const s = await chrome.storage.local.get(['queue', 'draft', 'runState', 'runTabId']);
  let q = s.queue;
  if (!Array.isArray(q)) {
    // migrate the old single-textarea draft
    q = parsePrompts(s.draft || '').map((text) => ({ id: uid(), text }));
    chrome.storage.local.set({ queue: q });
  }
  state.queue = q;
  state.run = s.runState && s.runState.phase ? s.runState : { phase: 'idle' };
  state.runTabId = s.runTabId ?? null;
  render();

  await refreshTab();
  if (state.run.phase === 'running') {
    const alive = await ping(state.runTabId);
    if (!alive?.running) setRun({ phase: 'idle' });
  }
  render();
  if (state.run.phase !== 'running') els.input.focus();
})();
