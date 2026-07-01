# Publishing and release guide

How Homey-Wan-Kenobi MCP is built, published, and deployed. This is the canonical
runbook for cutting a release. Independent project, not affiliated with Athom or
Homey.

## What gets published, and where

One version is published to three places, driven by the GitHub Actions workflows
in [.github/workflows/](.github/workflows/).

| Target | Identifier | Auth | Public |
|--------|------------|------|--------|
| Docker Hub | `docker.io/ringosystems/homey-wan-kenobi` | `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` secrets | Yes |
| GitHub Container Registry (GHCR) | `ghcr.io/ringosystems/homey-wan-kenobi` | `GITHUB_TOKEN` (automatic) | Yes |
| MCP Registry | `io.github.Ringosystems/homey-wan-kenobi-mcp` | GitHub OIDC (automatic) | Yes |

Every image is **multi-arch** (`linux/amd64` + `linux/arm64`, arm64 built under
QEMU emulation) and gated on a **Trivy** HIGH/CRITICAL scan before it is pushed.
Per-release tags come from [docker/metadata-action](https://github.com/docker/metadata-action):
the exact version (`2.2.0`), the `major.minor` (`2.2`), and `latest`.

The MCP Registry verifies image ownership against the
`io.modelcontextprotocol.server.name` label in the [Dockerfile](Dockerfile), which
must equal the `name` in [server.json](server.json)
(`io.github.Ringosystems/homey-wan-kenobi-mcp`).

## The workflows

### CI ([ci.yml](.github/workflows/ci.yml))
Runs on push/PR to `main`. Does not push images. Two jobs:
- **build**: matrix on Node 20 and 22, then `npm ci`, `lint`, `typecheck`, `build`.
- **security**: Trivy filesystem scan (vuln, secret, misconfig; HIGH/CRITICAL gate).

### Publish Docker image ([docker-publish.yml](.github/workflows/docker-publish.yml))
Triggers on a pushed `v*` tag, or manual dispatch. One `publish` job:
1. QEMU + Buildx, then `docker/metadata-action` computes tags and labels.
2. Builds a single-arch image and loads it, so **Trivy scans exactly what ships**.
   The scan gates on HIGH/CRITICAL (unfixed ignored, `.trivyignore` honoured).
3. Logs into Docker Hub and GHCR, then builds and pushes the **multi-arch** image
   to both (push only happens on a `v*` tag).
4. Syncs the Docker Hub repository overview from [DOCKERHUB.md](DOCKERHUB.md).

Note: unlike some setups, the Docker Hub login here is **not** best-effort. A
missing or expired `DOCKERHUB_TOKEN` fails the run, which also blocks the GHCR
push in the same job. Keep the token valid.

### Publish to MCP Registry ([publish-mcp-registry.yml](.github/workflows/publish-mcp-registry.yml))
Runs automatically after "Publish Docker image" completes successfully on a tag
push (via `workflow_run`), or on manual dispatch. It reads the version from
**`package.json`**, rewrites `server.json` (`version` + the OCI `identifier` tag)
to match, then authenticates with GitHub OIDC and publishes.

> Key gotcha: the image tags come from the **git tag**, but the MCP Registry entry
> reads the version from **`package.json`**. These must match. Always bump
> `package.json` to `X.Y.Z` in the commit you tag `vX.Y.Z`.

### Utilities
- [sync-dockerhub-description.yml](.github/workflows/sync-dockerhub-description.yml):
  manual re-sync of the Docker Hub overview from `DOCKERHUB.md`, without a release.
- [registry-status.yml](.github/workflows/registry-status.yml): manual utility to
  set an MCP Registry entry's status (active / deprecated / deleted), e.g. after a
  rename.

## One-time setup

1. **Docker Hub secrets (required).** Repo secrets `DOCKERHUB_USERNAME` and
   `DOCKERHUB_TOKEN` (a Docker Hub access token with Read/Write). Optional repo
   variable `DOCKERHUB_IMAGE` overrides the default `ringosystems/homey-wan-kenobi`.
2. **GHCR is public.** The first push publishes a private package; make it public
   once (GitHub Packages → `homey-wan-kenobi` → Package settings → Change
   visibility → Public). Verify with `docker buildx imagetools inspect
   ghcr.io/ringosystems/homey-wan-kenobi:latest` while logged out.
3. **MCP Registry.** No secret; GitHub OIDC. The `server.json` `name` owner casing
   must match the GitHub owner (`Ringosystems`) and equal the Dockerfile
   `io.modelcontextprotocol.server.name` label.

## Cutting a release

1. Bump `version` in [package.json](package.json) (source of truth for the MCP
   Registry entry) and keep [server.json](server.json) in sync.
2. Add a `## [X.Y.Z]` section to [CHANGELOG.md](CHANGELOG.md).
3. Commit on a branch, open a PR, let **CI** go green, and merge to `main`.
4. Tag and push:

   ```bash
   git tag v2.2.0
   git push origin v2.2.0
   ```

   The tag fires "Publish Docker image", and on success "Publish to MCP Registry"
   runs automatically.
5. Watch it: `gh run watch`. The multi-arch build is slower than CI due to arm64
   emulation.

## Verifying a release

```bash
# Multi-arch index with amd64 + arm64:
docker buildx imagetools inspect ghcr.io/ringosystems/homey-wan-kenobi:2.2.0

# MCP Registry entry:
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=homey-wan-kenobi" | python -m json.tool
```

## How consumers deploy

Full instructions are in the [README](README.md#self-hosted-docker--http). In short:

- **One-command HTTP service:** [docker-compose.deploy.yml](docker-compose.deploy.yml)
  pulls the published GHCR image, no clone or build. `docker compose -f
  docker-compose.deploy.yml up -d`. The `/mcp` endpoint is unauthenticated; keep it
  on a trusted LAN or behind an authenticating reverse proxy.
- **Unraid:** add [deploy/unraid/homey-wan-kenobi.xml](deploy/unraid/homey-wan-kenobi.xml)
  by raw URL, or submit it to Community Applications (below).
- **Single MCP client (stdio):** `docker run -i --rm -e HOMEY_ADDRESS=... -e
  HOMEY_TOKEN=... ghcr.io/ringosystems/homey-wan-kenobi:latest`.

## Unraid Community Applications submission

The Unraid template lives at
[deploy/unraid/homey-wan-kenobi.xml](deploy/unraid/homey-wan-kenobi.xml) and the
repository profile at [ca_profile.xml](ca_profile.xml).

- **Immediate (no approval):** users add the template by raw URL in Unraid, Docker,
  Add Container, Template field. This works as soon as the file is on `main`.
- **Get it into the CA store (searchable in the Apps tab):** submit the public repo
  at **https://ca.unraid.net/submit**. The portal live-scans the repo, parses the
  template XML, validates `ca_profile.xml`, checks for duplicates, and shows a
  preview before you submit. It is the source of truth for current requirements.
  After listing, keep the template working and respond to support in the forum
  thread.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Publish fails at the Trivy step | A HIGH/CRITICAL, fixable CVE is present. Update the dependency or base image, or add a justified entry to `.trivyignore`. |
| Publish fails at Docker Hub login | Missing or expired `DOCKERHUB_TOKEN`. Rotate it. This login is not best-effort, so it also blocks the GHCR push in the same job. |
| MCP Registry entry shows the wrong version | `package.json` version did not match the git tag. The registry reads `package.json`; re-tag with matching values, or dispatch "Publish to MCP Registry" after fixing. |
| arm64 build fails during `npm ci` | Rare for this pure-JS tree. Confirm no dependency added a native module without an arm64 prebuilt. |
| GHCR pull asks for auth | The package is still private; make it public (one-time setup). |

## Release checklist

- [ ] `package.json` `version` bumped
- [ ] `server.json` `version` and package `identifier` tag match
- [ ] `CHANGELOG.md` updated
- [ ] CI green on `main`
- [ ] Tag `vX.Y.Z` pushed (matches `package.json`)
- [ ] "Publish Docker image" succeeded (Trivy passed, both registries pushed)
- [ ] "Publish to MCP Registry" succeeded
- [ ] `docker buildx imagetools inspect` shows amd64 + arm64
