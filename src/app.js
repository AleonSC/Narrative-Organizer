'use strict';

(function () {
  // ======================================================================
  //  Constants & state
  // ======================================================================

  const COLORS = ['#5b7cfa', '#ef7d57', '#3fb6a8', '#a36bd6', '#e6b422', '#5fb760', '#e7608f', '#7d8fa3'];
  const CARD_W = 220;
  const CARD_H = 124;
  const GAP = 30;
  const LANE_H = 172;
  const LABEL_W = 200;
  const LEFT_PAD = 16;
  const TOP_PAD = 36;
  const COL_W = CARD_W + GAP;

  const api = window.narrativeAPI || makeBrowserAPI();

  function emptyProject() {
    return {
      version: 1,
      title: 'Untitled Narrative',
      nextNum: 1,
      entries: {},
      listOrder: [],
      branches: [{ id: 'main', name: 'Main Timeline', color: COLORS[0], parent: null, forkAfter: null, items: [] }],
    };
  }

  let state = emptyProject();

  const ui = {
    view: 'list',
    search: '',
    filter: 'all',
    draft: { title: '', text: '', tags: '' },
    composerPlace: 'none',
    readPath: 'main',
    readTitles: false,
    readSep: 'paragraph',
    readSize: 19,
    scroll: {},
    editing: null,
  };

  loadUiPrefs();

  // ======================================================================
  //  Small utilities
  // ======================================================================

  function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, sv);
            else el.style[sk] = sv;
          }
        }
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'selected') el.setAttribute('selected', '');
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }

  function svg(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function debounce(fn, ms) {
    let t = null;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn(...args);
      }, ms);
    };
    wrapped.flush = () => {
      if (t) {
        clearTimeout(t);
        t = null;
        fn();
      }
    };
    return wrapped;
  }

  function parseTags(str) {
    return [...new Set(String(str || '').split(',').map((t) => t.trim()).filter(Boolean))];
  }

  function wordCount(text) {
    const m = String(text || '').trim().match(/\S+/g);
    return m ? m.length : 0;
  }

  function entryLabel(entry) {
    if (entry.title && entry.title.trim()) return entry.title.trim();
    const first = String(entry.text || '').trim().split(/\n/)[0];
    if (!first) return 'Untitled idea';
    return first.length > 60 ? first.slice(0, 57) + '…' : first;
  }

  function preview(entry, max = 220) {
    const t = String(entry.text || '').trim().replace(/\s+/g, ' ');
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  // Text shown under a card's heading: everything the heading doesn't already show.
  function bodyPreview(entry, max = 220) {
    if (entry.title && entry.title.trim()) return preview(entry, max);
    const text = String(entry.text || '').trim();
    const nl = text.indexOf('\n');
    const first = nl < 0 ? text : text.slice(0, nl);
    if (first.length > 60) return preview(entry, max);
    return preview({ text: nl < 0 ? '' : text.slice(nl + 1) }, max);
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function isTextField(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }

  function loadUiPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('narrative-ui') || '{}');
      for (const k of ['view', 'readTitles', 'readSep', 'readSize', 'composerPlace']) if (k in p) ui[k] = p[k];
      if (p.theme === 'dark') document.documentElement.dataset.theme = 'dark';
    } catch {
      /* preferences are optional */
    }
  }

  function saveUiPrefs() {
    try {
      localStorage.setItem(
        'narrative-ui',
        JSON.stringify({
          view: ui.view,
          readTitles: ui.readTitles,
          readSep: ui.readSep,
          readSize: ui.readSize,
          composerPlace: ui.composerPlace,
          theme: document.documentElement.dataset.theme || 'light',
        })
      );
    } catch {
      /* preferences are optional */
    }
  }

  // ======================================================================
  //  Data model helpers
  // ======================================================================

  function normalize(data) {
    const p = emptyProject();
    if (!data || typeof data !== 'object') return p;
    p.title = typeof data.title === 'string' ? data.title : p.title;
    p.entries = {};
    let maxNum = 0;
    for (const [id, e] of Object.entries(data.entries || {})) {
      if (!e || typeof e !== 'object') continue;
      const num = Number(e.num) || 0;
      maxNum = Math.max(maxNum, num);
      p.entries[id] = {
        id,
        num,
        title: String(e.title || ''),
        text: String(e.text || ''),
        tags: Array.isArray(e.tags) ? e.tags.map(String) : [],
        color: e.color || null,
        created: e.created || Date.now(),
        updated: e.updated || Date.now(),
        board: e.board && Number.isFinite(e.board.x) && Number.isFinite(e.board.y) ? { x: e.board.x, y: e.board.y, z: Number(e.board.z) || 0 } : null,
      };
    }
    for (const e of Object.values(p.entries)) if (!e.num) e.num = ++maxNum;
    p.nextNum = Math.max(Number(data.nextNum) || 1, maxNum + 1);

    const seenOrder = new Set();
    p.listOrder = (data.listOrder || []).filter((id) => p.entries[id] && !seenOrder.has(id) && seenOrder.add(id));
    for (const id of Object.keys(p.entries)) if (!seenOrder.has(id)) p.listOrder.push(id);

    const placed = new Set();
    const branches = Array.isArray(data.branches) && data.branches.length ? data.branches : p.branches;
    p.branches = branches
      .filter((b) => b && b.id)
      .map((b, i) => ({
        id: String(b.id),
        name: String(b.name || (b.id === 'main' ? 'Main Timeline' : 'Branch')),
        color: b.color || COLORS[i % COLORS.length],
        parent: b.parent || null,
        forkAfter: b.forkAfter || null,
        items: (b.items || []).filter((id) => p.entries[id] && !placed.has(id) && placed.add(id)),
      }));
    if (!p.branches.some((b) => b.id === 'main')) {
      p.branches.unshift({ id: 'main', name: 'Main Timeline', color: COLORS[0], parent: null, forkAfter: null, items: [] });
    }
    const ids = new Set(p.branches.map((b) => b.id));
    for (const b of p.branches) {
      if (b.id === 'main') b.parent = null;
      else if (!b.parent || !ids.has(b.parent) || b.parent === b.id) b.parent = 'main';
    }
    // Break any parent cycles by re-attaching to main.
    for (const b of p.branches) {
      const seen = new Set([b.id]);
      let cur = b;
      while (cur.parent) {
        if (seen.has(cur.parent)) {
          b.parent = 'main';
          break;
        }
        seen.add(cur.parent);
        cur = p.branches.find((x) => x.id === cur.parent);
      }
    }
    return p;
  }

  function branchById(id) {
    return state.branches.find((b) => b.id === id) || null;
  }

  function locate(entryId) {
    for (const b of state.branches) {
      const i = b.items.indexOf(entryId);
      if (i >= 0) return { branch: b, index: i };
    }
    return null;
  }

  function childBranches(branchId) {
    return state.branches.filter((b) => b.parent === branchId);
  }

  function descendants(branchId) {
    const out = [];
    const walk = (id) => {
      for (const c of childBranches(id)) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(branchId);
    return out;
  }

  // Take an entry off the timeline. Branches that forked from it slide back to the previous idea.
  function unplace(entryId) {
    const loc = locate(entryId);
    if (!loc) return;
    const { branch, index } = loc;
    for (const c of childBranches(branch.id)) {
      if (c.forkAfter === entryId) c.forkAfter = branch.items[index - 1] || null;
    }
    branch.items.splice(index, 1);
  }

  // Put an entry at a position in a branch. Moving within the same branch keeps forks attached to it.
  function placeEntry(entryId, branchId, index) {
    const target = branchById(branchId);
    if (!target) return;
    const loc = locate(entryId);
    if (loc && loc.branch.id === branchId) {
      target.items.splice(loc.index, 1);
      if (loc.index < index) index--;
    } else if (loc) {
      unplace(entryId);
    }
    target.items.splice(clamp(index, 0, target.items.length), 0, entryId);
  }

  function startColMap() {
    const map = {};
    const calc = (b, depth = 0) => {
      if (b.id in map) return map[b.id];
      if (!b.parent || depth > 50) return (map[b.id] = 0);
      const parent = branchById(b.parent);
      if (!parent) return (map[b.id] = 0);
      const k = b.forkAfter ? parent.items.indexOf(b.forkAfter) : -1;
      return (map[b.id] = calc(parent, depth + 1) + k + 1);
    };
    state.branches.forEach((b) => calc(b));
    return map;
  }

  function laneOrder() {
    const out = [];
    const walk = (b, depth) => {
      out.push({ branch: b, depth });
      for (const c of childBranches(b.id)) walk(c, depth + 1);
    };
    state.branches.filter((b) => !b.parent).forEach((b) => walk(b, 0));
    return out;
  }

  // The full reading path for a branch: its ancestors up to the fork point, then its own ideas.
  function pathFor(branchId, depth = 0) {
    const b = branchById(branchId);
    if (!b) return [];
    if (!b.parent || depth > 50) return b.items.slice();
    const parent = branchById(b.parent);
    const parentPath = pathFor(b.parent, depth + 1);
    let head;
    if (b.forkAfter && parentPath.includes(b.forkAfter)) {
      head = parentPath.slice(0, parentPath.indexOf(b.forkAfter) + 1);
    } else {
      const firstOwn = parent && parent.items[0];
      const k = firstOwn ? parentPath.indexOf(firstOwn) : parentPath.length;
      head = parentPath.slice(0, k < 0 ? parentPath.length : k);
    }
    return head.concat(b.items);
  }

  function branchChainName(branchId) {
    const names = [];
    let b = branchById(branchId);
    let guard = 0;
    while (b && guard++ < 50) {
      names.unshift(b.name);
      b = b.parent ? branchById(b.parent) : null;
    }
    return names.join(' → ');
  }

  function placementText(entryId) {
    const loc = locate(entryId);
    return loc ? `${loc.branch.name} · ${loc.index + 1}` : 'Unplaced';
  }

  // ======================================================================
  //  Mutations, undo/redo & saving
  // ======================================================================

  const undoStack = [];
  const redoStack = [];
  let lastCoalesce = null;
  let lastMutateAt = 0;

  function mutate(fn, coalesceKey) {
    const now = Date.now();
    const coalesce = coalesceKey && coalesceKey === lastCoalesce && now - lastMutateAt < 2000;
    if (!coalesce) {
      undoStack.push(JSON.stringify(state));
      if (undoStack.length > 300) undoStack.shift();
      redoStack.length = 0;
    }
    lastCoalesce = coalesceKey || null;
    lastMutateAt = now;
    fn();
    scheduleSave();
    updateUndoButtons();
  }

  function undo() {
    if (!undoStack.length) return toast('Nothing to undo');
    redoStack.push(JSON.stringify(state));
    state = JSON.parse(undoStack.pop());
    lastCoalesce = null;
    afterHistoryJump();
  }

  function redo() {
    if (!redoStack.length) return toast('Nothing to redo');
    undoStack.push(JSON.stringify(state));
    state = JSON.parse(redoStack.pop());
    lastCoalesce = null;
    afterHistoryJump();
  }

  function afterHistoryJump() {
    if (ui.editing && !state.entries[ui.editing]) closeEditor(false);
    scheduleSave();
    updateUndoButtons();
    render();
    if (ui.editing) renderEditor();
  }

  function updateUndoButtons() {
    document.getElementById('btn-undo').disabled = !undoStack.length;
    document.getElementById('btn-redo').disabled = !redoStack.length;
  }

  function setSaveStatus(text, cls) {
    const el = document.getElementById('save-status');
    el.textContent = text;
    el.className = 'save-status ' + (cls || '');
  }

  let saving = Promise.resolve();
  async function saveNow() {
    setSaveStatus('Saving…', 'busy');
    const snapshot = JSON.parse(JSON.stringify(state));
    saving = saving.then(async () => {
      try {
        const res = await api.save(snapshot);
        if (res && res.ok === false) throw new Error(res.error || 'Save failed');
        setSaveStatus('Saved', '');
        if (res && res.path) document.getElementById('save-status').title = res.path;
      } catch (err) {
        console.error(err);
        setSaveStatus('Not saved!', 'error');
        toast('Could not save: ' + (err && err.message ? err.message : err));
      }
    });
    return saving;
  }

  const scheduleSave = (() => {
    const d = debounce(saveNow, 400);
    const fn = () => {
      setSaveStatus('Editing…', 'busy');
      d();
    };
    fn.flush = () => d.flush();
    return fn;
  })();

  // ======================================================================
  //  Entry operations
  // ======================================================================

  function addEntry({ title = '', text = '', tags = [], place = 'none', board = null }) {
    const id = uid();
    mutate(() => {
      const now = Date.now();
      state.entries[id] = { id, num: state.nextNum++, title, text, tags, color: null, created: now, updated: now, board };
      state.listOrder.push(id);
      const b = place !== 'none' && branchById(place);
      if (b) b.items.push(id);
    });
    return id;
  }

  function deleteEntry(id, ask = true) {
    const e = state.entries[id];
    if (!e) return;
    if (ask && !confirm(`Delete idea #${e.num} "${entryLabel(e)}"?\n\nYou can undo this with Ctrl+Z.`)) return;
    mutate(() => {
      unplace(id);
      delete state.entries[id];
      state.listOrder = state.listOrder.filter((x) => x !== id);
    });
    if (ui.editing === id) closeEditor(false);
    render();
  }

  async function createBranch(fromEntryId, parentBranchId) {
    const n = state.branches.length;
    const name = await askText('Name this branch', `Branch ${n}`, 'e.g. "What if she never left?"');
    if (name == null) return;
    const parent = branchById(parentBranchId);
    if (!parent) return;
    mutate(() => {
      const used = new Set(state.branches.map((b) => b.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[n % COLORS.length];
      state.branches.push({ id: uid(), name: name.trim() || `Branch ${n}`, color, parent: parent.id, forkAfter: fromEntryId || null, items: [] });
    });
    render();
    toast('Branch created — drag ideas onto its lane');
  }

  async function renameBranch(id) {
    const b = branchById(id);
    if (!b) return;
    const name = await askText('Rename branch', b.name);
    if (name == null || !name.trim()) return;
    mutate(() => (b.name = name.trim()));
    render();
  }

  function recolorBranch(id) {
    const b = branchById(id);
    if (!b) return;
    mutate(() => (b.color = COLORS[(COLORS.indexOf(b.color) + 1) % COLORS.length]));
    render();
  }

  function deleteBranch(id) {
    const b = branchById(id);
    if (!b || id === 'main') return;
    const subs = descendants(id);
    const count = b.items.length + subs.reduce((s, x) => s + x.items.length, 0);
    const msg =
      `Delete branch "${b.name}"` +
      (subs.length ? ` and its ${subs.length} sub-branch${subs.length > 1 ? 'es' : ''}` : '') +
      `?\n\n${count} idea${count === 1 ? '' : 's'} will go back to the Unplaced pool (nothing is deleted). You can undo this with Ctrl+Z.`;
    if (!confirm(msg)) return;
    const remove = new Set([id, ...subs.map((s) => s.id)]);
    mutate(() => (state.branches = state.branches.filter((x) => !remove.has(x.id))));
    if (ui.readPath && remove.has(ui.readPath)) ui.readPath = 'main';
    render();
  }

  // ======================================================================
  //  Drag & drop (pointer based, works across all views)
  // ======================================================================

  let drag = null;
  let dropTargets = [];
  let autoScrollRaf = null;

  function makeDraggable(el, entryId, { onClick } = {}) {
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest('button, input, select, textarea, a, [contenteditable="true"], [contenteditable="plaintext-only"], .no-drag')) return;
      const rect = el.getBoundingClientRect();
      drag = {
        entryId,
        el,
        startX: ev.clientX,
        startY: ev.clientY,
        x: ev.clientX,
        y: ev.clientY,
        grabX: ev.clientX - rect.left,
        grabY: ev.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
        ghost: null,
        target: null,
        onClick,
      };
      ev.preventDefault();
    });
  }

  function findTarget(x, y) {
    const under = document.elementFromPoint(x, y);
    if (!under) return null;
    for (let i = dropTargets.length - 1; i >= 0; i--) {
      if (dropTargets[i].el.contains(under)) return dropTargets[i];
    }
    return null;
  }

  function updateDragTarget() {
    if (!drag || !drag.moved) return;
    const t = findTarget(drag.x, drag.y);
    if (t !== drag.target) {
      if (drag.target && drag.target.leave) drag.target.leave();
      drag.target = t;
    }
    if (t && t.over) t.over(drag.x, drag.y, drag);
  }

  function autoScrollTick() {
    autoScrollRaf = null;
    if (!drag || !drag.moved) return;
    const edge = 50;
    let scrolled = false;
    for (const sc of document.querySelectorAll('[data-autoscroll]')) {
      const r = sc.getBoundingClientRect();
      if (drag.x < r.left || drag.x > r.right || drag.y < r.top || drag.y > r.bottom) continue;
      let dx = 0;
      let dy = 0;
      if (drag.x < r.left + edge) dx = -Math.ceil((r.left + edge - drag.x) / 4);
      else if (drag.x > r.right - edge) dx = Math.ceil((drag.x - (r.right - edge)) / 4);
      if (drag.y < r.top + edge) dy = -Math.ceil((r.top + edge - drag.y) / 4);
      else if (drag.y > r.bottom - edge) dy = Math.ceil((drag.y - (r.bottom - edge)) / 4);
      if (dx || dy) {
        sc.scrollLeft += dx;
        sc.scrollTop += dy;
        scrolled = true;
      }
    }
    if (scrolled) updateDragTarget();
    autoScrollRaf = requestAnimationFrame(autoScrollTick);
  }

  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    if (!drag.moved) {
      if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 5) return;
      drag.moved = true;
      const ghost = drag.el.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.style.width = drag.width + 'px';
      ghost.style.height = drag.height + 'px';
      ghost.style.left = '0px';
      ghost.style.top = '0px';
      document.body.appendChild(ghost);
      drag.ghost = ghost;
      drag.el.classList.add('drag-source');
      document.body.classList.add('is-dragging');
      autoScrollRaf = requestAnimationFrame(autoScrollTick);
    }
    drag.ghost.style.transform = `translate(${ev.clientX - drag.grabX}px, ${ev.clientY - drag.grabY}px) rotate(1.5deg)`;
    updateDragTarget();
  });

  function endDrag(ev, cancelled) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
    if (!d.moved) {
      if (!cancelled && d.onClick) d.onClick(ev);
      return;
    }
    d.ghost.remove();
    d.el.classList.remove('drag-source');
    document.body.classList.remove('is-dragging');
    const t = d.target;
    if (t && t.leave) t.leave();
    if (t && !cancelled) t.drop(d.x, d.y, d);
  }

  window.addEventListener('pointerup', (ev) => endDrag(ev, false));
  window.addEventListener('pointercancel', (ev) => endDrag(ev, true));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && drag && drag.moved) endDrag(ev, true);
  });

  // ======================================================================
  //  Rendering
  // ======================================================================

  function render() {
    // Remember scroll positions so re-rendering doesn't jump around.
    for (const el of document.querySelectorAll('[data-scroll-key]')) {
      ui.scroll[el.dataset.scrollKey] = { left: el.scrollLeft, top: el.scrollTop };
    }
    dropTargets = [];
    const view = document.getElementById('view');
    view.innerHTML = '';
    view.className = 'view view-' + ui.view;

    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === ui.view);
    const titleInput = document.getElementById('project-title');
    if (document.activeElement !== titleInput) titleInput.value = state.title;

    if (ui.view === 'list') renderList(view);
    else if (ui.view === 'timeline') renderTimeline(view);
    else if (ui.view === 'board') renderBoard(view);
    else renderRead(view);

    for (const el of view.querySelectorAll('[data-scroll-key]')) {
      const s = ui.scroll[el.dataset.scrollKey];
      if (s) {
        el.scrollLeft = s.left;
        el.scrollTop = s.top;
      }
    }
  }

  function setView(v) {
    if (ui.view === v) return;
    ui.view = v;
    saveUiPrefs();
    render();
  }

  function tagChips(tags) {
    return (tags || []).length ? h('div', { class: 'tags' }, tags.map((t) => h('span', { class: 'tag', text: t }))) : null;
  }

  function placeSelect(selected, { includeNone = true, noneLabel = 'Keep unplaced', onChange, cls = '' } = {}) {
    const sel = h(
      'select',
      { class: 'select ' + cls, title: 'Where should this idea go?' },
      includeNone ? h('option', { value: 'none', selected: selected === 'none' }, noneLabel) : null,
      laneOrder().map(({ branch, depth }) =>
        h('option', { value: branch.id, selected: selected === branch.id }, '  '.repeat(depth) + (depth ? '↳ ' : '') + branch.name)
      )
    );
    if (onChange) sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  // ---------------------------------------------------------------- List

  function renderList(view) {
    const titleIn = h('input', {
      class: 'input composer-title',
      placeholder: 'Title (optional)',
      value: ui.draft.title,
      oninput: (e) => (ui.draft.title = e.target.value),
    });
    const textIn = h('textarea', {
      class: 'input composer-text',
      placeholder: 'Type an idea, a scene, a line of dialogue… then press Ctrl+Enter to index it.',
      value: ui.draft.text,
      oninput: (e) => (ui.draft.text = e.target.value),
    });
    const tagsIn = h('input', {
      class: 'input composer-tags',
      placeholder: 'Tags, comma separated (optional)',
      value: ui.draft.tags,
      oninput: (e) => (ui.draft.tags = e.target.value),
    });
    if (ui.composerPlace !== 'none' && !branchById(ui.composerPlace)) ui.composerPlace = 'none';
    const place = placeSelect(ui.composerPlace, {
      noneLabel: 'Add to Unplaced pool',
      onChange: (v) => {
        ui.composerPlace = v;
        saveUiPrefs();
      },
    });
    for (const o of place.options) if (o.value !== 'none') o.textContent = 'Add to end of: ' + o.textContent.trim();

    const submit = () => {
      if (!ui.draft.text.trim() && !ui.draft.title.trim()) {
        textIn.focus();
        return;
      }
      addEntry({ title: ui.draft.title.trim(), text: ui.draft.text.trim(), tags: parseTags(ui.draft.tags), place: ui.composerPlace });
      ui.draft = { title: '', text: '', tags: ui.draft.tags };
      render();
      const t = document.querySelector('.composer-text');
      if (t) t.focus();
      toast('Idea indexed');
    };
    const onKey = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    };
    textIn.addEventListener('keydown', onKey);
    titleIn.addEventListener('keydown', onKey);
    tagsIn.addEventListener('keydown', onKey);

    const composer = h(
      'section',
      { class: 'composer' },
      titleIn,
      textIn,
      h('div', { class: 'composer-row' }, tagsIn, place, h('button', { class: 'btn primary', onclick: submit }, 'Index it  ⏎'))
    );

    // Filters
    const search = h('input', {
      id: 'list-search',
      class: 'input search',
      type: 'search',
      placeholder: 'Search ideas, tags…',
      value: ui.search,
      oninput: (e) => {
        ui.search = e.target.value;
        renderListItems();
      },
    });
    const filter = h(
      'select',
      {
        class: 'select',
        onchange: (e) => {
          ui.filter = e.target.value;
          renderListItems();
        },
      },
      h('option', { value: 'all', selected: ui.filter === 'all' }, 'All ideas'),
      h('option', { value: 'unplaced', selected: ui.filter === 'unplaced' }, 'Unplaced only'),
      h('option', { value: 'placed', selected: ui.filter === 'placed' }, 'On a timeline'),
      state.branches.map((b) => h('option', { value: 'b:' + b.id, selected: ui.filter === 'b:' + b.id }, 'In: ' + b.name))
    );
    const count = h('span', { class: 'muted count' });
    const sortBtn = h(
      'button',
      {
        class: 'btn small ghost',
        title: 'Rearrange this list to follow the main timeline, then branches, then unplaced ideas',
        onclick: () => {
          mutate(() => {
            const order = [];
            for (const { branch } of laneOrder()) order.push(...branch.items);
            for (const id of state.listOrder) if (!order.includes(id)) order.push(id);
            state.listOrder = order;
          });
          render();
          toast('List ordered to match the timeline');
        },
      },
      'Order like timeline'
    );

    const list = h('ol', { class: 'entry-list' });
    const listWrap = h('div', { class: 'list-scroll', 'data-scroll-key': 'list', 'data-autoscroll': '' }, list);

    function renderListItems() {
      list.innerHTML = '';
      const q = ui.search.trim().toLowerCase();
      let ids = state.listOrder.filter((id) => state.entries[id]);
      if (ui.filter === 'unplaced') ids = ids.filter((id) => !locate(id));
      else if (ui.filter === 'placed') ids = ids.filter((id) => locate(id));
      else if (ui.filter.startsWith('b:')) {
        const b = branchById(ui.filter.slice(2));
        ids = b ? ids.filter((id) => b.items.includes(id)) : [];
      }
      if (q) {
        ids = ids.filter((id) => {
          const e = state.entries[id];
          return (e.title + '\n' + e.text + '\n' + e.tags.join(' ') + '\n#' + e.num).toLowerCase().includes(q);
        });
      }
      const total = state.listOrder.length;
      count.textContent = ids.length === total ? `${total} idea${total === 1 ? '' : 's'}` : `${ids.length} of ${total}`;

      if (!ids.length) {
        list.appendChild(
          h('li', { class: 'empty' }, total ? 'No ideas match.' : 'Nothing here yet. Type your first idea above and press Ctrl+Enter.')
        );
        return;
      }

      for (const id of ids) {
        const e = state.entries[id];
        const loc = locate(id);
        const row = h(
          'li',
          { class: 'entry-row', dataset: { id }, style: { '--accent': e.color || (loc ? loc.branch.color : 'var(--line)') } },
          h('span', { class: 'handle', title: 'Drag to reorder' }, '⋮⋮'),
          h('span', { class: 'num', text: '#' + e.num }),
          h(
            'div',
            { class: 'row-main' },
            h('div', { class: 'row-title', text: entryLabel(e) }),
            bodyPreview(e) ? h('div', { class: 'row-preview', text: bodyPreview(e) }) : null,
            tagChips(e.tags)
          ),
          h('span', { class: 'badge' + (loc ? '' : ' unplaced'), style: loc ? { '--badge': loc.branch.color } : null, text: placementText(id) }),
          h(
            'div',
            { class: 'row-actions' },
            placeSelect(loc ? loc.branch.id : 'none', {
              noneLabel: 'Unplaced',
              cls: 'small',
              onChange: (v) => {
                mutate(() => {
                  if (v === 'none') unplace(id);
                  else if (!loc || loc.branch.id !== v) placeEntry(id, v, branchById(v).items.length);
                });
                render();
              },
            }),
            h('button', { class: 'btn icon small danger', title: 'Delete idea', onclick: () => deleteEntry(id) }, '✕')
          )
        );
        makeDraggable(row, id, { onClick: () => openEditor(id) });
        list.appendChild(row);
      }
    }

    view.append(
      composer,
      h(
        'section',
        { class: 'list-tools' },
        search,
        filter,
        sortBtn,
        count
      ),
      listWrap
    );
    renderListItems();

    // Drop target: reorder the list
    let marked = null;
    const clearMark = () => {
      if (marked) marked.classList.remove('drop-before', 'drop-after');
      marked = null;
    };
    const rowAt = (y) => {
      const rows = [...list.querySelectorAll('.entry-row:not(.drag-source)')];
      for (const r of rows) {
        const rr = r.getBoundingClientRect();
        if (y < rr.top + rr.height / 2) return { row: r, before: true };
      }
      return rows.length ? { row: rows[rows.length - 1], before: false } : null;
    };
    dropTargets.push({
      el: listWrap,
      over(x, y) {
        clearMark();
        const hit = rowAt(y);
        if (!hit) return;
        marked = hit.row;
        marked.classList.add(hit.before ? 'drop-before' : 'drop-after');
      },
      leave: clearMark,
      drop(x, y, d) {
        const hit = rowAt(y);
        if (!hit) return;
        const targetId = hit.row.dataset.id;
        mutate(() => {
          const order = state.listOrder.filter((id) => id !== d.entryId);
          let idx = order.indexOf(targetId);
          if (!hit.before) idx++;
          order.splice(idx, 0, d.entryId);
          state.listOrder = order;
        });
        render();
      },
    });

    if (!state.listOrder.length) setTimeout(() => textIn.focus(), 0);
  }

  // ---------------------------------------------------------------- Timeline

  function timelineCard(e, color, extraButtons) {
    const card = h(
      'div',
      { class: 'card', dataset: { id: e.id }, style: { '--accent': e.color || color } },
      h('div', { class: 'card-head' }, h('span', { class: 'num', text: '#' + e.num }), h('span', { class: 'card-title', text: entryLabel(e) })),
      h('div', { class: 'card-body', text: bodyPreview(e, 260) }),
      tagChips(e.tags),
      extraButtons ? h('div', { class: 'card-tools' }, extraButtons) : null
    );
    makeDraggable(card, e.id, { onClick: () => openEditor(e.id) });
    return card;
  }

  function renderTimeline(view) {
    // ----- Unplaced pool -----
    const poolList = h('div', { class: 'pool-list' });
    const unplaced = state.listOrder.filter((id) => state.entries[id] && !locate(id));
    for (const id of unplaced) poolList.appendChild(timelineCard(state.entries[id], 'var(--muted-line)'));
    if (!unplaced.length) poolList.appendChild(h('div', { class: 'empty small' }, 'All ideas are on the timeline. Drag a card here to take it off.'));

    const quick = h('textarea', { class: 'input quick', placeholder: 'Quick idea… (Ctrl+Enter)' });
    quick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!quick.value.trim()) return;
        addEntry({ text: quick.value.trim() });
        render();
        const q = document.querySelector('.pool .quick');
        if (q) q.focus();
      }
    });

    const pool = h(
      'aside',
      { class: 'pool' },
      h('div', { class: 'pool-head' }, h('strong', null, 'Unplaced ideas'), h('span', { class: 'muted', text: String(unplaced.length) })),
      quick,
      h('div', { class: 'pool-scroll', 'data-scroll-key': 'pool', 'data-autoscroll': '' }, poolList)
    );

    // ----- Lanes -----
    const lanes = laneOrder();
    const starts = startColMap();
    let maxCol = 4;
    for (const { branch } of lanes) maxCol = Math.max(maxCol, starts[branch.id] + Math.max(branch.items.length, 1) + 1);
    const width = LEFT_PAD + LABEL_W + maxCol * COL_W + 120;
    const height = TOP_PAD + lanes.length * LANE_H + 40;
    const x0 = LEFT_PAD + LABEL_W;

    const content = h('div', { class: 'tl-content', style: { width: width + 'px', height: height + 'px' } });
    const layer = svg('svg', { class: 'tl-svg', width, height });
    content.appendChild(layer);

    // Column ruler
    for (let c = 0; c < maxCol; c++) {
      content.appendChild(h('div', { class: 'tl-col', style: { left: x0 + c * COL_W + 'px', width: CARD_W + 'px' }, text: String(c + 1) }));
    }

    const laneIndex = {};
    lanes.forEach(({ branch, depth }, li) => {
      laneIndex[branch.id] = li;
      const top = TOP_PAD + li * LANE_H;
      const sc = starts[branch.id];
      const cardTop = top + (LANE_H - CARD_H) / 2;
      const mid = cardTop + CARD_H / 2;

      // Lane row with sticky label
      const label = h(
        'div',
        { class: 'lane-label', style: { '--lane': branch.color, height: LANE_H + 'px' } },
        h(
          'div',
          { class: 'lane-name-row' },
          h('button', { class: 'dot', title: 'Change color', style: { background: branch.color }, onclick: () => recolorBranch(branch.id) }),
          h('span', { class: 'lane-name', title: branchChainName(branch.id), text: branch.name, ondblclick: () => renameBranch(branch.id) })
        ),
        h('div', { class: 'muted lane-meta', text: `${branch.items.length} idea${branch.items.length === 1 ? '' : 's'}` + (depth ? ` · branch` : '') }),
        h(
          'div',
          { class: 'lane-actions' },
          h('button', { class: 'btn small ghost', title: 'Rename', onclick: () => renameBranch(branch.id) }, '✎'),
          h(
            'button',
            {
              class: 'btn small ghost',
              title: 'Read this path as one story',
              onclick: () => {
                ui.readPath = branch.id;
                setView('read');
              },
            },
            '❡ Read'
          ),
          branch.id !== 'main' ? h('button', { class: 'btn small ghost danger', title: 'Delete branch', onclick: () => deleteBranch(branch.id) }, '🗑') : null
        )
      );
      content.appendChild(h('div', { class: 'lane-row' + (li % 2 ? ' alt' : ''), style: { top: top + 'px', height: LANE_H + 'px' } }, label));

      // Lane axis line
      const lx1 = x0 + sc * COL_W - 12;
      const lx2 = x0 + (sc + Math.max(branch.items.length, 1)) * COL_W - GAP + 12;
      layer.appendChild(
        svg('line', {
          x1: lx1,
          y1: mid,
          x2: lx2,
          y2: mid,
          stroke: branch.color,
          'stroke-width': branch.parent ? 3 : 4,
          'stroke-dasharray': branch.parent ? '8 6' : '',
          'stroke-linecap': 'round',
          opacity: 0.55,
        })
      );

      if (!branch.items.length) {
        content.appendChild(
          h(
            'div',
            { class: 'slot-empty', style: { left: x0 + sc * COL_W + 'px', top: cardTop + 'px', width: CARD_W + 'px', height: CARD_H + 'px', '--lane': branch.color } },
            'Drag ideas here'
          )
        );
      }

      branch.items.forEach((id, i) => {
        const e = state.entries[id];
        if (!e) return;
        const card = timelineCard(e, branch.color, [
          h('button', { class: 'btn tiny', title: 'Start a new branch after this idea', onclick: () => createBranch(id, branch.id) }, '⑂ Branch'),
          h(
            'button',
            {
              class: 'btn tiny',
              title: 'Take off the timeline (back to Unplaced)',
              onclick: () => {
                mutate(() => unplace(id));
                render();
              },
            },
            '✕'
          ),
        ]);
        card.classList.add('tl-card');
        card.style.left = x0 + (sc + i) * COL_W + 'px';
        card.style.top = cardTop + 'px';
        card.style.width = CARD_W + 'px';
        card.style.height = CARD_H + 'px';
        const forks = childBranches(branch.id).filter((c) => c.forkAfter === id).length;
        if (forks) card.appendChild(h('span', { class: 'fork-badge', title: `${forks} branch${forks > 1 ? 'es' : ''} start here` }, '⑂ ' + forks));
        content.appendChild(card);
      });
    });

    // Fork connectors
    for (const { branch } of lanes) {
      if (!branch.parent || !(branch.parent in laneIndex)) continue;
      const parent = branchById(branch.parent);
      const pli = laneIndex[parent.id];
      const cli = laneIndex[branch.id];
      const k = branch.forkAfter ? parent.items.indexOf(branch.forkAfter) : -1;
      const pMidY = TOP_PAD + pli * LANE_H + LANE_H / 2;
      const cMidY = TOP_PAD + cli * LANE_H + LANE_H / 2;
      const ex = x0 + starts[branch.id] * COL_W;
      const ey = cMidY;
      // Fork after an idea: drop down from that card. Fork from the very start: drop down just left of the lane.
      const sx = k >= 0 ? x0 + (starts[parent.id] + k) * COL_W + CARD_W / 2 : ex - 24;
      const sy = k >= 0 ? pMidY + CARD_H / 2 : pMidY;
      const d = `M ${sx} ${sy} L ${sx} ${ey - 24} Q ${sx} ${ey} ${sx + 24} ${ey} L ${ex} ${ey}`;
      layer.appendChild(svg('path', { d, fill: 'none', stroke: branch.color, 'stroke-width': 3, 'stroke-dasharray': '8 6', opacity: 0.8 }));
      layer.appendChild(svg('circle', { cx: sx, cy: sy, r: 5, fill: branch.color }));
    }

    const marker = h('div', { class: 'drop-marker hidden' });
    content.appendChild(marker);

    const scroller = h('div', { class: 'tl-scroll', 'data-scroll-key': 'timeline', 'data-autoscroll': '' }, content);

    const toolbar = h(
      'div',
      { class: 'tl-toolbar' },
      h('span', { class: 'muted' }, 'Drag cards to arrange them. Hover a card and click ', h('b', null, '⑂ Branch'), ' to fork the story from that point.'),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'btn small',
          onclick: () => {
            const main = branchById('main');
            createBranch(main.items[main.items.length - 1] || null, 'main');
          },
        },
        '⑂ New branch from end of main'
      )
    );

    view.append(pool, h('section', { class: 'tl-main' }, toolbar, scroller));

    // Drop target: lanes
    const hitLane = (x, y) => {
      const r = content.getBoundingClientRect();
      const cx = x - r.left;
      const cy = y - r.top;
      const li = Math.floor((cy - TOP_PAD) / LANE_H);
      if (li < 0 || li >= lanes.length) return null;
      const branch = lanes[li].branch;
      const sc = starts[branch.id];
      const rel = (cx - x0) / COL_W - sc;
      const index = clamp(Math.floor(rel + 0.5), 0, branch.items.length);
      return { branch, index, li, sc };
    };
    dropTargets.push({
      el: scroller,
      over(x, y) {
        const hit = hitLane(x, y);
        if (!hit) return marker.classList.add('hidden');
        marker.classList.remove('hidden');
        marker.style.left = x0 + (hit.sc + hit.index) * COL_W - GAP / 2 - 2 + 'px';
        marker.style.top = TOP_PAD + hit.li * LANE_H + (LANE_H - CARD_H) / 2 - 8 + 'px';
        marker.style.height = CARD_H + 16 + 'px';
        marker.style.background = hit.branch.color;
      },
      leave: () => marker.classList.add('hidden'),
      drop(x, y, d) {
        const hit = hitLane(x, y);
        if (!hit) return;
        mutate(() => placeEntry(d.entryId, hit.branch.id, hit.index));
        render();
      },
    });

    // Drop target: pool (take off the timeline)
    dropTargets.push({
      el: pool,
      over: () => pool.classList.add('drop-hover'),
      leave: () => pool.classList.remove('drop-hover'),
      drop(x, y, d) {
        if (!locate(d.entryId)) return;
        mutate(() => unplace(d.entryId));
        render();
      },
    });
  }

  // ---------------------------------------------------------------- Board

  function renderBoard(view) {
    const ids = state.listOrder.filter((id) => state.entries[id]);
    // Give new notes a tidy starting spot.
    const gridSpot = (i) => ({ x: 40 + (i % 6) * 260, y: 40 + Math.floor(i / 6) * 190 });
    const taken = new Set(ids.map((id) => state.entries[id].board).filter(Boolean).map((b) => b.x + ',' + b.y));
    let auto = 0;
    let assigned = false;
    for (const id of ids) {
      const e = state.entries[id];
      if (e.board) continue;
      while (taken.has(gridSpot(auto).x + ',' + gridSpot(auto).y)) auto++;
      e.board = gridSpot(auto++);
      assigned = true;
    }
    if (assigned) scheduleSave();

    let maxX = 1600;
    let maxY = 1000;
    for (const id of ids) {
      maxX = Math.max(maxX, state.entries[id].board.x + 600);
      maxY = Math.max(maxY, state.entries[id].board.y + 500);
    }

    const content = h('div', { class: 'board-content', style: { width: maxX + 'px', height: maxY + 'px' } });
    // Most recently moved notes sit on top.
    const stacked = ids.slice().sort((a, b) => (state.entries[a].board.z || 0) - (state.entries[b].board.z || 0));
    for (const id of stacked) {
      const e = state.entries[id];
      const loc = locate(id);
      const note = h(
        'div',
        {
          class: 'note',
          dataset: { id },
          style: { left: e.board.x + 'px', top: e.board.y + 'px', '--accent': e.color || (loc ? loc.branch.color : '#c9c2ae') },
        },
        h('div', { class: 'card-head' }, h('span', { class: 'num', text: '#' + e.num }), h('span', { class: 'card-title', text: entryLabel(e) })),
        h('div', { class: 'card-body', text: bodyPreview(e, 200) }),
        tagChips(e.tags),
        h('div', { class: 'note-foot' }, h('span', { class: 'badge' + (loc ? '' : ' unplaced'), style: loc ? { '--badge': loc.branch.color } : null, text: placementText(id) }))
      );
      makeDraggable(note, id, { onClick: () => openEditor(id) });
      content.appendChild(note);
    }

    content.addEventListener('dblclick', (ev) => {
      if (ev.target !== content) return;
      const r = content.getBoundingClientRect();
      const id = addEntry({ text: '', board: { x: Math.max(0, ev.clientX - r.left - 110), y: Math.max(0, ev.clientY - r.top - 40) } });
      render();
      openEditor(id, { isNew: true });
    });

    const scroller = h('div', { class: 'board-scroll', 'data-scroll-key': 'board', 'data-autoscroll': '' }, content);
    view.append(
      h(
        'div',
        { class: 'tl-toolbar' },
        h('span', { class: 'muted' }, 'A free-form corkboard: drag notes anywhere to cluster and organize them. Double-click empty space to add an idea.'),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn small',
            title: 'Lay the notes out in a neat grid following the list order',
            onclick: () => {
              mutate(() => ids.forEach((id, i) => (state.entries[id].board = gridSpot(i))));
              render();
            },
          },
          'Tidy into grid'
        )
      ),
      scroller
    );

    dropTargets.push({
      el: scroller,
      drop(x, y, d) {
        const r = content.getBoundingClientRect();
        const nx = Math.max(0, Math.round(x - r.left - d.grabX));
        const ny = Math.max(0, Math.round(y - r.top - d.grabY));
        const topZ = Math.max(0, ...ids.map((id) => state.entries[id].board.z || 0));
        mutate(() => (state.entries[d.entryId].board = { x: nx, y: ny, z: topZ + 1 }));
        render();
      },
    });
  }

  // ---------------------------------------------------------------- Read

  function readSourceIds() {
    if (ui.readPath === '__list') return state.listOrder.filter((id) => state.entries[id]);
    if (ui.readPath === '__unplaced') return state.listOrder.filter((id) => state.entries[id] && !locate(id));
    if (!branchById(ui.readPath)) ui.readPath = 'main';
    return pathFor(ui.readPath).filter((id) => state.entries[id]);
  }

  function buildStory() {
    const ids = readSourceIds();
    const entries = ids.map((id) => state.entries[id]).filter((e) => e.text.trim() || (ui.readTitles && e.title.trim()));
    return entries;
  }

  function storyAsText(kind) {
    const entries = buildStory();
    const showTitles = ui.readTitles && ui.readSep !== 'flow';
    const parts = [];
    for (const e of entries) {
      let block = '';
      if (showTitles && e.title.trim()) block += (kind === 'md' ? '## ' : '') + e.title.trim() + '\n\n';
      block += e.text.trim();
      parts.push(block.trim());
    }
    const sep = ui.readSep === 'flow' ? ' ' : ui.readSep === 'scene' ? (kind === 'md' ? '\n\n---\n\n' : '\n\n* * *\n\n') : '\n\n';
    const head = kind === 'md' ? `# ${state.title}\n\n` : `${state.title}\n\n`;
    return head + parts.join(sep) + '\n';
  }

  function storyAsRtf() {
    const esc = (s) =>
      s
        .replace(/[\\{}]/g, (m) => '\\' + m)
        .replace(/[^\x00-\x7f]/g, (c) => {
          const code = c.charCodeAt(0);
          return '\\u' + (code > 32767 ? code - 65536 : code) + '?';
        })
        .replace(/\r?\n/g, '\\line ');
    const entries = buildStory();
    const showTitles = ui.readTitles && ui.readSep !== 'flow';
    let out = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\froman Georgia;}}\\viewkind4\\uc1\\f0\\fs24 ';
    out += '\\pard\\qc\\sa360\\b\\fs36 ' + esc(state.title) + '\\b0\\fs24\\par ';
    if (ui.readSep === 'flow') {
      out += '\\pard\\sa200\\sl360\\slmult1 ' + esc(entries.map((e) => e.text.trim()).join(' ')) + '\\par ';
    } else {
      entries.forEach((e, i) => {
        if (i > 0 && ui.readSep === 'scene') out += '\\pard\\qc\\sa200 * * *\\par ';
        if (showTitles && e.title.trim()) out += '\\pard\\sa120\\b\\fs28 ' + esc(e.title.trim()) + '\\b0\\fs24\\par ';
        for (const para of e.text.trim().split(/\n\s*\n/)) out += '\\pard\\sa200\\sl360\\slmult1 ' + esc(para) + '\\par ';
      });
    }
    return out + '}';
  }

  async function exportStory(kind) {
    const safe = (state.title || 'Narrative').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Narrative';
    const pathName = ui.readPath.startsWith('__') ? '' : ui.readPath === 'main' ? '' : ' - ' + (branchById(ui.readPath) || {}).name;
    const base = (safe + (pathName || '')).replace(/[\\/:*?"<>|]+/g, '');
    let res;
    if (kind === 'rtf') res = await api.exportFile(storyAsRtf(), base + '.rtf', [{ name: 'Rich Text (WordPad)', extensions: ['rtf'] }]);
    else if (kind === 'md') res = await api.exportFile(storyAsText('md'), base + '.md', [{ name: 'Markdown', extensions: ['md'] }]);
    else res = await api.exportFile(storyAsText('txt'), base + '.txt', [{ name: 'Text', extensions: ['txt'] }]);
    if (res) toast('Exported' + (res.path ? ' to ' + res.path : ''));
  }

  function renderRead(view) {
    const pathSel = h(
      'select',
      {
        class: 'select',
        onchange: (e) => {
          ui.readPath = e.target.value;
          render();
        },
      },
      h('optgroup', { label: 'Timeline paths' }, laneOrder().map(({ branch }) => h('option', { value: branch.id, selected: ui.readPath === branch.id }, branchChainName(branch.id)))),
      h(
        'optgroup',
        { label: 'Other' },
        h('option', { value: '__list', selected: ui.readPath === '__list' }, 'Every idea, in list order'),
        h('option', { value: '__unplaced', selected: ui.readPath === '__unplaced' }, 'Unplaced ideas only')
      )
    );
    if (!pathSel.value) {
      ui.readPath = 'main';
      pathSel.value = 'main';
    }

    const sepSel = h(
      'select',
      {
        class: 'select',
        title: 'How ideas are joined together',
        onchange: (e) => {
          ui.readSep = e.target.value;
          saveUiPrefs();
          render();
        },
      },
      h('option', { value: 'paragraph', selected: ui.readSep === 'paragraph' }, 'New paragraph between ideas'),
      h('option', { value: 'scene', selected: ui.readSep === 'scene' }, 'Scene break (* * *) between ideas'),
      h('option', { value: 'flow', selected: ui.readSep === 'flow' }, 'Run together as one paragraph')
    );

    const titlesChk = h('label', { class: 'check' }, h('input', {
      type: 'checkbox',
      checked: ui.readTitles,
      onchange: (e) => {
        ui.readTitles = e.target.checked;
        saveUiPrefs();
        render();
      },
    }), ' Show titles');

    const size = h('input', {
      type: 'range',
      min: 14,
      max: 28,
      value: ui.readSize,
      title: 'Text size',
      oninput: (e) => {
        ui.readSize = Number(e.target.value);
        page.style.fontSize = ui.readSize + 'px';
        saveUiPrefs();
      },
    });

    const words = h('span', { class: 'muted' });
    const entries = buildStory();
    const updateWords = () => {
      const n = buildStory().reduce((s, e) => s + wordCount(e.text), 0);
      words.textContent = `${n.toLocaleString()} words`;
    };
    updateWords();

    const toolbar = h(
      'div',
      { class: 'read-toolbar' },
      h('label', { class: 'muted' }, 'Read: '),
      pathSel,
      sepSel,
      titlesChk,
      h('label', { class: 'muted size-label' }, 'A', size, h('span', { style: { fontSize: '1.2em' } }, 'A')),
      h('span', { class: 'spacer' }),
      words,
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(storyAsText('txt'));
              toast('Story copied to clipboard');
            } catch {
              toast('Could not access the clipboard');
            }
          },
        },
        'Copy'
      ),
      h('button', { class: 'btn small', onclick: () => exportStory('rtf') }, 'Export for WordPad'),
      h('button', { class: 'btn small', onclick: () => exportStory('txt') }, '.txt'),
      h('button', { class: 'btn small', onclick: () => window.print() }, 'Print / PDF')
    );

    const page = h('article', { class: 'page', style: { fontSize: ui.readSize + 'px' } });
    page.appendChild(h('h1', { class: 'page-title', text: state.title }));

    const bindText = (el, e, field) => {
      el.setAttribute('contenteditable', 'plaintext-only');
      el.setAttribute('spellcheck', 'true');
      el.dataset.id = e.id;
      el.addEventListener('input', () => {
        const value = field === 'title' ? el.innerText.replace(/\n/g, ' ') : el.innerText.replace(/ /g, ' ');
        mutate(() => {
          e[field] = value;
          e.updated = Date.now();
        }, field + ':' + e.id);
        updateWords();
      });
      el.addEventListener('keydown', (ev) => {
        if (field === 'title' && ev.key === 'Enter') ev.preventDefault();
      });
      el.title = `#${e.num} — ${placementText(e.id)} (click to edit right here; double-click the number badge to open the editor)`;
    };

    if (!entries.length) {
      page.appendChild(
        h('p', { class: 'empty' }, ui.readPath.startsWith('__') ? 'No ideas to show yet.' : 'This path has no ideas yet. Place some on the timeline, or choose “Every idea, in list order” above.')
      );
    } else if (ui.readSep === 'flow') {
      const para = h('p', { class: 'flow' });
      entries.forEach((e, i) => {
        // Re-fetch the live entry object so edits land on the current state.
        const live = state.entries[e.id];
        const span = h('span', { class: 'chunk', text: live.text.trim() });
        bindText(span, live, 'text');
        if (i) para.appendChild(document.createTextNode(' '));
        para.appendChild(span);
      });
      page.appendChild(para);
    } else {
      entries.forEach((e, i) => {
        const live = state.entries[e.id];
        if (i && ui.readSep === 'scene') page.appendChild(h('div', { class: 'scene-break' }, '* * *'));
        const block = h('section', { class: 'chunk-block' });
        block.appendChild(
          h('button', {
            class: 'chunk-ref no-print',
            title: 'Open in editor',
            onclick: () => openEditor(live.id),
          }, '#' + live.num)
        );
        if (ui.readTitles && live.title.trim()) {
          const t = h('h2', { class: 'chunk-title', text: live.title.trim() });
          bindText(t, live, 'title');
          block.appendChild(t);
        }
        const body = h('div', { class: 'chunk', text: live.text.trim() });
        bindText(body, live, 'text');
        block.appendChild(body);
        page.appendChild(block);
      });
    }

    view.append(toolbar, h('div', { class: 'read-scroll', 'data-scroll-key': 'read' }, page));
  }

  // ======================================================================
  //  Editor modal & dialogs
  // ======================================================================

  let editorIsNew = false;

  function openEditor(id, { isNew = false } = {}) {
    if (!state.entries[id]) return;
    ui.editing = id;
    editorIsNew = isNew;
    renderEditor();
    setTimeout(() => {
      const t = document.querySelector('.editor .ed-text');
      if (t) {
        t.focus();
        if (!isNew) t.setSelectionRange(t.value.length, t.value.length);
      }
    }, 0);
  }

  function closeEditor(rerender = true) {
    const id = ui.editing;
    ui.editing = null;
    document.getElementById('modal-root').innerHTML = '';
    const e = id && state.entries[id];
    if (e && editorIsNew && !e.text.trim() && !e.title.trim()) {
      // An empty brand-new idea — quietly discard it.
      mutate(() => {
        unplace(id);
        delete state.entries[id];
        state.listOrder = state.listOrder.filter((x) => x !== id);
      });
    }
    editorIsNew = false;
    if (rerender) render();
  }

  function renderEditor() {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const id = ui.editing;
    const e = state.entries[id];
    if (!e) return;
    const loc = locate(id);

    const set = (field, value) =>
      mutate(() => {
        state.entries[id][field] = value;
        state.entries[id].updated = Date.now();
      }, field + ':' + id);

    const words = h('span', { class: 'muted', text: `${wordCount(e.text)} words` });
    const text = h('textarea', {
      class: 'input ed-text',
      value: e.text,
      placeholder: 'Write the idea…',
      oninput: (ev) => {
        set('text', ev.target.value);
        words.textContent = `${wordCount(ev.target.value)} words`;
      },
    });
    const swatches = h(
      'div',
      { class: 'swatches' },
      h('button', {
        class: 'swatch none' + (!e.color ? ' on' : ''),
        title: 'Use the branch color',
        onclick: () => {
          mutate(() => (state.entries[id].color = null));
          renderEditor();
        },
      }),
      COLORS.map((c) =>
        h('button', {
          class: 'swatch' + (e.color === c ? ' on' : ''),
          style: { background: c },
          onclick: () => {
            mutate(() => (state.entries[id].color = c));
            renderEditor();
          },
        })
      )
    );

    const modal = h(
      'div',
      {
        class: 'backdrop',
        onpointerdown: (ev) => {
          if (ev.target === ev.currentTarget) closeEditor();
        },
      },
      h(
        'div',
        { class: 'modal editor', role: 'dialog' },
        h(
          'div',
          { class: 'ed-head' },
          h('span', { class: 'num big', text: '#' + e.num }),
          h('input', { class: 'input ed-title', value: e.title, placeholder: 'Title (optional)', oninput: (ev) => set('title', ev.target.value) }),
          h('button', { class: 'btn icon', title: 'Close (Esc)', onclick: () => closeEditor() }, '✕')
        ),
        text,
        h(
          'div',
          { class: 'ed-row' },
          h('label', { class: 'muted' }, 'Tags'),
          h('input', {
            class: 'input',
            value: e.tags.join(', '),
            placeholder: 'comma, separated',
            oninput: (ev) => set('tags', parseTags(ev.target.value)),
          })
        ),
        h(
          'div',
          { class: 'ed-row' },
          h('label', { class: 'muted' }, 'Timeline'),
          placeSelect(loc ? loc.branch.id : 'none', {
            noneLabel: 'Unplaced',
            onChange: (v) => {
              mutate(() => {
                if (v === 'none') unplace(id);
                else if (!loc || loc.branch.id !== v) placeEntry(id, v, branchById(v).items.length);
              });
              renderEditor();
            },
          }),
          h('span', { class: 'muted', text: loc ? `position ${loc.index + 1} of ${loc.branch.items.length}` : '' })
        ),
        h('div', { class: 'ed-row' }, h('label', { class: 'muted' }, 'Color'), swatches),
        h(
          'div',
          { class: 'ed-foot' },
          h('button', { class: 'btn danger ghost', onclick: () => deleteEntry(id) }, 'Delete idea'),
          h('span', { class: 'spacer' }),
          words,
          h('span', { class: 'muted', text: 'Changes save automatically' }),
          h('button', { class: 'btn primary', onclick: () => closeEditor() }, 'Done')
        )
      )
    );
    root.appendChild(modal);
  }

  function askText(title, initial = '', placeholder = '') {
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      const holder = h('div');
      const input = h('input', { class: 'input', value: initial, placeholder });
      const done = (v) => {
        holder.remove();
        resolve(v);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(input.value);
        if (e.key === 'Escape') {
          e.stopPropagation();
          done(null);
        }
      });
      holder.appendChild(
        h(
          'div',
          { class: 'backdrop', onpointerdown: (e) => e.target === e.currentTarget && done(null) },
          h(
            'div',
            { class: 'modal small-modal' },
            h('h3', null, title),
            input,
            h('div', { class: 'ed-foot' }, h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => done(input.value) }, 'OK'))
          )
        )
      );
      root.appendChild(holder);
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  function showHelp() {
    const root = document.getElementById('modal-root');
    const holder = h('div');
    const close = () => holder.remove();
    const rows = [
      ['Ctrl + Enter', 'Index the idea you are typing'],
      ['Ctrl + N', 'New idea (opens the editor)'],
      ['Ctrl + 1 / 2 / 3 / 4', 'List / Timeline / Board / Read'],
      ['Ctrl + Z, Ctrl + Y', 'Undo / Redo (outside text boxes)'],
      ['Ctrl + F', 'Search ideas (List view)'],
      ['Ctrl + S', 'Save now (it also saves automatically)'],
      ['Drag a card', 'Reorder, move between branches, or drop on Unplaced'],
      ['⑂ Branch', 'Fork the story after that idea (hover a timeline card)'],
      ['Esc', 'Close a dialog / cancel a drag'],
    ];
    holder.appendChild(
      h(
        'div',
        { class: 'backdrop', onpointerdown: (e) => e.target === e.currentTarget && close() },
        h(
          'div',
          { class: 'modal small-modal' },
          h('h3', null, 'Keyboard shortcuts & tips'),
          h('table', { class: 'help' }, rows.map(([k, v]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, v)))),
          h('div', { class: 'ed-foot' }, h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: close }, 'Close'))
        )
      )
    );
    root.appendChild(holder);
  }

  // ======================================================================
  //  File actions
  // ======================================================================

  async function loadProject(data) {
    state = normalize(data);
    undoStack.length = 0;
    redoStack.length = 0;
    lastCoalesce = null;
    ui.editing = null;
    ui.readPath = 'main';
    document.getElementById('modal-root').innerHTML = '';
    updateUndoButtons();
    render();
  }

  async function handleAction(action) {
    document.getElementById('file-menu').classList.add('hidden');
    switch (action) {
      case 'new-project': {
        scheduleSave.flush();
        await saving;
        const res = await api.newProject();
        if (!res) return;
        await loadProject(null);
        await saveNow();
        toast('New narrative created');
        break;
      }
      case 'open': {
        scheduleSave.flush();
        await saving;
        const res = await api.open();
        if (!res) return;
        await loadProject(res.data);
        await saveNow();
        toast('Opened ' + (res.path || ''));
        break;
      }
      case 'save':
        scheduleSave.flush();
        await saveNow();
        toast('Saved');
        break;
      case 'save-as': {
        const res = await api.saveAs(JSON.parse(JSON.stringify(state)), state.title);
        if (res) toast('Saved as ' + res.path);
        break;
      }
      case 'export-txt':
        return exportStory('txt');
      case 'export-rtf':
        return exportStory('rtf');
      case 'export-md':
        return exportStory('md');
      case 'undo':
        return undo();
      case 'redo':
        return redo();
      case 'theme':
        document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        saveUiPrefs();
        break;
      case 'help':
        return showHelp();
      default:
        if (action.startsWith('view-')) setView(action.slice(5));
    }
  }

  function newIdea() {
    if (ui.view === 'list') {
      const t = document.querySelector('.composer-text');
      if (t) return t.focus();
    }
    const id = addEntry({ text: '' });
    render();
    openEditor(id, { isNew: true });
  }

  // ======================================================================
  //  Wiring
  // ======================================================================

  function wire() {
    for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => setView(t.dataset.view));
    document.getElementById('btn-new').addEventListener('click', newIdea);
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);

    const menu = document.getElementById('file-menu');
    document.getElementById('btn-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) menu.classList.add('hidden');
    });
    for (const b of menu.querySelectorAll('button[data-action]')) b.addEventListener('click', () => handleAction(b.dataset.action));

    const titleInput = document.getElementById('project-title');
    titleInput.addEventListener('input', () => {
      mutate(() => (state.title = titleInput.value), 'project-title');
      if (ui.view === 'read') {
        const pt = document.querySelector('.page-title');
        if (pt) pt.textContent = state.title;
      }
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') titleInput.blur();
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (ui.editing) {
          e.preventDefault();
          closeEditor();
        }
        return;
      }
      if (!mod) return;
      const k = e.key.toLowerCase();
      const inField = isTextField(document.activeElement);
      if (k === 'z' && !e.shiftKey && !inField) {
        e.preventDefault();
        undo();
      } else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !inField) {
        e.preventDefault();
        redo();
      } else if (k === 'n' && !e.shiftKey) {
        e.preventDefault();
        newIdea();
      } else if (k === 's' && !e.shiftKey && !api.isDesktop) {
        e.preventDefault();
        handleAction('save');
      } else if (k === 'f' && ui.view === 'list') {
        e.preventDefault();
        const s = document.getElementById('list-search');
        if (s) s.focus();
      } else if (['1', '2', '3', '4'].includes(k) && !api.isDesktop) {
        e.preventDefault();
        setView(['list', 'timeline', 'board', 'read'][Number(k) - 1]);
      }
    });

    if (api.onMenu) api.onMenu(handleAction);
    if (api.onBeforeClose) {
      api.onBeforeClose(async () => {
        scheduleSave.flush();
        await saving;
        api.closeReady();
      });
    }
    window.addEventListener('beforeunload', () => scheduleSave.flush());
  }

  async function init() {
    wire();
    updateUndoButtons();
    try {
      const res = await api.loadInitial();
      state = normalize(res && res.data);
      if (res && res.path) document.getElementById('save-status').title = res.path;
      if (!res || !res.data) await saveNow();
    } catch (err) {
      console.error(err);
      toast('Could not load your narrative: ' + err.message);
    }
    if (!['list', 'timeline', 'board', 'read'].includes(ui.view)) ui.view = 'list';
    render();
  }

  // ======================================================================
  //  Browser fallback (lets the UI run without Electron, e.g. for testing)
  // ======================================================================

  function makeBrowserAPI() {
    const KEY = 'narrative-project';
    const download = (content, name, type) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    };
    return {
      isDesktop: false,
      async loadInitial() {
        try {
          const raw = localStorage.getItem(KEY);
          return { path: 'browser storage', data: raw ? JSON.parse(raw) : null };
        } catch {
          return { path: 'browser storage', data: null };
        }
      },
      async save(data) {
        localStorage.setItem(KEY, JSON.stringify(data));
        return { ok: true, path: 'browser storage' };
      },
      async open() {
        return new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.narrative,.json';
          input.onchange = async () => {
            const f = input.files[0];
            if (!f) return resolve(null);
            try {
              resolve({ path: f.name, data: JSON.parse(await f.text()) });
            } catch {
              resolve(null);
            }
          };
          input.click();
        });
      },
      async saveAs(data, name) {
        download(JSON.stringify(data, null, 2), (name || 'Narrative') + '.narrative', 'application/json');
        return { path: (name || 'Narrative') + '.narrative' };
      },
      async newProject() {
        return confirm('Start a new, empty narrative? (Use "Save as" first if you want a copy of this one.)') ? { path: 'browser storage' } : null;
      },
      async exportFile(content, name) {
        download(content, name, name.endsWith('.rtf') ? 'application/rtf' : 'text/plain');
        return { path: name };
      },
    };
  }

  init();
})();
