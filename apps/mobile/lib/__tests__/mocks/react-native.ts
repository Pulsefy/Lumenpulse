export const DeviceEventEmitter = {
  emit: jest.fn(),
};

export const Platform = {
  OS: 'ios',
};

const ReactNative = {
  DeviceEventEmitter,
  Platform,
};

export default ReactNative;
