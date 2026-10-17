export function shouldExitWithoutWeb({ authorized, windowVisible, autoStart, pet }) {
  return !authorized && !windowVisible && !autoStart && !pet;
}

export async function stopBeforeExit({ runtime, stopMonitoring, exit, timeoutMs = 6000 }) {
  runtime?.stop();
  const cleanup = stopMonitoring?.();
  let timer;
  try {
    await Promise.race([
      Promise.allSettled([runtime?.whenIdle(), cleanup]),
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); timer.unref?.(); }),
    ]);
  } finally { clearTimeout(timer); exit(); }
}
