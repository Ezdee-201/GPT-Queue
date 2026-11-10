(() => {
  if (window.__promptQueueLoaded) return;
  window.__promptQueueLoaded = true;

  let running = false;
  let stopRequested = false;
  let currentSent = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('[PromptQueue]', ...a);

  // ---- Selectors (update here if ChatGPT changes its UI) ----
  const INPUT_SELECTORS = [
    '#prompt-textarea',
    'div.ProseMirror[contenteditable="true"]',
    'form [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[data-testid="prompt-textarea"]',
    'textarea[placeholder]',
    'textarea'
  ];
  const SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send"]'
  ];
  const STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop"]'
  ];

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  function findFirst(selectors, { needVisible = true, root = document } = {}) {
    for (const sel of selectors) {
      for (const el of root.querySelectorAll(sel)) {
        if (!needVisible || isVisible(el)) return el;
      }
    }
    return null;
  }

  // Anything inside a chat message, image viewer or dialog is never the composer.
  const NOT_COMPOSER = '[data-message-author-role], [data-testid^="conversation-turn"], article, [role="dialog"], [role="article"]';

  function getInput() {
    const candidates = [...document.querySelectorAll(INPUT_SELECTORS.join(','))]
      .filter((el) => isVisible(el) && !el.closest(NOT_COMPOSER) && !el.disabled && el.getAttribute('aria-hidden') !== 'true');
    if (!candidates.length) return null;

    const score = (el) => {
      let sc = 0;
      if (el.id === 'prompt-textarea') sc += 100;
      const form = el.closest('form');
      if (form) {
        sc += 20;
        if (findFirst(SEND_SELECTORS, { needVisible: false, root: form })) sc += 10;
      }
      if (el.isContentEditable || el.tagName === 'TEXTAREA') sc += 5;
      // the composer lives at the bottom of the viewport
      sc += Math.max(0, Math.min(1, el.getBoundingClientRect().bottom / window.innerHeight)) * 10;
      return sc;
    };
    return candidates.sort((a, b) => score(b) - score(a))[0];
  }

  function getSendBtn() {
    const input = getInput();
    const form = input && input.closest('form');
    return (form && findFirst(SEND_SELECTORS, { root: form })) || findFirst(SEND_SELECTORS);
  }

  const isGenerating = () => !!findFirst(STOP_SELECTORS);

  async function waitFor(fn, timeout = 30000, interval = 250) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (stopRequested) return null;
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  async function waitUntilIdle(timeout = 10 * 60 * 1000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (stopRequested) return false;
      if (!isGenerating()) return true;
      await sleep(500);
    }
    return false;
  }

  function setStatus(state) {
    chrome.storage.local.set({ runState: state });
  }

  const inputText = (el) => (el.tagName === 'TEXTAREA' ? el.value : el.innerText || el.textContent || '');
  const norm = (t) => t.replace(/\s+/g, ' ').trim();

  // Make sure the composer really owns keyboard focus before typing.
  async function focusInput(el) {
    for (let t = 0; t < 6; t++) {
      const a = document.activeElement;
      if (a === el || el.contains(a)) return true;
      if (a && a !== document.body) a.blur();
      el.scrollIntoView({ block: 'nearest' });
      el.click();
      el.focus();
      await sleep(100);
    }
    const a = document.activeElement;
    return a === el || el.contains(a);
  }

  async function setPromptText(el, text) {
    const want = norm(text).slice(0, 30);
    const landed = () => norm(inputText(el)).includes(want);
    const focused = await focusInput(el);

    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return landed();
    }

    // contenteditable (ProseMirror) - attempt 1: execCommand, only when we own focus
    if (focused) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, text);
      await sleep(200);
      if (landed()) return true;
    }

    // attempt 2: synthetic paste aimed directly at the composer (does not depend on focus)
    log('execCommand did not land, trying paste');
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(250);
    if (landed()) return true;

    // attempt 3: write into the composer's DOM directly
    log('paste did not land, writing DOM directly');
    el.innerHTML = '';
    text.split('\n').forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      el.appendChild(p);
    });
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    await sleep(250);
    return landed();
  }

  const checkStop = () => { if (stopRequested) throw new Error('STOPPED'); };

  async function sendPrompt(text) {
    currentSent = false;
    if (!(await waitUntilIdle())) { checkStop(); throw new Error('ChatGPT did not become idle in time.'); }

    const el = await waitFor(getInput, 15000);
    if (!el) { checkStop(); throw new Error('Could not find the ChatGPT input box. Open a chat and keep it visible.'); }

    if (!(await setPromptText(el, text))) throw new Error('Could not type into the ChatGPT input box. Click the message box once and try again.');

    const btn = await waitFor(() => {
      const b = getSendBtn();
      return b && !b.disabled ? b : null;
    }, 10000);
    checkStop();

    if (btn) {
      btn.click();
    } else {
      log('send button not found, pressing Enter');
      el.focus();
      ['keydown', 'keypress', 'keyup'].forEach((type) =>
        el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
      );
    }
    currentSent = true;

    const started = await waitFor(isGenerating, 20000);
    checkStop();
    if (!started) log('never saw the stop button; assuming a very fast reply');

    if (!(await waitUntilIdle())) { checkStop(); throw new Error('Timed out waiting for the reply to finish.'); }
    await sleep(1500);
    await waitUntilIdle(30000);
  }

  async function runQueue(prompts, offset = 0) {
    running = true;
    stopRequested = false;
    const total = offset + prompts.length;
    const finish = (phase, index, extra = {}) => {
      setStatus({ phase, running: false, index, total, ...extra });
      running = false;
    };

    for (let k = 0; k < prompts.length; k++) {
      const i = offset + k;
      if (stopRequested) return finish('stopped', i + 1);
      setStatus({ phase: 'running', running: true, index: i + 1, total, startedAt: Date.now() });
      try {
        await sendPrompt(prompts[k]);
      } catch (err) {
        console.error('[PromptQueue]', err);
        if (err.message === 'STOPPED') {
          const next = currentSent ? i + 2 : i + 1;
          return next > total ? finish('done', total) : finish('stopped', next);
        }
        return finish('failed', i + 1, { error: err.message });
      }
      await sleep(800);
    }
    finish('done', total);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'ping') {
      sendResponse({ ok: true, running });
    } else if (msg.type === 'start') {
      if (running) { sendResponse({ ok: false, error: 'Already running' }); return; }
      runQueue(msg.prompts, msg.offset || 0);
      sendResponse({ ok: true });
    } else if (msg.type === 'stop') {
      stopRequested = true;
      sendResponse({ ok: true });
    }
  });

  log('loaded');
})();
