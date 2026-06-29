# Security

This project is maintained by Steeves and Associates. The container image and
dependency tree are audited with [Trivy](https://trivy.dev/) and `npm audit`.

## Reporting a vulnerability

Please report security issues privately via a GitHub security advisory
(Security tab, "Report a vulnerability") rather than a public issue. We aim to
acknowledge reports within a few business days.

## Audit summary

Last full audit: 2026-06-28, Trivy 0.71.2.

Scope: npm dependency tree (`package-lock.json`), the container base image, and
the Dockerfile/compose configuration.

### Dependency vulnerabilities

The dependency tree was reduced from 20 advisories (11 high, 8 moderate, 1 low)
to 4 moderate by:

- Upgrading `@modelcontextprotocol/sdk` to `^1.29.0` and `homey-api` to `^3.19.1`.
- Applying non-breaking transitive fixes via `npm audit fix` (express/hono/ajv
  chain from the MCP SDK, and `form-data`, `ws`, `socket.io-parser`).
- Pinning `esbuild` to `^0.28.1` via an `overrides` entry (dev-only tooling).

The production image (`npm ci --omit=dev`) ships with 0 critical, 0 high, 0 low.

### Accepted residual risk

The 4 remaining moderate advisories all originate from `homey-api`'s legacy
realtime transport, which pins `socket.io-client@^2.5.0` and
`engine.io-client@^3.5.5`:

- `socket.io-client`, `engine.io-client`, `parseuri` (`CVE-2024-36751`).

These are accepted, not remediated, because:

1. This server uses request/response HTTP calls, not the realtime socket, so the
   vulnerable code paths are not exercised.
2. The only socket peer is the user's own trusted local Homey Pro on the LAN.
3. The upstream major versions cannot be forced without breaking Homey
   connectivity; npm's only offered "fix" is a destructive `homey-api` downgrade.

These are listed in [.trivyignore](.trivyignore) and will be re-evaluated when
`homey-api` adopts a socket.io-client v4+ release.

### Base image

The base image was changed from `node:20-slim` (Debian 12, 177 OS CVEs including
5 critical and 10 high) to `node:22-alpine` (6 CVEs, 0 critical). The build:

- Runs `apk upgrade --no-cache` to pick up the latest OS patches.
- Removes the bundled `npm` CLI from the runtime layer (not needed at runtime),
  which strips the vulnerabilities that ship inside it.

### Configuration hardening

Dockerfile misconfigurations reported by Trivy were all resolved:

- No secrets are baked into the image (`HOMEY_TOKEN`/`HOMEY_ADDRESS` are supplied
  only at runtime).
- The container runs as the unprivileged `node` user, never root.
- A `HEALTHCHECK` is defined.

The provided `docker-compose.yml` adds defense in depth: read-only root
filesystem, `no-new-privileges`, all Linux capabilities dropped, and memory/PID
limits.

## Reproducing the audit

```bash
# Dependency audit
npm audit

# Filesystem scan (dependencies, secrets, misconfiguration)
trivy fs --scanners vuln,secret,misconfig --skip-dirs dist .

# Dockerfile / compose misconfiguration
trivy config .

# Built image (CI builds and scans this on every release)
docker build -t homey-mcp .
trivy image --severity HIGH,CRITICAL homey-mcp
```
