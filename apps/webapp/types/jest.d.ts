import { vi } from 'vitest';
import '@testing-library/jest-dom';

declare global {
  const jest: typeof vi;
}

declare module 'vitest' {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
