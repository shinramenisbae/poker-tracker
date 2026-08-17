# `/setup-roles` — the bot creates and assigns the roles itself

**Date:** 2026-08-17
**Status:** approved, ready for implementation plan

## Problem

Onboarding a new group means the owner creates three Discord roles by hand, then
drags the bot's own role above two of them, then copies nothing (the pickers are
native) but must still know which role is which. The drag step is the one people
miss, and when they do, streak roles fail *silently*: Discord refuses to let a
bot assign a role positioned above its own, and nothing in the current code
surfaces that.

Group B hit exactly this — `/setup` reported success with `Results ping role:
not set`, `Running Hot role: not set`, `Running Cold role: not set`, because the
roles did not exist to pick.

## Goals

- The owner types names, not IDs, and never touches the Discord role editor.
- Roles land in a position where the bot can actually assign them.
- The results ping role is applied to the existing membership, not just created.
- Re-running is safe.

## Non-goals

- Replacing `/setup`. It keeps its role *pickers*, which is how group A is
  already configured and how anyone with pre-existing roles should proceed.
- Assigning the streak roles. `Running Hot` / `Running Cold` are earned — the
  bot grants and revokes them from session results. Seeding them at setup would
  be wrong within one scan.
- Role colours, permissions, or hoisting. Discord defaults; the owner can
  restyle afterwards and the bot keeps working, because it stores IDs.

## Command shape

A new `/setup-roles`, gated on **Manage Server** (matching `/setup`) and
disabled in DMs.

A modal is the only Discord surface that prompts for free text, and it must be
the *first* response to an interaction — it cannot follow a deferral. That rules
out doing this inside `/setup`, whose existing options are typed as role
pickers and cannot also accept a typed name. Hence a separate command whose sole
job is to open the modal.

### Modal

`custom_id: setup-roles`, three short text inputs, none required:

| Field | Label | Prefilled |
|---|---|---|
| `poker_role_name` | Results ping role | `Poker` |
| `hot_role_name` | Running Hot role | `Running Hot` |
| `cold_role_name` | Running Cold role | `Running Cold` |

A field left blank skips that role entirely, leaving any existing setting alone.

### Submission

Modal submit is a fresh interaction, so it defers normally and then has 15
minutes. The reply is **ephemeral** — this is admin housekeeping and the summary
can run long, unlike `/setup`, whose public config echo is useful to the group.

## Flow

1. **Resolve each name.** Case-insensitive exact match against the guild's
   existing roles, excluding `@everyone` and managed (integration-owned) roles.
   A match is reused; otherwise the role is created. Reuse is what makes
   re-running safe and stops a second `/setup-roles` producing `Poker`,
   `Poker`, `Poker`.
2. **Verify position.** A role the bot creates lands directly below the bot's
   own highest role, which is where it needs to be. A *reused* role may sit
   above it — the bot cannot move a role above its own, so this is reported per
   role rather than attempted and silently failed.
3. **Assign the ping role** to every non-bot member that does not already have
   it. Under 100 members this is seconds, well inside the deferred window.
   Individual failures are counted, not fatal.
4. **Persist** `pokerRoleId`, `hotRoleId`, `coldRoleId` to that guild's
   `bot-settings`, alongside `guildId` and `guildName` as `/setup` writes them.
   The endpoint merges partial updates, so the watched channel and reminder
   settings are untouched. Then `refreshSettings()` so the running process picks
   them up without a restart.
5. **Report**: per role, created or reused; how many members were given the ping
   role, how many already had it, how many failed.

## Error handling

| Condition | Behaviour |
|---|---|
| Bot lacks Manage Roles | Stop before creating anything; say which permission is missing. No partial state. |
| A reused role sits above the bot's role | Still saved — it is a valid role — but flagged: "I can't assign this one, move it below my role." |
| Some member assignments fail | Counted and reported. The run completes. |
| All three fields blank | Nothing to do; say so rather than writing an empty update. |
| The same name given for two fields | Rejected before any writes. Pointing the hot and cold roles at one role would make streak transitions add and remove the same role, so this is a typo worth catching rather than honouring. |
| Member list unavailable | Means the Server Members intent is off. Report that plainly — it is an operator fix, not a user one. |

## Prerequisites

- **Server Members privileged intent**, enabled in the Developer Portal *and*
  requested as `GatewayIntentBits.GuildMembers` in the client. Without it
  `guild.members.fetch()` returns only cached members and assignment silently
  under-applies. No re-invite is needed — intents are a gateway property, not
  part of the OAuth grant.
- **Manage Roles** on the bot, which the current invite link already grants.

## Testing

The decision logic is pure and gets tested first, in the style of
`bot/respond.test.js` — hand-rolled fakes at the Discord boundary only:

- `resolveRoleName(existingRoles, name)` → reuse an exact case-insensitive
  match, skip managed and `@everyone`, otherwise signal create.
- `membersNeedingRole(members, roleId)` → excludes bots, excludes members who
  already hold it, so a re-run assigns nothing.
- `canAssign(role, botHighestPosition)` → false when the role outranks the bot.

Creating roles and adding them to members are single Discord calls behind those
decisions and are exercised live, not unit tested. Two things need a real run:
that a bot-created role does land below the bot's own, and that the modal
round-trip behaves — both are cheap to confirm in group B.

## Discoverability

`/settings` gains a line when no roles are configured: *"No roles set — run
`/setup-roles` and I'll create them."* That surfaces the second command exactly
when it is relevant, which is the cost of not folding this into `/setup`.
