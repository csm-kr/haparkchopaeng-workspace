export const BRI_PRESENTATIONS = Object.freeze({
  idle: { label: '쉬는 중', accessibleLabel: '천천히 쉬고 있는 브리' },
  connecting: { label: '연결 중', accessibleLabel: '웹 연결을 기다리는 브리' },
  ready: { label: '준비됐어요', accessibleLabel: '연결되어 작업을 기다리는 브리' },
  working: { label: '일하는 중', accessibleLabel: '집중해서 일하는 브리' },
  recovering: { label: '연결 확인 중', accessibleLabel: '연결 복구를 기다리는 브리' },
  disconnected: { label: '다시 연결', accessibleLabel: '웹에서 다시 연결해 주기를 기다리는 브리' },
  error: { label: '연결 확인', accessibleLabel: '연결에 도움이 필요한 브리' },
});

export function selectBriMode({ stage, runtime }) {
  if (stage === 'authorization_required') return 'disconnected';
  if (stage === 'error') return 'error';
  if (stage === 'opening' || stage === 'pairing') return 'connecting';
  if (stage !== 'connected') return 'idle';
  if (!runtime) return 'connecting';
  if (runtime.status === 'recovering') return 'recovering';
  if (runtime.status !== 'connected') return 'disconnected';
  return runtime.currentJobId ? 'working' : 'ready';
}
