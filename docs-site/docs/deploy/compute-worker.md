title: Compute Worker (NATS JetStream)
---

Use this guide for `COMPUTE_MODE=worker` deployments where heavy compute runs outside the Next.js app server.

## Overview

The compute worker handles:

- Whisper word alignment (`/align/whisper/jobs`)
- PDF layout parsing (`/layout/pdf/jobs`)

The app server enqueues jobs and polls status. Queue durability and retries are backed by NATS JetStream WorkQueue consumers and NATS KV.

## Published image

- App server image: `ghcr.io/richardr1126/openreader`
- Compute worker image: `ghcr.io/richardr1126/openreader-compute-worker`

## Worker environment variables

Required:

- `COMPUTE_WORKER_TOKEN`: bearer token expected by worker routes
- `NATS_URL`: NATS server connection string (JetStream enabled)
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

> [!IMPORTANT]
> **S3 credentials cannot be left blank/empty** when running in worker mode.
> While the main Next.js server can generate random, dynamic S3 keys on-the-fly when `USE_EMBEDDED_WEED_MINI=true` and `S3_*` vars are blank, the compute worker runs in a separate process and cannot connect to SeaweedFS using those dynamically generated keys. 
> To use the compute worker with the embedded SeaweedFS, you **must configure identical, stable S3 credentials** (e.g. `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`) in both the root `.env` and the compute worker `.env` files.

Common optional:

- `NATS_CREDS`: raw user credentials file content (JWT + private key), ideal for cloud container environments where mounting files is difficult.
- `NATS_CREDS_FILE`: path to a `.creds` file on the server.
- `S3_ENDPOINT` (for non-AWS S3-compatible storage)
- `S3_FORCE_PATH_STYLE=true` (for many S3-compatible providers)
- `S3_PREFIX=openreader`
- `COMPUTE_WORKER_HOST=0.0.0.0`
- `COMPUTE_WORKER_PORT=8081`
- `COMPUTE_LOG_FORMAT=pretty` (default) or `json`
- `COMPUTE_PREWARM_MODELS=true`

## App server environment variables (worker mode)

Set on the Next.js app server:

```env
COMPUTE_MODE=worker
COMPUTE_WORKER_URL=http://<worker-host>:8081
COMPUTE_WORKER_TOKEN=<same-token-as-worker>
```

`COMPUTE_MODE=worker` has no local fallback. If worker is unavailable, affected requests fail.

## Production notes

- Worker mode assumes shared object storage is reachable by both app server and worker.
- Non-exposed embedded `weed mini` is not supported with external worker mode.
- Protect `COMPUTE_WORKER_TOKEN` and avoid exposing worker routes publicly without auth.

## Health endpoints

- `GET /health/live`
- `GET /health/ready`

## Authenticating with Synadia Cloud (NGS)

If you are using a free Synadia Cloud account to back your compute queue in production:

1. **Obtain your credentials file**: When creating a user or a service account on Synadia Cloud, download your credentials file (usually named `<something>.creds`).
2. **Configure NATS URL**: Synadia Cloud's server address is `tls://connect.ngs.global:4222`. Set this as your `NATS_URL`.
3. **Configure Authentication**:
   - **Using a local file path**: Set `NATS_CREDS_FILE` to the path of your `.creds` file:
     ```env
     NATS_URL=tls://connect.ngs.global:4222
     NATS_CREDS_FILE=/app/secrets/NGS-Default-compute-worker.creds
     ```
   - **Using raw content (Recommended for Railway, Fly.io, etc.)**: Set `NATS_CREDS` to the exact content of your `.creds` file (including the begin/end banners for JWT and NKEY seed). Since `.creds` contains newlines, wrap the entire value in quotes or paste it directly into your cloud provider's Secrets/Environment settings:
     ```env
     NATS_URL=tls://connect.ngs.global:4222
     NATS_CREDS="-----BEGIN NATS USER JWT-----\neyJ0...------END USER NKEY SEED------"
     ```
