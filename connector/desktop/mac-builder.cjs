// Mac-only native identity. Runtime metadata and the existing credential profile keep the Korean product name.
const { build, productName } = require('./package.json');
const nativeName = build.mac.executableName;
if (!/^[a-z][a-z0-9-]{2,99}$/.test(nativeName)) throw new Error('The Mac native executable name must be explicit ASCII.');
module.exports = {
  ...build,
  productName: nativeName,
  extraMetadata: { ...build.extraMetadata, productName },
  mac: { ...build.mac, extendInfo: { ...build.mac.extendInfo, CFBundleDisplayName: productName } },
};
