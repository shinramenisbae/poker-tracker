# CI/CD

This repo deploys via GitHub Actions ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)).

- **On every pull request:** the `ci` job installs dependencies, builds the
  frontend (`tsc -b && vite build`), and runs `eslint`. A failing build blocks
  the merge.
- **On every push/merge to `main`:** after `ci` passes, the `deploy` job SSHes
  into the VPS and runs the same flow we used to run by hand:

  ```bash
  cd /root/.openclaw/workspace/poker-tracker
  git pull --ff-only
  bash deploy.sh                       # build frontend + restart backend
  # bot is restarted only if files under bot/ changed in this push
  ```

The live site is `https://srv1346724.hstgr.cloud` (Hetzner Cloud VPS).

> There is **no Docker** in this setup, and none is needed. The app runs as
> nginx-served static files plus systemd-managed Node services with a SQLite
> file on disk. Docker would only add value for multi-host/portable deploys.

## One-time setup

The pipeline needs SSH access to the VPS. This only has to be done once.

1. **Generate a deploy keypair** (no passphrase) on your machine:

   ```bash
   ssh-keygen -t ed25519 -f gha_deploy -C "github-actions-deploy"
   ```

2. **Authorize the public key on the VPS** — append `gha_deploy.pub` to root's
   authorized keys:

   ```bash
   ssh-copy-id -i gha_deploy.pub root@76.13.182.206
   # or: cat gha_deploy.pub | ssh root@76.13.182.206 'cat >> ~/.ssh/authorized_keys'
   ```

3. **Add repository secrets** in GitHub → **Settings → Secrets and variables →
   Actions → New repository secret**:

   | Secret        | Value                                  |
   | ------------- | -------------------------------------- |
   | `VPS_SSH_KEY` | Full contents of the **private** key `gha_deploy` |
   | `VPS_HOST`    | `76.13.182.206`                        |
   | `VPS_USER`    | `root`                                 |
   | `VPS_PORT`    | *(optional)* SSH port if not `22`      |

4. **Confirm the VPS working tree is clean** and tracking `origin/main` so
   `git pull --ff-only` succeeds (it already is, from the manual deploy flow).

## Notes

- App secrets (`DISCORD_TOKEN`, `GEMINI_API_KEY`, etc. — see
  `bot/.env.example`) are **not** part of CI/CD. The `.env` files already live on
  the server and are never touched by deploys.
- The SQLite database (`backend/poker.db`) is gitignored and persists on the
  VPS across deploys.
- `deploy.sh` is unchanged and can still be run manually on the server.
- **Rollback:** revert the offending commit on `main`; the revert auto-deploys.

## Status

- ✅ Pipeline verified end-to-end on 2026-05-31: push to `main` → CI (build +
  lint) → SSH deploy → health check, all green.
- ✅ Commit attribution confirmed: deploys are authored under the maintainer's
  GitHub identity.
