# Step 3: release-publication

The user explicitly requested deployment after reviewing the ImageGen character and motion preview. Publish AI Bridge 0.1.11 using the existing unsigned prerelease channel.

1. Commit only the Bri implementation, assets, version metadata, tests and documentation. Push the source and create a unique exact-SHA release tag.
2. Run `local-agent.yml` by workflow_dispatch on that exact tag. All five configured jobs must pass; OS packages and native encryption/installation checks must use the same source.
3. Download the Windows CI installer and installation evidence, verify its source/version/hash, and upload it with curated metadata to a draft prerelease. Use `ai-bridge-preview.yml` for independently verified Mac arm64 and Ubuntu packages.
4. Read every staged asset's name, size, SHA256 and metadata. Publish the draft only after verification. Existing published assets are never overwritten.
5. Update only the production `LOCAL_AGENT_RELEASES` catalog with public verified 0.1.11 URLs. Redeploy the authorized source and confirm the production web deployment and download responses.

Record exact source, CI runs, release URL, binary hashes, production deployment and verification scope in `RELEASE.md`. Publisher signing/notarization are unchanged from the existing preview channel. Do not replace or delete the user's installed app or saved profiles as part of publication.
