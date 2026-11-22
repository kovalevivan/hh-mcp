# ArtDent HH MCP deployment

The MCP runs on the existing ArtDent server in its own Compose project, attached
to Docker network `artdent-app`. LibreChat uses the internal gateway URL
`http://artdent-tools-gateway:8080/headhunter/mcp`. Host port 3400 binds to
loopback only. The shared employer account is managed through
`https://admin.artdent-ai.ru/headhunter`; it is not connected separately by HR users.

## Persistent configuration

`deploy/.env` is private (mode 600) and contains `MCP_AUTH_TOKEN`, the independent
`HH_ADMIN_TOKEN`, `HH_CONFIG_KEY` (32 bytes, hex-encoded), `HH_ADMIN_REDIRECT_URI`
and `HH_MCP_REVISION`. The registered callback is
`https://admin.artdent-ai.ru/headhunter-callback`.

`deploy/state` is owned by uid/gid 1000, mode 700, and mounted at
`/home/node/.hh-mcp`. It retains OAuth tokens and encrypted application settings.
Back up `.env` and `state` together: credentials cannot be recovered without the
matching encryption key. Never include them in Git or deployment source archives.
The MCP key cannot use administrative endpoints.

## Update

1. Save a private backup of the current source, Compose, environment and state;
   record the current image tag for rollback.
2. Build the reviewed revision. Set only `HH_MCP_REVISION` in the existing `.env`.
   Preserve credentials, encryption keys, gateway routing and state mounts.
3. From `deploy`, validate with `docker compose config --quiet` and run
   `docker compose up -d --no-deps --wait hh-mcp` after building the image.
   Do not restart LibreChat, databases or the gateway.
4. Check `/health` and authenticated `tools/list`: version 0.2.0 exposes 12 tools.
   Run the MCP smoke test with `MCP_URL` and `MCP_TOKEN_FILE` pointing to private
   configuration. Live verification uses GET-only HH calls.
5. Reinitialize the `headhunter` MCP connection in LibreChat to refresh the tool
   catalog. Preserve resource ACLs: authorized HR users retain their shared access.

For a fresh build use the repository Dockerfile and `docker compose build hh-mcp`.
A bundle-only update may copy the verified `dist/bundle.cjs` onto the exact
currently deployed runtime image, then tag it with the new Git revision. This
retains the pinned Node runtime while avoiding an application-wide rebuild.

## Chat permissions

Bind `hh_chats_mcp_headhunter`, `hh_chat_start_mcp_headhunter` and
`hh_chat_send_mcp_headhunter` to the recruitment agent. Preserve its existing
resume tools, instructions and ACLs. Add the two write tools to the host's
`endpoints.agents.toolApproval.ask` policy; see the root README for the example.
Preserve any existing policy instead of replacing it.

Verify that a send call pauses with the recipient and text visible and that
rejecting it performs no HH write. Never send a real candidate a test message.
An empty HH chat list is a valid result. HH authorization or tariff errors must
remain explicit failures, never be presented as successful delivery.

## Rollback

Restore the recorded image tag in `HH_MCP_REVISION` and recreate only `hh-mcp`.
Restore the previous recruitment-agent tools and instructions if necessary.
Do not roll back established OAuth state or remove the matching encryption key.

## Checks

Run `npx tsc --noEmit`, `node --import tsx --test scripts/*.test.mjs`,
`npm run build:bundle` and `node scripts/smoke.mjs` against a local HTTP process
with an isolated temporary HH data directory and a random MCP bearer token.
