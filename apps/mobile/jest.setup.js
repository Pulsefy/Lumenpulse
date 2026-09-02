// Jest setup file for additional configuration

// Mock expo-constants
jest.mock('expo-constants', () => ({
  expoConfig: {
    name: 'Lumenpulse',
    version: '1.0.0',
    extra: {
      backendUrl: 'http://localhost:3000',
    },
  },
}));

// Setup any global mocks or configurations here
global.console = {
  ...console,
  // Suppress console errors/warnings during tests if needed
  // error: jest.fn(),
  // warn: jest.fn(),
};
