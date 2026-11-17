// board.js — the bounty board: a filterable list beside a detail pane.
//
// The toolbar is the point of this view: a search field, status chips and
// a sort control, all working on the board data already loaded — filtering
// costs no API requests. Rows are keyed by slug and reconciled, so a row
// that survives a filter keeps its DOM node; only its position changes.

import { board as fetchBoard, bounty as fetchBounty, setDrawn } from './api.js';
import { money, int, fmtDate, timeLeft, countdown, clamp } from './format.js';
import { h, statusOf, chip, factCard, stepper, rewardsTable } from './pieces.js';

const FILTERS = [
  ['all', 'All'],
  ['open', 'Open'],
  ['closing', 'Closing soon'],
  ['closed', 'Closed'],
];
const SORTS = [
  ['ending', 'Ending soon'],
  ['pot', 'Biggest pot'],
  ['entries', 'Most entries'],
];
export function renderBoard(content, go) {
  const state = { items: [], q: '', status: 'all', sort: 'ending', selected: null };
  const rows = new Map(); // slug -> { el, pot, time, entries, chipSlot }
  let timer = null;
  let alive = true;

  content.innerHTML = '';
  const layout = h('div', 'board');
  const left = h('section', 'panel');
  const pane = h('section', 'panel panel-pad pane');
  layout.append(left, pane);
  content.append(layout);

  // --- toolbar -------------------------------------------------------------
  const toolbar = h('div', 'toolbar');
  const search = h('input', 'search');
  search.type = 'search';
  search.placeholder = 'Search bounties by title or sponsor';
  search.setAttribute('aria-label', 'Search bounties');
  search.addEventListener('input', () => {
    state.q = search.value.trim().toLowerCase();
    apply();
  });
  search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && search.value) {
      search.value = '';
      state.q = '';
      apply();
    }
  });
  const chipsRow = h('div', 'chips');
  const chipEls = {};
  for (const [key, label] of FILTERS) {
    const b = h('button', 'fchip', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', key === 'all' ? 'true' : 'false');
    b.addEventListener('click', () => {
      state.status = key;
      for (const k of Object.keys(chipEls)) chipEls[k].setAttribute('aria-pressed', k === key ? 'true' : 'false');
      apply();
    });
    chipEls[key] = b;
    chipsRow.append(b);
  }
  const sortRow = h('label', 'sortrow', 'Sort by');
  const sortSelect = h('select');
  sortSelect.setAttribute('aria-label', 'Sort bounties');
  for (const [key, label] of SORTS) {
    const opt = h('option', '', label);
    opt.value = key;
    sortSelect.append(opt);
  }
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
    apply();
  });
  sortRow.append(sortSelect);
  toolbar.append(search, chipsRow, sortRow);
  const count = h('div', 'board-count', 'Loading the board…');
  const list = h('div', 'rows');
  left.append(toolbar, count, list);

  // --- rows ------------------------------------------------------------------
  function makeRow(item) {
    const el = h('button', 'brow');
    el.type = 'button';
    const title = h('span', 'brow-title', item.title);
    const entries = h('span', 'brow-entries num');
    const top = h('span', 'brow-top', [title, entries]);
    const pot = h('span', 'pot num');
    const fee = h('span', 'num');
    const time = h('span', 'num');
    const chipSlot = h('span');
    const meta = h('span', 'brow-meta', [pot, fee, time, chipSlot]);
    el.append(top, meta);
    el.addEventListener('click', () => select(item.slug, true));
    const rec = { el, pot, fee, time, entries, chipSlot };
    rows.set(item.slug, rec);
    refreshRow(item);
    return rec;
  }

  function refreshRow(item) {
    const rec = rows.get(item.slug);
    if (!rec) return;
    rec.pot.textContent = money(item.potUsd ?? item.rewardAmount);
    rec.fee.textContent = Number(item.entryFeeUsd) > 0 ? 'Fee ' + money(item.entryFeeUsd) : 'Free entry';
    rec.time.textContent = timeLeft(item.deadline);
    rec.entries.textContent = int(item.submissionCount) + ' entries';
    rec.chipSlot.replaceChildren(chip(statusOf(item)));
    rec.el.classList.toggle('sel', item.slug === state.selected);
  }

  function sorter(a, b) {
    const closedA = statusOf(a).key === 'closed' ? 1 : 0;
    const closedB = statusOf(b).key === 'closed' ? 1 : 0;
    if (closedA !== closedB) return closedA - closedB;
    if (state.sort === 'pot') return Number(b.potUsd || 0) - Number(a.potUsd || 0);
    if (state.sort === 'entries') return (b.submissionCount || 0) - (a.submissionCount || 0);
    return new Date(a.deadline) - new Date(b.deadline);
  }

  function visible() {
    return state.items
      .filter((item) => {
        if (state.status !== 'all' && statusOf(item).key !== state.status) return false;
        if (!state.q) return true;
        const hay = (item.title + ' ' + (item.sponsor?.name || '') + ' ' + item.slug).toLowerCase();
        return hay.includes(state.q);
      })
      .sort(sorter);
  }

  function apply() {
    const vis = visible();
    const keep = new Set(vis.map((i) => i.slug));
    for (const [slug, rec] of rows) if (!keep.has(slug)) rec.el.remove();
    for (const item of vis) {
      const rec = rows.get(item.slug) || makeRow(item);
      refreshRow(item);
      list.append(rec.el); // moves the node; surviving rows keep theirs
    }
    count.textContent = vis.length + ' of ' + state.items.length + ' bounties shown';
    setDrawn(vis.length);
    if (!keep.has(state.selected)) {
      if (vis.length) select(vis[0].slug, false);
      else {
        state.selected = null;
        pane.replaceChildren(h('p', 'empty', 'No bounties match. Clear the search or pick another filter.'));
      }
    }
  }

  // --- detail pane -----------------------------------------------------------
  function select(slug, focusPane) {
    const item = state.items.find((i) => i.slug === slug);
    if (!item) return;
    state.selected = slug;
    for (const it of state.items) if (rows.has(it.slug)) refreshRow(it);
    renderPane(item);
    fetchBounty(slug)
      .then((detail) => {
        if (!alive) return;
        Object.assign(item, detail);
        refreshRow(item);
        if (state.selected === slug) renderPane(item);
      })
      .catch(() => {});
    if (focusPane && window.innerWidth <= 820) pane.scrollIntoView({ block: 'start' });
  }

  function renderPane(item) {
    const status = statusOf(item);
    pane.replaceChildren();
    const head = h('div', 'pane-head');
    const title = h('h1', '', item.title);
    head.append(title, chip(status));
    const summary = h('p', 'summary', clamp(item.summary || item.description || '', 400));
    const clockBlock = h('div', 'clock-block');
    const clockLabel = h('div', 'clock-label', status.key === 'closed' ? 'This bounty has closed' : 'Time left to enter');
    const clock = h('div', 'clock num' + (status.key === 'closed' ? ' is-closed' : ''), countdown(item.deadline));
    clock.dataset.clock = item.deadline;
    clockBlock.append(clockLabel, clock);
    const first = item.rewardsNow?.[0]?.amountUsd ?? item.rewards?.['1'];
    const facts = h('div', 'facts', [
      factCard('Reward', money(item.rewardAmount), first ? 'First place pays ' + money(first) : ''),
      factCard('Live pot', money(item.potUsd ?? item.rewardAmount), 'House prize plus entry fees'),
      factCard('Entry fee', Number(item.entryFeeUsd) > 0 ? money(item.entryFeeUsd) : 'Free', Number(item.entryFeeUsd) > 0 ? 'Paid once per account' : 'Nothing to pay'),
      factCard('Entries', int(item.submissionCount), 'Submitted so far'),
      factCard('Deadline', fmtDate(item.deadline), 'Entries close then'),
      factCard('Status', status.label, item.sponsor?.name ? 'From ' + item.sponsor.name : item.category || ''),
    ]);
    const rewardsHead = h('h2', '', 'Rewards');
    const table = h('div');
    table.innerHTML = rewardsTable(item);
    const more = h('p');
    const link = h('a', '', 'Read the rules and full description');
    link.href = '#/bounty/' + item.slug;
    more.append(link);
    pane.append(head, summary, clockBlock, facts, stepper(item), rewardsHead, table, more);
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const el = pane.querySelector('[data-clock]');
      if (el) el.textContent = countdown(el.dataset.clock);
    }, 1000);
  }

  pane.append(h('p', 'empty', 'Loading live bounties…'));
  fetchBoard()
    .then((items) => {
      if (!alive) return;
      state.items = items;
      apply();
    })
    .catch((err) => {
      if (!alive) return;
      pane.replaceChildren(h('p', 'error', 'The board could not load: ' + err.message));
      count.textContent = 'Board unavailable';
    });

  return () => {
    alive = false;
    if (timer) clearInterval(timer);
    setDrawn(0);
  };
}
