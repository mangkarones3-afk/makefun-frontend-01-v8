// bounty.js — one bounty's page: its facts, its phase stepper, the full
// description and rules, how it is decided, and the rewards table with a
// link onward to its leaderboard.

import { bounty as fetchBounty, setDrawn } from './api.js';
import { money, int, fmtDate, md } from './format.js';
import { h, statusOf, chip, factCard, stepper, rewardsTable } from './pieces.js';

export function renderBounty(content, go, slug) {
  let alive = true;
  content.innerHTML = '';
  const panel = h('section', 'panel panel-pad');
  panel.append(h('p', 'empty', 'Loading this bounty…'));
  content.append(panel);

  fetchBounty(slug)
    .then((b) => {
      if (!alive) return;
      const status = statusOf(b);
      panel.replaceChildren();
      const back = h('p');
      const backLink = h('a', '', 'Back to the board');
      backLink.href = '#/';
      back.append(backLink);
      panel.append(back);
      const head = h('div', 'pane-head');
      head.append(h('h1', '', b.title), chip(status));
      const facts = h('div', 'facts', [
        factCard('Reward', money(b.rewardAmount), 'The house prize'),
        factCard('Live pot', money(b.potUsd ?? b.rewardAmount), 'House prize plus entry fees'),
        factCard('Entry fee', Number(b.entryFeeUsd) > 0 ? money(b.entryFeeUsd) : 'Free', Number(b.entryFeeUsd) > 0 ? 'Paid once per account' : 'Nothing to pay'),
        factCard('Entries', int(b.submissionCount), 'Submitted so far'),
        factCard('Deadline', fmtDate(b.deadline), status.key === 'closed' ? 'Entries have closed' : 'Entries close then'),
        factCard('Status', status.label, b.sponsor?.name ? 'From ' + b.sponsor.name : b.category || ''),
      ]);
      panel.append(head, facts, stepper(b));

      if (b.summary) panel.append(h('p', 'lede', b.summary));

      const about = h('div', 'body-text');
      about.innerHTML = md(b.description || '');
      panel.append(h('h2', '', 'About this bounty'), about);

      if (b.resolution?.summary) {
        const decided = h('div', 'body-text');
        decided.innerHTML = md(b.resolution.summary);
        panel.append(h('h2', '', 'How it is decided'), decided);
      }
      if (Array.isArray(b.skills) && b.skills.length) {
        panel.append(h('h2', '', 'Skills it calls for'), h('p', '', b.skills.join(', ')));
      }

      const table = h('div');
      table.innerHTML = rewardsTable(b);
      panel.append(h('h2', '', 'Rewards'), table);
      const places = Array.isArray(b.rewardsNow) && b.rewardsNow.length
        ? b.rewardsNow.length
        : Object.keys(b.rewards || {}).length;
      setDrawn(places);

      const onward = h('p');
      const link = h('a', '', 'See the leaderboard for this bounty');
      link.href = '#/bounty/' + b.slug + '/leaderboard';
      onward.append(link);
      panel.append(onward);
    })
    .catch((err) => {
      if (!alive) return;
      panel.replaceChildren(h('p', 'error', 'This bounty could not load: ' + err.message));
    });

  return () => {
    alive = false;
    setDrawn(0);
  };
}
