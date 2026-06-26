/**
 * Theme initialization script for preventing FOUC (Flash of Unstyled Content)
 * 
 * This script must execute synchronously before React hydration to ensure
 * the correct theme is applied immediately on page load. It is designed to be
 * inlined in the HTML head section as a blocking script.
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 * 
 * Performance requirement: Must execute within 50ms (Requirement 9.5)
 */

/**
 * Generates the inline script content for theme initialization
 * 
 * This function returns a string containing the JavaScript code that will be
 * executed inline in the HTML head. The script is optimized for minimal size
 * and maximum performance.
 * 
 * @returns {string} The JavaScript code to be inlined
 */
export function getThemeInitScript(): string {
  // Note: This script is intentionally written in a compact, optimized way
  // to minimize execution time and meet the 50ms requirement (9.5)
  
  return `
(function() {
  try {
    // Constants (inlined for performance)
    var STORAGE_KEY = 'lumenpulse-theme-preference';
    var THEME_ATTRIBUTE = 'data-theme';
    var MEDIA_QUERY = '(prefers-color-scheme: dark)';
    
    // Requirement 9.1: Read theme preference from localStorage before React hydration
    var preference = null;
    try {
      preference = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      // Storage access failed, will use default
    }
    
    // Validate preference value
    if (preference !== 'light' && preference !== 'dark' && preference !== 'system') {
      preference = 'system'; // Default to system if invalid or missing
    }
    
    var resolvedTheme = 'light'; // Default fallback
    
    // Requirement 9.2: Detect system theme if preference is 'system'
    if (preference === 'system') {
      // Requirement 2.1, 2.3: Use prefers-color-scheme media query
      if (window.matchMedia && window.matchMedia(MEDIA_QUERY).matches) {
        resolvedTheme = 'dark';
      } else {
        resolvedTheme = 'light';
      }
    } else {
      // Use explicit preference
      resolvedTheme = preference;
    }
    
    // Requirement 9.3: Apply data-theme attribute to document element immediately
    // Requirement 9.4: Ensure script executes before first render
    document.documentElement.setAttribute(THEME_ATTRIBUTE, resolvedTheme);
    
  } catch (error) {
    // Requirement 10.1: If theme detection fails, default to light theme
    // Fail silently to prevent blocking page load
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();
}

/**
 * Generates the inline script as a React-safe string for dangerouslySetInnerHTML
 * 
 * This is a convenience function for use in Next.js layouts where the script
 * needs to be injected using dangerouslySetInnerHTML.
 * 
 * @returns {object} Object with __html property containing the script
 */
export function getThemeInitScriptHTML(): { __html: string } {
  return { __html: getThemeInitScript() };
}
