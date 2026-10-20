import { basename, dirname, join } from 'node:path';

// Before the rename the Mac bundle was hapark-connector.app. It shares this bundle ID and URL scheme, so a leftover
// copy (some were rejected as damaged) could still be opened for hapark-connect:// links.
export const legacyMacBundleName = 'hapark-connector.app';
export const macBundleId = 'kr.hapark.connector';

/** Moves pre-rename copies to the Trash once the renamed app runs installed in an Applications folder. */
export async function retireLegacyMacBundles({ platform, packaged, execPath, home, lstat, readBundleId, unregister, trash }) {
  if (platform !== 'darwin' || !packaged) return [];
  const folders = ['/Applications', join(home, 'Applications')];
  const bundle = dirname(dirname(dirname(execPath)));
  // From the DMG or a translocated download the user would be left without an installed app.
  if (!bundle.endsWith('.app') || basename(bundle) === legacyMacBundleName || !folders.includes(dirname(bundle))) return [];
  const retired = [];
  for (const folder of folders) {
    const legacy = join(folder, legacyMacBundleName);
    try {
      if (!(await lstat(legacy)).isDirectory() || await readBundleId(legacy) !== macBundleId) continue;
      await unregister(legacy);
      await trash(legacy);
      retired.push(legacy);
    } catch { /* Best effort: a leftover copy must never block startup. */ }
  }
  return retired;
}
