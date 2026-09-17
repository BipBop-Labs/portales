# Decision: indexed artifact descriptors and a private destination policy

- Date: 2026-09-17
- Status: accepted

## Context

Downloads returned a path, media type, byte count and checksum, but nothing tied them to the business, account, document type or run. Downstream jobs picked "the newest XLSX" from a shared directory, and BipBop and Becuadro outputs could collide. Moving a file into an organization directory was a manual copy, checksum and delete.

## Decision

Every download returns a complete `ArtifactDescriptor` (`artifactId`, run, service, profile, operation, identifiers, document type, extraction time, covered period when verifiable, byte count, media type, SHA-256, validation checks, private path) and is indexed under `$XDG_DATA_HOME/portales/artifacts/index/`. `portales artifacts list|latest|show|verify` are the only supported way to find a file. Placement is decided by `resolveDestination`: an explicit private `--output` directory outside any repository, a `--destination` alias from the private config `$XDG_CONFIG_HOME/portales/destinations.json`, or the default tree isolated by service, profile, document type and every selected identifier. Publication is atomic and never overwrites.

## Alternatives

- Keep the per-service download directory and let callers sort it out: rejected, that is the manual step being eliminated.
- Store organization aliases in the repository: rejected; they identify clients.
- Move the file after the fact with a separate command: rejected; the verified bytes should land once.

## Consequences

Services must call `validateDownloadedFile`, then `recordArtifact`, then publish. Covered period is `null` where the portal does not expose one and the docs say so. Verification (`artifacts verify`) re-hashes the file and never reads it into a result.
