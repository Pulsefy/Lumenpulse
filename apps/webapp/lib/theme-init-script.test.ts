/**
 * Unit tests for theme initialization script
 * 
 * These tests verify that the theme initialization script correctly reads
 * preferences, detects system themes, and applies the theme attribute.
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.1
 */

import { getThemeInitScript, getThemeInitScriptHTML } from './theme-init-script';

describe('Theme Initialization Script', () => {
  describe('getThemeInitScript', () => {
    it('should return a non-empty string', () => {
      const script = getThemeInitScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('should contain the storage key constant', () => {
      const script = getThemeInitScript();
      expect(script).toContain('lumenpulse-theme-preference');
    });

    it('should contain the theme attribute constant', () => {
      const script = getThemeInitScript();
      expect(script).toContain('data-theme');
    });

    it('should contain the media query for system theme detection', () => {
      const script = getThemeInitScript();
      expect(script).toContain('prefers-color-scheme: dark');
    });

    it('should contain localStorage access code', () => {
      const script = getThemeInitScript();
      expect(script).toContain('localStorage.getItem');
    });

    it('should contain setAttribute call for applying theme', () => {
      const script = getThemeInitScript();
      expect(script).toContain('setAttribute');
    });

    it('should contain error handling', () => {
      const script = getThemeInitScript();
      expect(script).toContain('try');
      expect(script).toContain('catch');
    });

    it('should validate theme preference values', () => {
      const script = getThemeInitScript();
      expect(script).toContain("'light'");
      expect(script).toContain("'dark'");
      expect(script).toContain("'system'");
    });

    it('should use an IIFE (Immediately Invoked Function Expression)', () => {
      const script = getThemeInitScript();
      expect(script).toMatch(/\(function\(\)/);
      expect(script).toMatch(/\}\)\(\)/);
    });

    it('should be compact for performance (under 2KB)', () => {
      const script = getThemeInitScript();
      // Requirement 9.5: Script must execute within 50ms
      // Keeping script size small helps meet this requirement
      expect(script.length).toBeLessThan(2000);
    });
  });

  describe('getThemeInitScriptHTML', () => {
    it('should return an object with __html property', () => {
      const result = getThemeInitScriptHTML();
      expect(result).toHaveProperty('__html');
      expect(typeof result.__html).toBe('string');
    });

    it('should return the same content as getThemeInitScript', () => {
      const script = getThemeInitScript();
      const html = getThemeInitScriptHTML();
      expect(html.__html).toBe(script);
    });
  });

  describe('Script execution simulation', () => {
    let originalLocalStorage: Storage;
    let originalMatchMedia: typeof window.matchMedia;
    let mockDocumentElement: { setAttribute: jest.Mock };

    beforeEach(() => {
      // Save originals
      originalLocalStorage = global.localStorage;
      originalMatchMedia = window.matchMedia;

      // Mock document.documentElement
      mockDocumentElement = {
        setAttribute: jest.fn(),
      };
      Object.defineProperty(document, 'documentElement', {
        value: mockDocumentElement,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      // Restore originals
      global.localStorage = originalLocalStorage;
      window.matchMedia = originalMatchMedia;
    });

    it('should apply light theme when preference is light', () => {
      // Mock localStorage
      const mockGetItem = jest.fn().mockReturnValue('light');
      Object.defineProperty(global, 'localStorage', {
        value: { getItem: mockGetItem },
        writable: true,
        configurable: true,
      });

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should apply dark theme when preference is dark', () => {
      // Mock localStorage
      const mockGetItem = jest.fn().mockReturnValue('dark');
      Object.defineProperty(global, 'localStorage', {
        value: { getItem: mockGetItem },
        writable: true,
        configurable: true,
      });

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should detect system theme when preference is system and system prefers dark', () => {
      // Mock localStorage
      const mockGetItem = jest.fn().mockReturnValue('system');
      Object.defineProperty(global, 'localStorage', {
        value: { getItem: mockGetItem },
        writable: true,
        configurable: true,
      });

      // Mock matchMedia to return dark preference
      window.matchMedia = jest.fn().mockReturnValue({
        matches: true,
      }) as any;

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify dark theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    it('should detect system theme when preference is system and system prefers light', () => {
      // Mock localStorage
      const mockGetItem = jest.fn().mockReturnValue('system');
      Object.defineProperty(global, 'localStorage', {
        value: { getItem: mockGetItem },
        writable: true,
        configurable: true,
      });

      // Mock matchMedia to return light preference
      window.matchMedia = jest.fn().mockReturnValue({
        matches: false,
      }) as any;

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify light theme was applied
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should default to system (then light) when no preference is stored', () => {
      // Mock localStorage with no stored value
      const mockGetItem = jest.fn().mockReturnValue(null);
      Object.defineProperty(global, 'localStorage', {
        value: { getItem: mockGetItem },
        writable: true,
        configurable: true,
      });

      // Mock matchMedia to return light preference
      window.matchMedia = jest.fn().mockReturnValue({
        matches: false,
      }) as any;

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify light theme was applied (system default)
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should default to system when invalid preference is stored', () => {
      // Mock localStorage with invalid value
      const mockGetItem = jest.fn().mockReturnValue('invalid-theme');
      Object.defineProperty(global, 'localStorage', {
        value: { getItem: mockGetItem },
        writable: true,
        configurable: true,
      });

      // Mock matchMedia to return light preference
      window.matchMedia = jest.fn().mockReturnValue({
        matches: false,
      }) as any;

      // Execute the script
      const script = getThemeInitScript();
      eval(script);

      // Verify light theme was applied (system default)
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw error
      const mockGetItem = jest.fn().mockImplementation(() => {
        throw new Error('Storage access denied');
      });
      Object.defineProperty(global, 'localStorage', {
        value: { getItem: mockGetItem },
        writable: true,
        configurable: true,
      });

      // Mock matchMedia
      window.matchMedia = jest.fn().mockReturnValue({
        matches: false,
      }) as any;

      // Execute the script - should not throw
      const script = getThemeInitScript();
      expect(() => eval(script)).not.toThrow();

      // Verify light theme was applied as fallback
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    it('should handle matchMedia errors gracefully', () => {
      // Mock localStorage
      const mockGetItem = jest.fn().mockReturnValue('system');
      Object.defineProperty(global, 'localStorage', {
        value: { getItem: mockGetItem },
        writable: true,
        configurable: true,
      });

      // Mock matchMedia to throw error
      window.matchMedia = jest.fn().mockImplementation(() => {
        throw new Error('matchMedia not supported');
      }) as any;

      // Execute the script - should not throw
      const script = getThemeInitScript();
      expect(() => eval(script)).not.toThrow();

      // Verify light theme was applied as fallback
      expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });
  });

  describe('Performance requirements', () => {
    it('should execute quickly (simulated timing check)', () => {
      // This is a basic check - actual performance testing would need to be done in a browser
      const script = getThemeInitScript();
      
      const startTime = performance.now();
      
      // Mock minimal environment
      const mockGetItem = jest.fn().mockReturnValue('light');
      Object.defineProperty(global, 'localStorage', {
        value: { getItem: mockGetItem },
        writable: true,
        configurable: true,
      });
      
      const mockDocElement = { setAttribute: jest.fn() };
      Object.defineProperty(document, 'documentElement', {
        value: mockDocElement,
        writable: true,
        configurable: true,
      });
      
      // Execute script
      eval(script);
      
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      
      // Requirement 9.5: Must execute within 50ms
      // In a test environment, this should be much faster
      expect(executionTime).toBeLessThan(50);
    });
  });
});
