# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses semantic
versioning. Releases before 2.2.0 are recorded in the
[GitHub Releases](https://github.com/Ringosystems/Homey-Wan-Kenobi-MCP/releases)
and tags.

## [2.2.0]

### Added
- **Zero-build deploy:** `docker-compose.deploy.yml` runs the prebuilt, multi-arch
  GHCR image with no clone or local build
  (`docker compose -f docker-compose.deploy.yml up -d`), keeping the same container
  hardening as `docker-compose.yml`.
- **Unraid template:** `deploy/unraid/homey-wan-kenobi.xml`, a Community
  Applications template installable by URL or submittable at
  https://ca.unraid.net/submit, plus a repository `ca_profile.xml`.
- **PUBLISHING.md:** full release runbook (workflows, one-time setup, verification,
  CA submission, troubleshooting), linked from the README.
- README "Fastest: one command" deploy section using the published image.
