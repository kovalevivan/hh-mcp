# ArtDent deployment

This fork runs beside Harly on its existing Docker network. Its own Compose
project does not restart Harly or PostgreSQL. Caddy exposes the MCP at
`https://hr.artdent-ai.ru/hh/mcp` and health at `/hh/health`.

The upstream authentication state is shared by this process: this deployment
is for one trusted employer account. Each client supplies the same private
Bearer key. Without HH credentials only public HH methods are available.

The fork also updates the MCP SDK and dependency lockfile to patched versions,
including Zod 4. Record schemas retain arbitrary HH query/body keys with explicit
string keys; `scripts/schema.test.mjs` covers these payloads and the paid-resume
confirmation guard.

## Install

Clone `https://github.com/kovalevivan/hh-mcp.git` into `/opt/hh-mcp` and check out
the commit being deployed. Copy `.env.example` to `.env` inside `deploy`, set
`HH_MCP_REVISION` to that commit and `MCP_AUTH_TOKEN` to a random key. Keep the
environment file private (`chmod 600`). Create `deploy/tokens` owned by uid/gid
1000 with mode 700; this writable mount retains HH tokens across restarts.

Run from `deploy`:

```sh
docker compose config --quiet
docker compose up -d --build --wait
```

Inside the existing `{$HARLY_DOMAIN}` Caddy site, wrap the application proxy in
a fallback handle and add the MCP route before it:

```caddyfile
handle_path /hh/* {
  reverse_proxy hh-mcp:3400 {
    flush_interval -1
  }
}
handle {
  reverse_proxy app:3000
}
```

Back up the active Caddyfile, validate it, then reload Caddy. Keep the existing
root redirect, security headers and old-domain redirect. Port 3400 is bound
only to loopback; the HTTPS proxy supplies external access.

## Verify and connect

```sh
MCP_URL=https://hr.artdent-ai.ru/hh/mcp \
MCP_TOKEN_FILE=/path/to/private-token HH_SMOKE_LIVE=1 node scripts/smoke.mjs
```

Client configuration (substitute the private token locally):

```json
{
  "mcpServers": {
    "headhunter": {
      "type": "streamable-http",
      "url": "https://hr.artdent-ai.ru/hh/mcp",
      "headers": { "Authorization": "Bearer YOUR_PRIVATE_MCP_TOKEN" }
    }
  }
}
```

Add `HH_CLIENT_ID`, `HH_CLIENT_SECRET` and the registered `HH_REDIRECT_URI` to
`deploy/.env` for employer access, then recreate this service. Use `hh_auth`
to obtain the authorization URL and exchange the returned code. Copy only the
code parameter from the callback URL; no callback handler is installed here.
The token mount must be included in private backups and must never enter Git.

For an update or rollback, check out the desired commit, set
`HH_MCP_REVISION` accordingly and repeat `docker compose up -d --build --wait`.
This preserves the environment file and token directory. To remove only MCP,
remove its Caddy handles, validate/reload, then run `docker compose down` in
this directory. Keep `deploy/tokens` if the HH session should be retained.
