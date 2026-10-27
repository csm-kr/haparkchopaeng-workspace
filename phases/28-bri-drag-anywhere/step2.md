# Step 2: release-0-1-15

Follow `docs/dev/LOCAL_AGENT_RELEASE.md` and the 0.1.14 order only after the user approves publication. There is no web or protocol change, but the merge commit's Production deployment must be Ready first.

1. Merge the PR after its CI passes. Tag the merge commit `ai-bridge-v0.1.15-preview.1` and create a draft prerelease targeting it.
2. Run `local-agent.yml` with `--ref` that tag (`upload_artifacts=true`), then `ai-bridge-preview.yml` for Mac arm64 and Ubuntu x64. Upload the Windows installer from the same tag CI with its metadata JSON. If an Ubuntu job is cancelled while `apt-get` downloads packages, rerun only that job.
3. Match every metadata JSON to GitHub's size and SHA256, publish the prerelease, and re-download anonymously.
4. Validate the new catalogue with `readLocalAgentReleases`, overwrite only Production `LOCAL_AGENT_RELEASES`, redeploy, and read the logged-in downloads API back.

```bash
gh release view ai-bridge-v0.1.15-preview.1 --json isPrerelease,isDraft,assets
```

Do not overwrite existing assets or record signing, notarization or real-user verification.
