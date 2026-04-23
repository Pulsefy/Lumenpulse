"use client";

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/contexts/theme-context';
import { ThemePreference } from '@/types/theme';
import { cn } from '@/lib/utils';
import { useRef, KeyboardEvent, useEffect } from 'react';

/**
 * Props for the ThemeSelector component
 * 
 * Requirements: 8.1, 8.2, 8.3
 */
export interface ThemeSelectorProps {
  /** Display variant for the theme selector */
  variant?: 'dropdown' | 'radio' | 'segmented';
  
  /** Whether to show text labels alongside icons */
  showLabels?: boolean;
  
  /** Additional CSS classes for custom styling */
  className?: string;
}

/**
 * Theme option configuration
 */
interface ThemeOption {
  value: ThemePreference;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  ariaLabel: string;
}

/**
 * Available theme options with icons and labels
 */
const themeOptions: ThemeOption[] = [
  {
    value: 'light',
    label: 'Light',
    icon: Sun,
    ariaLabel: 'Switch to light theme',
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: Moon,
    ariaLabel: 'Switch to dark theme',
  },
  {
    value: 'system',
    label: 'System',
    icon: Monitor,
    ariaLabel: 'Use system theme preference',
  },
];

/**
 * ThemeSelector Component
 * 
 * Provides a user interface for selecting theme preferences with three options:
 * light, dark, and system. Supports multiple display variants and custom styling.
 * 
 * Accessibility features (Requirements 7.5, 8.1):
 * - Full keyboard navigation with arrow keys, Enter, Space, Home, and End
 * - ARIA labels and roles for screen readers
 * - Visible focus indicators in both light and dark themes
 * - Proper aria-checked/aria-selected attributes
 * - Roving tabindex for optimal keyboard navigation
 * 
 * @param props - Component props
 * @returns Theme selector UI component
 * 
 * @example
 * ```tsx
 * // Dropdown variant
 * <ThemeSelector variant="dropdown" showLabels />
 * 
 * // Segmented control variant
 * <ThemeSelector variant="segmented" />
 * 
 * // Radio button variant
 * <ThemeSelector variant="radio" showLabels />
 * ```
 * 
 * Requirements: 8.1, 8.2, 8.3, 7.5
 */
export function ThemeSelector({
  variant = 'dropdown',
  showLabels = false,
  className,
}: ThemeSelectorProps) {
  const { preference, setTheme } = useTheme();
  const radioGroupRef = useRef<HTMLDivElement>(null);
  const segmentedGroupRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleThemeChange = (theme: ThemePreference) => {
    setTheme(theme);
  };

  /**
   * Focus management for keyboard navigation
   * Ensures the selected option receives focus after keyboard navigation
   * 
   * Requirements: 7.5 - Keyboard navigation and accessibility
   */
  useEffect(() => {
    if (variant === 'segmented') {
      const selectedButton = buttonRefs.current.get(preference);
      if (selectedButton && document.activeElement?.closest('[role="tablist"]')) {
        selectedButton.focus();
      }
    }
  }, [preference, variant]);

  /**
   * Handle keyboard navigation for radio and segmented variants
   * Implements arrow key navigation, Enter, and Space key support
   * Follows ARIA best practices for keyboard interaction
   * 
   * Requirements: 7.5 - Keyboard navigation and accessibility
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLElement>, currentValue: ThemePreference) => {
    const currentIndex = themeOptions.findIndex(opt => opt.value === currentValue);
    let nextIndex = currentIndex;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        nextIndex = (currentIndex + 1) % themeOptions.length;
        handleThemeChange(themeOptions[nextIndex].value);
        // Focus will be managed by useEffect
        break;
      
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        nextIndex = (currentIndex - 1 + themeOptions.length) % themeOptions.length;
        handleThemeChange(themeOptions[nextIndex].value);
        // Focus will be managed by useEffect
        break;
      
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleThemeChange(currentValue);
        break;
      
      case 'Home':
        e.preventDefault();
        handleThemeChange(themeOptions[0].value);
        break;
      
      case 'End':
        e.preventDefault();
        handleThemeChange(themeOptions[themeOptions.length - 1].value);
        break;
    }
  };

  // Render dropdown variant
  if (variant === 'dropdown') {
    return (
      <div className={cn('relative inline-block', className)}>
        <label htmlFor="theme-selector" className="sr-only">
          Select theme preference
        </label>
        <select
          id="theme-selector"
          value={preference}
          onChange={(e) => handleThemeChange(e.target.value as ThemePreference)}
          className={cn(
            'appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8',
            'text-sm font-medium text-foreground',
            'hover:bg-accent hover:text-accent-foreground',
            // Enhanced focus indicator for accessibility (Requirements 7.5)
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
            'transition-colors cursor-pointer'
          )}
          aria-label="Select theme preference"
        >
          {themeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <svg
            className="h-4 w-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
    );
  }

  // Render radio variant
  if (variant === 'radio') {
    return (
      <div
        ref={radioGroupRef}
        className={cn('flex flex-col gap-2', className)}
        role="radiogroup"
        aria-label="Theme preference selection"
      >
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const isSelected = preference === option.value;

          return (
            <label
              key={option.value}
              className={cn(
                'flex items-center gap-3 rounded-md border border-input px-4 py-3',
                'cursor-pointer transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                // Enhanced focus indicator for accessibility (Requirements 7.5)
                'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
                isSelected && 'border-primary bg-accent'
              )}
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={isSelected}
                onChange={() => handleThemeChange(option.value)}
                onKeyDown={(e) => handleKeyDown(e, option.value)}
                className="sr-only"
                aria-label={option.ariaLabel}
                aria-checked={isSelected}
              />
              <div
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full border-2',
                  isSelected
                    ? 'border-primary'
                    : 'border-muted-foreground'
                )}
                aria-hidden="true"
              >
                {isSelected && (
                  <div className="h-2 w-2 rounded-full bg-primary" />
                )}
              </div>
              <Icon className="h-5 w-5" aria-hidden="true" />
              {showLabels && (
                <span className="text-sm font-medium">{option.label}</span>
              )}
            </label>
          );
        })}
      </div>
    );
  }

  // Render segmented variant (default)
  return (
    <div
      ref={segmentedGroupRef}
      className={cn(
        'inline-flex items-center rounded-md border border-input bg-background p-1',
        className
      )}
      role="tablist"
      aria-label="Theme preference selection"
    >
      {themeOptions.map((option) => {
        const Icon = option.icon;
        const isSelected = preference === option.value;

        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) {
                buttonRefs.current.set(option.value, el);
              } else {
                buttonRefs.current.delete(option.value);
              }
            }}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-label={option.ariaLabel}
            aria-controls={`theme-panel-${option.value}`}
            onClick={() => handleThemeChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, option.value)}
            // Roving tabindex for optimal keyboard navigation (Requirements 7.5)
            tabIndex={isSelected ? 0 : -1}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded px-3 py-2',
              'text-sm font-medium transition-colors',
              // Enhanced focus indicator for accessibility (Requirements 7.5)
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
              // Ensure focus ring is visible in both themes
              'focus-visible:ring-2 focus-visible:ring-ring',
              isSelected
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {showLabels && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
