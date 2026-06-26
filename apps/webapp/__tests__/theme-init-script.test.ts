/**
 * Tests for theme initialization script
 * 
 * These tests verify that the theme initialization script correctly:
 * - Reads theme preference from localStorage
 * - Detects system theme when preference is 'system'
 * - Applies the correct theme attribute to the document element
 * - Executes quickly to prevent FOUC
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getThemeInitScript, getThemeInitScriptHTML } from '@/lib/theme-init-script';

describe('Theme Initialization Script', () => {
  describe('getThemeInitScript', () => {
    it('should return a non-empty string', () => {
      const script = getThemeInitScript();
      expect(script).toBeTruthy();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should contain localStorage access code', () => {
      const script = getThemeInitScript();
      expect(script).toContain('localStorage');
      expect(script).toContain('getItem');
    });

    it('should contain system theme detection code', () => {
      const script = getThemeInitScript();
      expect(script).toContain('prefers-color-scheme');
      expect(script).toContain('matchMedia');
    });

    it('should contain document attribute setting code', () => {
      const script = getThemeInitScript();
      expect(script).toContain('document.documentElement');
      expect(script).toContain('setAttribute');
      expect(script).toContain('data-theme');
    });

    it('should contain error handling', () => {
      const script = getThemeInitScript();
      expect(script).toContain('try');
      expect(script).toContain('catch');
    });

    it('should be wrapped in an IIFE for immediate execution', () => {
      const script = getThemeInitScript();
      expect(script).toMatch(/^\(function\(\)/);
      expect(script).toContain('})();');
    });
  });

  describe('getThemeInitScriptHTML', () => {
    it('should return an object with __html property', () => {
      const result = getThemeInitScriptHTML();
      expect(result).toHaveProperty('__html');
      expect(typeof result.__html).toBe('string');
    });

    it('should contain the same content as getThemeInitScript', () => {
      const script = getThemeInitScript();
      const html = getThemeInitScriptHTML();
      expect(html.__html).toBe(script);
    });
  });

  describe('Script Execution Simulation', () => {
    let mockLocalStorage: { [key: string]: string };
    let mockMatchMedia: any;
    let mockDocumentElement: any;

    beforeEach(() => {
      // Reset mocks
      mockLocalStorage = {};
      mockDocumentElement = {
        setAttribute: vi.fn(),
      };

      // Mock localStorage
      global.localStorage = {
        getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          mockLocalStorage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete mockLocalStorage[key];
        }),
        clear: vi.fn(() => {
          mockLocalStorage = {};
        }),
        key: vi.fn(),
        length: 0,
      };

      // Mock matchMedia
      mockMatchMedia = vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      global.window = { matchMedia: mockMatchMedia } as any;

      // Mock document
      global.document = {
        documentElement: mockDocumentElement,
      } as any;
    });

    it('should apply light theme when no preference is stored and system is light', () => {
      // No stored preference
      mockLocalStorage = {};
      
      // System prefers light
      mockMatchMedia.mockReturnValue({ matches: false });

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify light theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should apply dark theme when no preference is stored and system is dark', () => {
      // No stored preference
      mockLocalStorage = {};
      
      // System prefers dark
      mockMatchMedia.mockReturnValue({ matches: true });

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify dark theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should apply stored light preference', () => {
      // Stored preference is light
      mockLocalStorage['lumenpulse-theme-preference'] = 'light';

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify light theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should apply stored dark preference', () => {
      // Stored preference is dark
      mockLocalStorage['lumenpulse-theme-preference'] = 'dark';

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify dark theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should detect system theme when preference is system and system is dark', () => {
      // Stored preference is system
      mockLocalStorage['lumenpulse-theme-preference'] = 'system';
      
      // System prefers dark
      mockMatchMedia.mockReturnValue({ matches: true });

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify dark theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should detect system theme when preference is system and system is light', () => {
      // Stored preference is system
      mockLocalStorage['lumenpulse-theme-preference'] = 'system';
      
      // System prefers light
      mockMatchMedia.mockReturnValue({ matches: false });

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify light theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should default to system (light) when stored preference is invalid', () => {
      // Invalid stored preference
      mockLocalStorage['lumenpulse-theme-preference'] = 'invalid-value';
      
      // System prefers light
      mockMatchMedia.mockReturnValue({ matches: false });

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify light theme was applied (system default)
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw error
      global.localStorage.getItem = vi.fn(() => {
        throw new Error('Storage access denied');
      });
      
      // System prefers light
      mockMatchMedia.mockReturnValue({ matches: false });

      // Execute the script - should not throw
      const script = getThemeInitScript();
      expect(() => eval(script)).not.toThrow();

      // Verify light theme was applied as fallback
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should handle matchMedia errors gracefully', () => {
      // Stored preference is system
      mockLocalStorage['lumenpulse-theme-preference'] = 'system';
      
      // Mock matchMedia to throw error
      global.window.matchMedia = vi.fn(() => {
        throw new Error('matchMedia not supported');
      });

      // Execute the script - should not throw
      const script = getThemeInitScript();
      expect(() => eval(script)).not.toThrow();

      // Verify light theme was applied as fallback
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });
  });

  describe('Performance Requirements', () => {
    it('should be compact enough to execute quickly (Requirement 9.5: <50ms)', () => {
      const script = getThemeInitScript();
      
      // Script should be reasonably small (under 2KB for fast parsing)
      expect(script.length).toBeLessThan(2000);
      
      // Script should not contain complex operations
      expect(script).not.toContain('setTimeout');
      expect(script).not.toContain('setInterval');
      expect(script).not.toContain('Promise');
      expect(script).not.toContain('async');
      expect(script).not.toContain('await');
    });

    it('should execute synchronously without delays', () => {
      const script = getThemeInitScript();
      
      // Verify no asynchronous operations
      expect(script).not.toContain('setTimeout');
      expect(script).not.toContain('requestAnimationFrame');
      expect(script).not.toContain('Promise');
    });
  });
});
