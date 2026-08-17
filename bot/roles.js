// Deciding what /setup-roles should do, before it talks to Discord.
//
// Creating the roles for a server owner removes the step people actually get
// wrong: a bot cannot assign a role positioned above its own, and Discord gives
// no error the owner ever sees when it tries. Roles the bot creates land below
// its own automatically, so creating beats picking.
//
// These rules are kept pure — the caller maps discord.js objects to the plain
// shapes below — so they can be tested without a gateway connection.

/**
 * Trim what the owner typed and reject the two inputs that can't be honoured.
 *
 * @param {{poker: string, hot: string, cold: string}} raw
 * @returns {{ok: true, names: object} | {ok: false, error: string}}
 */
function validateRoleNames(raw = {}) {
  const names = {
    poker: String(raw.poker || '').trim(),
    hot: String(raw.hot || '').trim(),
    cold: String(raw.cold || '').trim(),
  };

  const given = Object.values(names).filter(Boolean);
  if (given.length === 0) {
    return { ok: false, error: 'Give at least one role name — all three fields were blank.' };
  }

  // Two fields sharing a name would resolve to one role. For hot and cold that
  // means every streak transition adds and removes the same role, so it's a
  // typo worth catching rather than honouring.
  const seen = new Set();
  for (const name of given) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `Two roles were given the same name (**${name}**). Each needs its own.` };
    }
    seen.add(key);
  }

  return { ok: true, names };
}

/**
 * Reuse a role of this name if the guild already has one, else signal create.
 * Reuse is what makes re-running safe — otherwise a second run leaves the
 * server with three roles called "Poker".
 *
 * @param {Array<{id: string, name: string, managed: boolean}>} existingRoles
 * @param {string} name
 * @returns {{action: 'reuse', role: object} | {action: 'create'}}
 */
function resolveRoleName(existingRoles = [], name = '') {
  const wanted = String(name).trim().toLowerCase();
  const match = existingRoles.find((r) => (
    // @everyone can't be assigned, and a managed role belongs to an
    // integration — Discord refuses to hand either out.
    !r.managed
    && r.name !== '@everyone'
    && String(r.name).trim().toLowerCase() === wanted
  ));
  return match ? { action: 'reuse', role: match } : { action: 'create' };
}

/**
 * Can the bot actually hand this role out? Only roles strictly below its own
 * highest, and it cannot promote a role above itself to fix that.
 *
 * @param {{position: number}} role
 * @param {number} botHighestPosition
 */
function canAssign(role, botHighestPosition) {
  return Number(role.position) < Number(botHighestPosition);
}

/**
 * Who still needs the role. Bots are skipped, and so is anyone who already has
 * it, which is what makes a re-run a no-op rather than N pointless API calls.
 *
 * @param {Array<{id: string, isBot: boolean, roleIds: string[]}>} members
 * @param {string} roleId
 */
function membersNeedingRole(members = [], roleId) {
  return members.filter((m) => !m.isBot && !(m.roleIds || []).includes(roleId));
}

export { validateRoleNames, resolveRoleName, canAssign, membersNeedingRole };
