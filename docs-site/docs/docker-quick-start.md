---
title: Docker Quick Start
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

## Prerequisites

- A recent Docker version installed
- A TTS API server that OpenReader can reach:
  - [Kokoro-FastAPI](./configure/tts-provider-guides/kokoro-fastapi)
  - [KittenTTS-FastAPI](./configure/tts-provider-guides/kitten-tts-fastapi)
  - [Orpheus-FastAPI](./configure/tts-provider-guides/orpheus-fastapi)
  - [Replicate](./configure/tts-provider-guides/replicate)
  - [DeepInfra](./configure/tts-provider-guides/deepinfra)
  - [OpenAI](./configure/tts-provider-guides/openai)
  - [Other OpenAI-compatible providers](./configure/tts-provider-guides/other)

:::warning SeaweedFS Compatibility Note (April 16, 2026)
OpenReader currently pins embedded SeaweedFS to `4.18` in CI and Docker builds.
`4.19` introduced intermittent `InternalError` responses on S3 `PutObject` in our upload flow.
:::

## 1. Start the Docker container

<Tabs groupId="docker-start-mode">
<TabItem value="localhost" label="Localhost" default>

Persistent storage, embedded SeaweedFS `weed mini`, optional auth, optional library mount:

```bash
docker run --name openreader \
  --restart unless-stopped \
  -p 3003:3003 \
  -p 8333:8333 \
  -v openreader_docstore:/app/docstore \
  -v /path/to/your/library:/app/docstore/library:ro \
  -e API_BASE=http://host.docker.internal:8880/v1 \
  -e API_KEY=none \
  -e BASE_URL=http://localhost:3003 \
  -e AUTH_SECRET=$(openssl rand -hex 32) \
  ghcr.io/richardr1126/openreader:latest
```

What this command enables:

- `-p 3003:3003`: exposes the OpenReader web app/API.
- `-p 8333:8333`: exposes embedded SeaweedFS S3 endpoint for direct browser presigned upload/download.
- `-v openreader_docstore:/app/docstore`: persists SQLite metadata, SeaweedFS blob data, and migration/runtime state.
- `-v /path/to/your/library:/app/docstore/library:ro`: mounts a read-only importable library source.
- `-e API_BASE=...`: sets the server-side default TTS endpoint OpenReader calls.
- `-e API_KEY=...`: sets the server-side default TTS API key (`none` is fine for local backends that do not require auth).
- `-e BASE_URL=...` and `-e AUTH_SECRET=...`: together they turn on auth/session mode for local sign-in flows.

</TabItem>
<TabItem value="local-network" label="LAN Host">

Use this when the app should be reachable from other devices on your LAN:

```bash
docker run --name openreader \
  --restart unless-stopped \
  -p 3003:3003 \
  -p 8333:8333 \
  -v openreader_docstore:/app/docstore \
  -e API_BASE=http://host.docker.internal:8880/v1 \
  -e BASE_URL=http://<YOUR_LAN_IP>:3003 \
  -e AUTH_SECRET=$(openssl rand -hex 32) \
  -e AUTH_TRUSTED_ORIGINS=http://localhost:3003,http://127.0.0.1:3003 \
  -e USE_ANONYMOUS_AUTH_SESSIONS=true \
  ghcr.io/richardr1126/openreader:latest
```

Replace `YOUR_LAN_IP` with the Docker host IP address on your local network to allow access from other devices.

What this command enables:

- LAN access from phones/tablets/other computers via `http://<YOUR_LAN_IP>:3003`.
- `BASE_URL` points auth/session cookies and callbacks at your LAN URL.
- `AUTH_TRUSTED_ORIGINS` allows localhost loopback origins in addition to your primary LAN origin.
- `USE_ANONYMOUS_AUTH_SESSIONS=true` allows guest sessions while auth is enabled.
- `API_BASE` still sets the default server-side TTS endpoint.
- `openreader_docstore` volume keeps data persistent across restarts.

</TabItem>
<TabItem value="minimal" label="Minimal">

Auth disabled, embedded storage ephemeral, no library import:

```bash
docker run --name openreader \
  --restart unless-stopped \
  -p 3003:3003 \
  -p 8333:8333 \
  ghcr.io/richardr1126/openreader:latest
```

What this command enables:

- Fastest startup with no extra env vars.
- No persistent volume (`/app/docstore` stays container-local), so data is ephemeral unless you add a mount.
- Auth remains disabled because `BASE_URL` and `AUTH_SECRET` are not set.
- TTS endpoint/key are not preset server-side (`API_BASE`/`API_KEY` not set), so configure provider settings in the app UI.

</TabItem>
</Tabs>

:::tip Quick Tips
- Set `API_BASE` to a TTS endpoint the container can reach (`host.docker.internal` works for host-local services).
- Auth is enabled only when both `BASE_URL` and `AUTH_SECRET` are set.
- Use a `/app/docstore` mount if you want data to survive container/image replacement.
- Startup automatically runs DB/storage migrations via the shared entrypoint.
:::

:::warning Port `8333` Exposure
Expose `8333` for direct browser presigned upload/download with embedded SeaweedFS.

If `8333` is not reachable from the browser, direct presigned access is unavailable. Uploads can still fall back to `/api/documents/blob/upload/fallback`, and document reads/downloads continue through `/api/documents/blob`.
:::

## 2. Configure settings in the app UI

Visit [http://localhost:3003](http://localhost:3003) after startup.

- Set TTS provider and model in Settings
- Set TTS API base URL and API key if needed
- Select the model voice from the voice dropdown

## 3. Update Docker image

Legacy image compatibility: `ghcr.io/richardr1126/openreader-webui:latest` remains available as an alias.

```bash
docker stop openreader || true && \
docker rm openreader || true && \
docker image rm ghcr.io/richardr1126/openreader:latest || true && \
docker pull ghcr.io/richardr1126/openreader:latest
```

:::tip
If you use a mounted volume for `/app/docstore`, your persisted data remains after image updates.
:::

:::info Related Docs
- [Environment Variables](./reference/environment-variables)
- [Auth](./configure/auth)
- [Database](./configure/database)
- [Object / Blob Storage](./configure/object-blob-storage)
- [Migrations](./configure/migrations)
:::
