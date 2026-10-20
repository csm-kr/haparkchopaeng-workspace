// Mac-only native identity. Runtime metadata and the existing credential profile keep the Korean product name.
const { build, productName } = require('./package.json');
const nativeName = build.mac.executableName;
// Builder names the bundle, executable and Helpers after this; ASCII avoids the earlier Korean-name Helper launch failure.
if (!/^[A-Za-z][A-Za-z0-9-]*(?: [A-Za-z0-9-]+)*$/.test(nativeName) || nativeName.length > 100) throw new Error('The Mac native executable name must be explicit ASCII.');
module.exports = {
  ...build,
  productName: nativeName,
  extraMetadata: { ...build.extraMetadata, productName },
  mac: { ...build.mac, extendInfo: { ...build.mac.extendInfo, CFBundleDisplayName: productName } },
};
