/**
 * Tests for RootLayout component
 * 
 * Validates Requirements 9.1, 9.2, 9.3 - Theme initialization script injection
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RootLayout from './layout';
import { getThemeInitScript } from '@/lib/theme-init-script';

describe('RootLayout - Theme Script Injection', () => {
  /**
   * Requirement 9.1: Theme script must be present in head
   * Requirement 9.3: Script must be inline (not external)
   */
  it('should inject inline theme initialization script in head', () => {
    const { container } = render(
      <RootLayout>
        <div>Test content</div>
      </RootLayout>
    );

    // Find the html element
    const html = container.querySelector('html');
    expect(html).toBeTruthy();

    // Find the head element
    const head = html?.querySelector('head');
    expect(head).toBeTruthy();

    // Find the script tag
    const scripts = head?.querySelectorAll('script');
    expect(scripts).toBeTruthy();
    expect(scripts!.length).toBeGreaterThan(0);

    // Verify the first script is our theme initialization script
    const themeScript = scripts![0];
    expect(themeScript).toBeTruthy();
    
    // Verify it's inline (has content, not src attribute)
    expect(themeScript.hasAttribute('src')).toBe(false);
    expect(themeScript.innerHTML).toBeTruthy();
    expect(themeScript.innerHTML.length).toBeGreaterThan(0);
  });

  /**
   * Requirement 9.2: Script must execute before other content
   * Verifies script is the first element in head
   */
  it('should place theme script before other head content', () => {
    const { container } = render(
      <RootLayout>
        <div>Test content</div>
      </RootLayout>
    );

    const head = container.querySelector('head');
    expect(head).toBeTruthy();

    // Get all children of head
    const headChildren = Array.from(head!.children);
    expect(headChildren.length).toBeGreaterThan(0);

    // First child should be a script tag
    const firstChild = headChildren[0];
    expect(firstChild.tagName.toLowerCase()).toBe('script');
    
    // Verify it contains theme initialization code
    expect(firstChild.innerHTML).toContain('lumenpulse-theme-preference');
    expect(firstChild.innerHTML).toContain('data-theme');
  });

  /**
   * Requirement 9.3: Script content must match the theme-init-script module
   */
  it('should contain correct theme initialization logic', () => {
    const { container } = render(
      <RootLayout>
        <div>Test content</div>
      </RootLayout>
    );

    const head = container.querySelector('head');
    const script = head?.querySelector('script');
    
    expect(script).toBeTruthy();
    
    const scriptContent = script!.innerHTML;
    const expectedContent = getThemeInitScript();
    
    // Verify key parts of the script are present
    expect(scriptContent).toContain('lumenpulse-theme-preference');
    expect(scriptContent).toContain('data-theme');
    expect(scriptContent).toContain('prefers-color-scheme: dark');
    expect(scriptContent).toContain('localStorage.getItem');
    expect(scriptContent).toContain('document.documentElement.setAttribute');
    
    // Verify the script matches the expected output
    expect(scriptContent.trim()).toBe(expectedContent);
  });

  /**
   * Validates that script handles all three theme preferences
   */
  it('should handle light, dark, and system preferences in script', () => {
    const { container } = render(
      <RootLayout>
        <div>Test content</div>
      </RootLayout>
    );

    const script = container.querySelector('head script');
    const scriptContent = script!.innerHTML;
    
    // Verify script checks for all three valid preferences
    expect(scriptContent).toContain("'light'");
    expect(scriptContent).toContain("'dark'");
    expect(scriptContent).toContain("'system'");
  });

  /**
   * Requirement 9.1, 9.2: Script must not be async or deferred
   * It must be a blocking script to execute immediately
   */
  it('should not have async or defer attributes', () => {
    const { container } = render(
      <RootLayout>
        <div>Test content</div>
      </RootLayout>
    );

    const script = container.querySelector('head script');
    
    expect(script).toBeTruthy();
    expect(script!.hasAttribute('async')).toBe(false);
    expect(script!.hasAttribute('defer')).toBe(false);
  });
});
