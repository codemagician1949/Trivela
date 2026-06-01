# Operations Runbook

## Manual Rollback After Blue/Green Deployment

Use this procedure when:
- A deployment succeeded but issues are discovered post-deploy
- The automatic rollback in `deploy-blue-green.sh` did not trigger
- You need to roll back a Kubernetes rolling update

### Step 1 — Identify the active slot

```bash
docker ps --filter "name=trivela-backend"
```

You will see `trivela-backend-blue` (the current live container after a successful deploy).

### Step 2 — Start the previous image as green

Find the previous image tag from your registry or CI history, then:

```bash
export DEPLOY_IMAGE=ghcr.io/finesseStudioLab/trivela-backend:v1.2.2  # previous tag
docker run -d \
  --name trivela-backend-green \
  --restart unless-stopped \
  -p 3002:3001 \
  --env-file .env \
  "$DEPLOY_IMAGE"
```

### Step 3 — Verify health

```bash
curl -sf http://localhost:3002/health
# Expected: {"status":"ok", ...}
```

Wait until healthy before proceeding.

### Step 4 — Switch nginx upstream to the previous version

```bash
cat > /etc/nginx/conf.d/trivela_upstream.conf <<'EOF'
upstream trivela_backend {
  server 127.0.0.1:3002;
}
EOF
nginx -s reload
```

Verify traffic is flowing:

```bash
curl -sf http://localhost/health
```

### Step 5 — Stop the broken blue container

```bash
docker stop trivela-backend-blue
docker rm trivela-backend-blue
```

### Step 6 — Rename green → blue

```bash
docker rename trivela-backend-green trivela-backend-blue
docker update --publish-add 3001:3001 trivela-backend-blue  # restore standard port mapping
```

Update the nginx upstream back to the standard port:

```bash
cat > /etc/nginx/conf.d/trivela_upstream.conf <<'EOF'
upstream trivela_backend {
  server 127.0.0.1:3001;
}
EOF
nginx -s reload
```

---

## Health Checks

| Endpoint | Expected Response |
|---|---|
| `GET /health` | `{"status":"ok"}` HTTP 200 |
| `GET /health/rpc` | `{"status":"ok"}` HTTP 200 (RPC healthy) |
| `GET /metrics` | Prometheus text format, HTTP 200 |

---

## Common Incidents

### Backend returns 5xx

1. Check logs: `docker logs --tail 100 trivela-backend-blue`
2. Check RPC health: `curl http://localhost:3001/health/rpc`
3. If RPC is down, the backend degrades gracefully — listings still serve from cache.
4. If database errors, check `DATABASE_URL` env var and connectivity.

### High error rate post-deploy

If error rate spikes within the first 30 s after a blue/green cut-over, the
script rolls back automatically. If you passed the settle window:
1. Follow the manual rollback steps above.
2. Capture logs from the failed container before removing it:
   ```bash
   docker logs trivela-backend-blue > /tmp/failed-deploy-$(date +%s).log
   ```

### nginx fails to reload

```bash
nginx -t  # test config syntax
journalctl -u nginx --since "5 minutes ago"
```

Fix the upstream config syntax and retry `nginx -s reload`.

---

## Security Headers Smoke Test

Run after every deployment to confirm headers are present:

```bash
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
REQUIRED_HEADERS=(
  "x-content-type-options: nosniff"
  "referrer-policy: strict-origin-when-cross-origin"
  "permissions-policy"
  "content-security-policy"
)
PASS=true
for header in "${REQUIRED_HEADERS[@]}"; do
  if curl -sI "$BACKEND_URL/health" | grep -qi "$header"; then
    echo "  PASS  $header"
  else
    echo "  FAIL  $header"
    PASS=false
  fi
done
$PASS && echo "All security headers present." || { echo "Missing headers — check securityHeaders.js"; exit 1; }
```