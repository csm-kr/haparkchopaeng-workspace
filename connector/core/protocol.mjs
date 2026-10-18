/** Keep desktop requests separate from stored credentials: the server schemas are strict. */
export function desktopAckInput(launch, identity) {
  return { attemptId: launch.attemptId, launchToken: launch.launchToken, deviceToken: identity.deviceToken, deviceName: identity.deviceName, platform: identity.platform };
}

export function desktopPairInput(launch, identity, code) {
  return { attemptId: launch.attemptId, launchToken: launch.launchToken, deviceToken: identity.deviceToken, code };
}
