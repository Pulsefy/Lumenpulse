import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Shim global jest to vitest vi
(globalThis as any).jest = vi;

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Next.js Google Fonts
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'font-inter', className: 'font-inter' }),
  Orbitron: () => ({ variable: 'font-orbitron', className: 'font-orbitron' }),
  Space_Mono: () => ({ variable: 'font-space-mono', className: 'font-space-mono' }),
  Chakra_Petch: () => ({ variable: 'font-chakra', className: 'font-chakra' }),
  Poppins: () => ({ variable: 'font-poppins', className: 'font-poppins' }),
}));

// Mock ResizeObserver for jsdom environment
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock matchMedia for jsdom environment
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

