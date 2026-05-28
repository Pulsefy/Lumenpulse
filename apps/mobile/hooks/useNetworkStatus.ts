import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export function useNetworkStatus() {
  const [state, setState] = useState<NetInfoState | null>(null);

  useEffect(() => {
    const sub = NetInfo.addEventListener((s) => setState(s));
    // fetch initial state
    NetInfo.fetch().then((s) => setState(s));
    return () => sub();
  }, []);

  const isConnected = Boolean(state?.isConnected);
  const isInternetReachable = Boolean(state?.isInternetReachable);

  return {
    state,
    isConnected,
    isInternetReachable,
  };
}

export default useNetworkStatus;
