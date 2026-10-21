module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/lib'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  globals: {
    __DEV__: true,
  },
  collectCoverageFrom: [
    'lib/**/*.ts',
    '!lib/**/*.d.ts',
    '!lib/**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 26,
      functions: 24,
      lines: 25,
      statements: 25,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^expo-background-task$': '<rootDir>/lib/__tests__/mocks/expo-background-task.ts',
    '^expo-battery$': '<rootDir>/lib/__tests__/mocks/expo-battery.ts',
    '^expo-constants$': '<rootDir>/lib/__tests__/mocks/expo-constants.ts',
    '^expo-image$': '<rootDir>/lib/__tests__/mocks/expo-image.ts',
    '^expo-linking$': '<rootDir>/lib/__tests__/mocks/expo-linking.ts',
    '^expo-local-authentication$': '<rootDir>/lib/__tests__/mocks/expo-local-authentication.ts',
    '^expo-modules-core$': '<rootDir>/lib/__tests__/mocks/expo-modules-core.ts',
    '^expo-task-manager$': '<rootDir>/lib/__tests__/mocks/expo-task-manager.ts',
    '^expo-secure-store$': '<rootDir>/lib/__tests__/mocks/expo-secure-store.ts',
    '^@react-native-community/netinfo$': '<rootDir>/lib/__tests__/mocks/netinfo.ts',
    '^react-native$': '<rootDir>/lib/__tests__/mocks/react-native.ts',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  setupFilesAfterEnv: [],
};
