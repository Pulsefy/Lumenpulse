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
    '^expo-constants$': '<rootDir>/lib/__tests__/mocks/expo-constants.ts',
    '^expo-image$': '<rootDir>/lib/__tests__/mocks/expo-image.ts',
    '^expo-linking$': '<rootDir>/lib/__tests__/mocks/expo-linking.ts',
    '^expo-local-authentication$': '<rootDir>/lib/__tests__/mocks/expo-local-authentication.ts',
    '^expo-modules-core$': '<rootDir>/lib/__tests__/mocks/expo-modules-core.ts',
    '^expo-secure-store$': '<rootDir>/lib/__tests__/mocks/expo-secure-store.ts',
    '^react-native$': '<rootDir>/lib/__tests__/mocks/react-native.ts',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  setupFilesAfterEnv: [],
};
