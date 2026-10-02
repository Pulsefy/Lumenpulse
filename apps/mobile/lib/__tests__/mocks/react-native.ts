export const DeviceEventEmitter = {
  emit: jest.fn(),
};

export const Platform = {
  OS: 'ios',
};

export const Share = {
  share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
  dismissedAction: 'dismissedAction',
  sharedAction: 'sharedAction',
};

export const Alert = {
  alert: jest.fn(),
};

export const AppState = {
  currentState: 'active',
  addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
};

export const StyleSheet = {
  create: (styles: any) => styles,
  hairlineWidth: 1,
};

const ReactNative = {
  DeviceEventEmitter,
  Platform,
  Share,
  Alert,
  AppState,
  StyleSheet,
};

export default ReactNative;

