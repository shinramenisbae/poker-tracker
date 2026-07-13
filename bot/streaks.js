// Hot/cold streak detection over tracker sessions.
//
// A player is RUNNING HOT after winning >= `threshold` (default 3) of their
// most recent played sessions in a row, RUNNING COLD after losing that many in
// a row. "Played" = they appear in a completed session and cashed out; sessions
// a player skipped don't break their streak. An exactly-even session breaks
// both kinds of streak.
//
// computeStreakTransitions(sessions, sessionId) answers: what changed BECAUSE
// of this session? It compares each player's streak state just before the
// session with the state just after it, considering only sessions up to and
// including the target — so reposting an old session yields the historically
// correct lines for that moment, not today's state.

import { totalBuyIn, cashOutOf, hasCashedOut } from './settlement.js';

const EPS = 0.005;

// Completed sessions oldest → newest, ordered by date then createdAt (stable
// tiebreak for two sessions on the same night).
function orderedSessions(sessions) {
  return (sessions || [])
    .filter((s) => s.status === 'completed')
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
}

// 'win' | 'loss' | 'even' for playerName in this session, or null if they
// didn't play (absent or never cashed out).
function resultFor(session, playerName) {
  const p = (session.players || []).find((x) => x.name === playerName);
  if (!p || !hasCashedOut(p)) return null;
  const profit = cashOutOf(p) - totalBuyIn(p);
  if (profit > EPS) return 'win';
  if (profit < -EPS) return 'loss';
  return 'even';
}

// Streak at the END of a win/loss sequence: { type: 'win'|'loss'|null, length }.
// 'even' terminates any streak.
function tailStreak(resultSeq) {
  let type = null;
  let length = 0;
  for (let i = resultSeq.length - 1; i >= 0; i--) {
    const r = resultSeq[i];
    if (r === 'even') break;
    if (type === null) {
      type = r;
      length = 1;
    } else if (r === type) {
      length++;
    } else {
      break;
    }
  }
  return { type, length };
}

/**
 * Streak transitions caused by one session.
 * @returns Array<{ playerName, kind: 'hot'|'cold', event: 'started'|'extended'|'broken', length }>
 *   - started:  crossed the threshold with this session
 *   - extended: was already at/over threshold and kept it going (length = new run)
 *   - broken:   was at/over threshold and this session ended it (length = the run that ended)
 */
function computeStreakTransitions(sessions, sessionId, { threshold = 3 } = {}) {
  const ordered = orderedSessions(sessions);
  const idx = ordered.findIndex((s) => s.id === sessionId);
  if (idx === -1) return [];
  const target = ordered[idx];
  const before = ordered.slice(0, idx);
  const after = ordered.slice(0, idx + 1);

  const transitions = [];
  for (const p of target.players || []) {
    if (!hasCashedOut(p)) continue;
    const seqBefore = before.map((s) => resultFor(s, p.name)).filter(Boolean);
    const seqAfter = after.map((s) => resultFor(s, p.name)).filter(Boolean);
    const b = tailStreak(seqBefore);
    const a = tailStreak(seqAfter);

    for (const [kind, resType] of [['hot', 'win'], ['cold', 'loss']]) {
      const wasOn = b.type === resType && b.length >= threshold;
      const isOn = a.type === resType && a.length >= threshold;
      if (isOn && !wasOn) transitions.push({ playerName: p.name, kind, event: 'started', length: a.length });
      else if (isOn && wasOn) transitions.push({ playerName: p.name, kind, event: 'extended', length: a.length });
      else if (!isOn && wasOn) transitions.push({ playerName: p.name, kind, event: 'broken', length: b.length });
    }
  }
  return transitions;
}

// True when sessionId is the newest completed session — the only time role
// mutations should run (a repost of an old session must not rewrite roles).
function isLatestCompletedSession(sessions, sessionId) {
  const ordered = orderedSessions(sessions);
  return ordered.length > 0 && ordered[ordered.length - 1].id === sessionId;
}

export { computeStreakTransitions, isLatestCompletedSession, orderedSessions, tailStreak, resultFor };
