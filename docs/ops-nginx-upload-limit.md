# Ops: nginx request body limit (hand-log 413)

## Symptom

Uploading a PokerNow hand log larger than ~1 MB (for the all-in EV chart) fails with:

```
API Error: 413 - <html> ... <title>413 Request Entity Too Large</title> ...
nginx/1.24.0 (Ubuntu)
```

This affects both the web upload and the Discord bot's hand-log upload — both
post to `https://srv1346724.hstgr.cloud/api/...`, which nginx reverse-proxies
to the Node backend.

## Cause

Two separate limits sit in front of the hand-log endpoint:

1. **Express** (`backend/server.js`): `express.json({ limit: '20mb' })` — already 20 MB. ✅
2. **nginx** reverse proxy: `client_max_body_size` defaults to **1 MB**, and
   rejects the request *before* it ever reaches Node. ❌

The nginx config lives only on the VPS (not in this repo), so it can't be fixed
in code — it's a one-time server change.

## Fix (on the VPS)

Edit the site's nginx server block (e.g. `/etc/nginx/sites-available/poker-tracker`
or whatever serves `srv1346724.hstgr.cloud`) and raise the limit to match the
backend. Put it in the `server { }` block (or the specific `location /api/`):

```nginx
server {
    server_name srv1346724.hstgr.cloud;
    # Hand logs can be a few MB of CSV; match the backend's 20mb json limit.
    client_max_body_size 20m;
    # ... existing location / and location /api proxy_pass blocks ...
}
```

Then:

```bash
nginx -t          # validate config
systemctl reload nginx
```

Re-upload the hand log — it should now reach the backend and parse.
