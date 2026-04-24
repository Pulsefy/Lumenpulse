import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ThemeContext, useTheme } from './theme-context';
import { ThemeContextValue } from '@/types/theme';

describe('ThemeContext', () => {
  describe('useTheme hook', () => {
    it('should throw error when used outside ThemeProvider', () => {
      // Expect the hook to throw an error when used without provider
      expect(() => {
        renderHook(() => useTheme());
      }).toThrow('useTheme must be used within a ThemeProvider');
    });

    it('should throw error with helpful message', () => {
      // Verify the error message is descriptive
      expect(() => {
        renderHook(() => useTheme());
      }).toThrow('Wrap your component tree with <ThemeProvider>');
    });

    it('should return context value when used within provider', () => {
      // Create a mock context value
      const mockContextValue: ThemeContextValue = {
        theme: 'light',
        preference: 'light',
        systemTheme: 'light',
        setTheme: () => {},
        enableTransitions: true,
      };

      // Render hook with provider
      const { result } = renderHook(() => useTheme(), {
        wrapper: ({ children }) => (
          <ThemeContext.Provider value={mockContextValue}>
            {children}
          </ThemeContext.Provider>
        ),
      });

      // Verify the hook returns the context value
      expect(result.current).toBe(mockContextValue);
      expect(result.current.theme).toBe('light');
      expect(result.current.preference).toBe('light');
      expect(result.current.systemTheme).toBe('light');
      expect(result.current.enableTransitions).toBe(true);
    });

    it('should provide access to setTheme function', () => {
      // Create a mock context value with a setTheme function
      const mockSetTheme = () => {};
      const mockContextValue: ThemeContextValue = {
        theme: 'dark',
        preference: 'dark',
        systemTheme: 'light',
        setTheme: mockSetTheme,
        enableTransitions: true,
      };

      // Render hook with provider
      const { result } = renderHook(() => useTheme(), {
        wrapper: ({ children }) => (
          <ThemeContext.Provider value={mockContextValue}>
            {children}
          </ThemeContext.Provider>
        ),
      });

      // Verify setTheme is accessible
      expect(result.current.setTheme).toBe(mockSetTheme);
    });

    it('should handle system theme preference', () => {
      // Create a mock context value with system preference
      const mockContextValue: ThemeContextValue = {
        theme: 'dark',
        preference: 'system',
        systemTheme: 'dark',
        setTheme: () => {},
        enableTransitions: true,
      };

      // Render hook with provider
      const { result } = renderHook(() => useTheme(), {
        wrapper: ({ children }) => (
          <ThemeContext.Provider value={mockContextValue}>
            {children}
          </ThemeContext.Provider>
        ),
      });

      // Verify system preference is handled correctly
      expect(result.current.preference).toBe('system');
      expect(result.current.theme).toBe('dark');
      expect(result.current.systemTheme).toBe('dark');
    });
  });
});
