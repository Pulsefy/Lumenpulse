import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeSelector } from './theme-selector';
import { useTheme } from '@/contexts/theme-context';
import { ThemePreference } from '@/types/theme';

// Mock the useTheme hook
vi.mock('@/contexts/theme-context', () => ({
  useTheme: vi.fn(),
}));

describe('ThemeSelector', () => {
  const mockSetTheme = vi.fn();
  const mockUseTheme = useTheme as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTheme.mockReturnValue({
      theme: 'light' as const,
      preference: 'light' as ThemePreference,
      systemTheme: 'light' as const,
      setTheme: mockSetTheme,
      enableTransitions: true,
    });
  });

  describe('Dropdown Variant', () => {
    it('should render dropdown with all three theme options', () => {
      render(<ThemeSelector variant="dropdown" />);
      
      const select = screen.getByRole('combobox', { name: /select theme preference/i });
      expect(select).toBeInTheDocument();
      
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(3);
      expect(options[0]).toHaveTextContent('Light');
      expect(options[1]).toHaveTextContent('Dark');
      expect(options[2]).toHaveTextContent('System');
    });

    it('should show current preference as selected', () => {
      mockUseTheme.mockReturnValue({
        theme: 'dark' as const,
        preference: 'dark' as ThemePreference,
        systemTheme: 'dark' as const,
        setTheme: mockSetTheme,
        enableTransitions: true,
      });

      render(<ThemeSelector variant="dropdown" />);
      
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('dark');
    });

    it('should call setTheme when option is selected', () => {
      render(<ThemeSelector variant="dropdown" />);
      
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'dark' } });
      
      expect(mockSetTheme).toHaveBeenCalledWith('dark');
      expect(mockSetTheme).toHaveBeenCalledTimes(1);
    });

    it('should apply custom className', () => {
      const { container } = render(
        <ThemeSelector variant="dropdown" className="custom-class" />
      );
      
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('custom-class');
    });
  });

  describe('Radio Variant', () => {
    it('should render radio buttons with all three theme options', () => {
      render(<ThemeSelector variant="radio" />);
      
      const radioGroup = screen.getByRole('radiogroup', { name: /theme preference/i });
      expect(radioGroup).toBeInTheDocument();
      
      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(3);
    });

    it('should show labels when showLabels is true', () => {
      render(<ThemeSelector variant="radio" showLabels />);
      
      expect(screen.getByText('Light')).toBeInTheDocument();
      expect(screen.getByText('Dark')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
    });

    it('should not show labels when showLabels is false', () => {
      render(<ThemeSelector variant="radio" showLabels={false} />);
      
      expect(screen.queryByText('Light')).not.toBeInTheDocument();
      expect(screen.queryByText('Dark')).not.toBeInTheDocument();
      expect(screen.queryByText('System')).not.toBeInTheDocument();
    });

    it('should mark current preference as checked', () => {
      mockUseTheme.mockReturnValue({
        theme: 'system' as const,
        preference: 'system' as ThemePreference,
        systemTheme: 'light' as const,
        setTheme: mockSetTheme,
        enableTransitions: true,
      });

      render(<ThemeSelector variant="radio" />);
      
      const radios = screen.getAllByRole('radio') as HTMLInputElement[];
      expect(radios[0].checked).toBe(false); // light
      expect(radios[1].checked).toBe(false); // dark
      expect(radios[2].checked).toBe(true);  // system
    });

    it('should call setTheme when radio is clicked', () => {
      render(<ThemeSelector variant="radio" />);
      
      const darkRadio = screen.getByLabelText(/switch to dark theme/i);
      fireEvent.click(darkRadio);
      
      expect(mockSetTheme).toHaveBeenCalledWith('dark');
    });

    it('should have proper ARIA labels', () => {
      render(<ThemeSelector variant="radio" />);
      
      expect(screen.getByLabelText('Switch to light theme')).toBeInTheDocument();
      expect(screen.getByLabelText('Switch to dark theme')).toBeInTheDocument();
      expect(screen.getByLabelText('Use system theme preference')).toBeInTheDocument();
    });
  });

  describe('Segmented Variant', () => {
    it('should render segmented control with all three theme options', () => {
      render(<ThemeSelector variant="segmented" />);
      
      const tablist = screen.getByRole('tablist', { name: /theme preference/i });
      expect(tablist).toBeInTheDocument();
      
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
    });

    it('should show labels when showLabels is true', () => {
      render(<ThemeSelector variant="segmented" showLabels />);
      
      expect(screen.getByText('Light')).toBeInTheDocument();
      expect(screen.getByText('Dark')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
    });

    it('should mark current preference as selected', () => {
      mockUseTheme.mockReturnValue({
        theme: 'dark' as const,
        preference: 'dark' as ThemePreference,
        systemTheme: 'dark' as const,
        setTheme: mockSetTheme,
        enableTransitions: true,
      });

      render(<ThemeSelector variant="segmented" />);
      
      const tabs = screen.getAllByRole('tab');
      expect(tabs[0]).toHaveAttribute('aria-selected', 'false'); // light
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true');  // dark
      expect(tabs[2]).toHaveAttribute('aria-selected', 'false'); // system
    });

    it('should call setTheme when tab is clicked', () => {
      render(<ThemeSelector variant="segmented" />);
      
      const systemTab = screen.getByLabelText(/use system theme preference/i);
      fireEvent.click(systemTab);
      
      expect(mockSetTheme).toHaveBeenCalledWith('system');
    });

    it('should have proper ARIA attributes', () => {
      render(<ThemeSelector variant="segmented" />);
      
      const tabs = screen.getAllByRole('tab');
      tabs.forEach((tab) => {
        expect(tab).toHaveAttribute('aria-selected');
        expect(tab).toHaveAttribute('aria-label');
      });
    });
  });

  describe('Default Behavior', () => {
    it('should default to segmented variant when no variant is specified', () => {
      render(<ThemeSelector />);
      
      const tablist = screen.getByRole('tablist');
      expect(tablist).toBeInTheDocument();
    });

    it('should default to showLabels=false when not specified', () => {
      render(<ThemeSelector variant="segmented" />);
      
      expect(screen.queryByText('Light')).not.toBeInTheDocument();
      expect(screen.queryByText('Dark')).not.toBeInTheDocument();
      expect(screen.queryByText('System')).not.toBeInTheDocument();
    });
  });

  describe('Icons', () => {
    it('should render icons for all theme options in segmented variant', () => {
      const { container } = render(<ThemeSelector variant="segmented" />);
      
      // Check that SVG icons are rendered (lucide-react renders SVGs)
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThanOrEqual(3);
    });

    it('should render icons for all theme options in radio variant', () => {
      const { container } = render(<ThemeSelector variant="radio" />);
      
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid theme changes', () => {
      render(<ThemeSelector variant="segmented" />);
      
      const lightTab = screen.getByLabelText(/switch to light theme/i);
      const darkTab = screen.getByLabelText(/switch to dark theme/i);
      const systemTab = screen.getByLabelText(/use system theme preference/i);
      
      fireEvent.click(lightTab);
      fireEvent.click(darkTab);
      fireEvent.click(systemTab);
      
      expect(mockSetTheme).toHaveBeenCalledTimes(3);
      expect(mockSetTheme).toHaveBeenNthCalledWith(1, 'light');
      expect(mockSetTheme).toHaveBeenNthCalledWith(2, 'dark');
      expect(mockSetTheme).toHaveBeenNthCalledWith(3, 'system');
    });

    it('should handle clicking the same theme multiple times', () => {
      render(<ThemeSelector variant="segmented" />);
      
      const lightTab = screen.getByLabelText(/switch to light theme/i);
      
      fireEvent.click(lightTab);
      fireEvent.click(lightTab);
      fireEvent.click(lightTab);
      
      expect(mockSetTheme).toHaveBeenCalledTimes(3);
      expect(mockSetTheme).toHaveBeenCalledWith('light');
    });
  });

  describe('Accessibility - Keyboard Navigation', () => {
    describe('Segmented Variant', () => {
      it('should navigate to next option with ArrowRight', () => {
        render(<ThemeSelector variant="segmented" />);
        
        const lightTab = screen.getByLabelText(/switch to light theme/i);
        lightTab.focus();
        
        fireEvent.keyDown(lightTab, { key: 'ArrowRight' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('dark');
      });

      it('should navigate to previous option with ArrowLeft', () => {
        mockUseTheme.mockReturnValue({
          theme: 'dark' as const,
          preference: 'dark' as ThemePreference,
          systemTheme: 'dark' as const,
          setTheme: mockSetTheme,
          enableTransitions: true,
        });

        render(<ThemeSelector variant="segmented" />);
        
        const darkTab = screen.getByLabelText(/switch to dark theme/i);
        darkTab.focus();
        
        fireEvent.keyDown(darkTab, { key: 'ArrowLeft' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('light');
      });

      it('should navigate to next option with ArrowDown', () => {
        render(<ThemeSelector variant="segmented" />);
        
        const lightTab = screen.getByLabelText(/switch to light theme/i);
        lightTab.focus();
        
        fireEvent.keyDown(lightTab, { key: 'ArrowDown' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('dark');
      });

      it('should navigate to previous option with ArrowUp', () => {
        mockUseTheme.mockReturnValue({
          theme: 'dark' as const,
          preference: 'dark' as ThemePreference,
          systemTheme: 'dark' as const,
          setTheme: mockSetTheme,
          enableTransitions: true,
        });

        render(<ThemeSelector variant="segmented" />);
        
        const darkTab = screen.getByLabelText(/switch to dark theme/i);
        darkTab.focus();
        
        fireEvent.keyDown(darkTab, { key: 'ArrowUp' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('light');
      });

      it('should wrap around when navigating past last option', () => {
        mockUseTheme.mockReturnValue({
          theme: 'system' as const,
          preference: 'system' as ThemePreference,
          systemTheme: 'light' as const,
          setTheme: mockSetTheme,
          enableTransitions: true,
        });

        render(<ThemeSelector variant="segmented" />);
        
        const systemTab = screen.getByLabelText(/use system theme preference/i);
        systemTab.focus();
        
        fireEvent.keyDown(systemTab, { key: 'ArrowRight' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('light');
      });

      it('should wrap around when navigating before first option', () => {
        render(<ThemeSelector variant="segmented" />);
        
        const lightTab = screen.getByLabelText(/switch to light theme/i);
        lightTab.focus();
        
        fireEvent.keyDown(lightTab, { key: 'ArrowLeft' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('system');
      });

      it('should activate option with Enter key', () => {
        render(<ThemeSelector variant="segmented" />);
        
        const darkTab = screen.getByLabelText(/switch to dark theme/i);
        darkTab.focus();
        
        fireEvent.keyDown(darkTab, { key: 'Enter' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('dark');
      });

      it('should activate option with Space key', () => {
        render(<ThemeSelector variant="segmented" />);
        
        const darkTab = screen.getByLabelText(/switch to dark theme/i);
        darkTab.focus();
        
        fireEvent.keyDown(darkTab, { key: ' ' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('dark');
      });

      it('should jump to first option with Home key', () => {
        mockUseTheme.mockReturnValue({
          theme: 'system' as const,
          preference: 'system' as ThemePreference,
          systemTheme: 'light' as const,
          setTheme: mockSetTheme,
          enableTransitions: true,
        });

        render(<ThemeSelector variant="segmented" />);
        
        const systemTab = screen.getByLabelText(/use system theme preference/i);
        systemTab.focus();
        
        fireEvent.keyDown(systemTab, { key: 'Home' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('light');
      });

      it('should jump to last option with End key', () => {
        render(<ThemeSelector variant="segmented" />);
        
        const lightTab = screen.getByLabelText(/switch to light theme/i);
        lightTab.focus();
        
        fireEvent.keyDown(lightTab, { key: 'End' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('system');
      });

      it('should implement roving tabindex - only selected tab is tabbable', () => {
        mockUseTheme.mockReturnValue({
          theme: 'dark' as const,
          preference: 'dark' as ThemePreference,
          systemTheme: 'dark' as const,
          setTheme: mockSetTheme,
          enableTransitions: true,
        });

        render(<ThemeSelector variant="segmented" />);
        
        const tabs = screen.getAllByRole('tab');
        expect(tabs[0]).toHaveAttribute('tabIndex', '-1'); // light
        expect(tabs[1]).toHaveAttribute('tabIndex', '0');  // dark (selected)
        expect(tabs[2]).toHaveAttribute('tabIndex', '-1'); // system
      });
    });

    describe('Radio Variant', () => {
      it('should navigate to next option with ArrowRight', () => {
        render(<ThemeSelector variant="radio" />);
        
        const lightRadio = screen.getByLabelText(/switch to light theme/i);
        lightRadio.focus();
        
        fireEvent.keyDown(lightRadio, { key: 'ArrowRight' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('dark');
      });

      it('should navigate to previous option with ArrowLeft', () => {
        mockUseTheme.mockReturnValue({
          theme: 'dark' as const,
          preference: 'dark' as ThemePreference,
          systemTheme: 'dark' as const,
          setTheme: mockSetTheme,
          enableTransitions: true,
        });

        render(<ThemeSelector variant="radio" />);
        
        const darkRadio = screen.getByLabelText(/switch to dark theme/i);
        darkRadio.focus();
        
        fireEvent.keyDown(darkRadio, { key: 'ArrowLeft' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('light');
      });

      it('should activate option with Space key', () => {
        render(<ThemeSelector variant="radio" />);
        
        const darkRadio = screen.getByLabelText(/switch to dark theme/i);
        darkRadio.focus();
        
        fireEvent.keyDown(darkRadio, { key: ' ' });
        
        expect(mockSetTheme).toHaveBeenCalledWith('dark');
      });

      it('should have proper aria-checked attributes', () => {
        mockUseTheme.mockReturnValue({
          theme: 'dark' as const,
          preference: 'dark' as ThemePreference,
          systemTheme: 'dark' as const,
          setTheme: mockSetTheme,
          enableTransitions: true,
        });

        render(<ThemeSelector variant="radio" />);
        
        const radios = screen.getAllByRole('radio');
        expect(radios[0]).toHaveAttribute('aria-checked', 'false'); // light
        expect(radios[1]).toHaveAttribute('aria-checked', 'true');  // dark
        expect(radios[2]).toHaveAttribute('aria-checked', 'false'); // system
      });
    });

    describe('Dropdown Variant', () => {
      it('should have accessible label for screen readers', () => {
        render(<ThemeSelector variant="dropdown" />);
        
        const select = screen.getByLabelText(/select theme preference/i);
        expect(select).toBeInTheDocument();
        expect(select).toHaveAttribute('id', 'theme-selector');
      });

      it('should have visible focus indicator', () => {
        const { container } = render(<ThemeSelector variant="dropdown" />);
        
        const select = screen.getByRole('combobox');
        expect(select).toHaveClass('focus:ring-2', 'focus:ring-ring');
      });
    });
  });

  describe('Accessibility - Focus Indicators', () => {
    it('should have visible focus indicators on segmented buttons', () => {
      render(<ThemeSelector variant="segmented" />);
      
      const tabs = screen.getAllByRole('tab');
      tabs.forEach((tab) => {
        expect(tab).toHaveClass('focus:ring-2', 'focus:ring-ring');
      });
    });

    it('should have visible focus indicators on radio labels', () => {
      const { container } = render(<ThemeSelector variant="radio" />);
      
      const labels = container.querySelectorAll('label');
      labels.forEach((label) => {
        expect(label).toHaveClass('focus-within:ring-2', 'focus-within:ring-ring');
      });
    });

    it('should have visible focus indicators on dropdown', () => {
      render(<ThemeSelector variant="dropdown" />);
      
      const select = screen.getByRole('combobox');
      expect(select).toHaveClass('focus:ring-2', 'focus:ring-ring');
    });
  });

  describe('Accessibility - ARIA Attributes', () => {
    it('should have proper aria-selected on segmented tabs', () => {
      mockUseTheme.mockReturnValue({
        theme: 'dark' as const,
        preference: 'dark' as ThemePreference,
        systemTheme: 'dark' as const,
        setTheme: mockSetTheme,
        enableTransitions: true,
      });

      render(<ThemeSelector variant="segmented" />);
      
      const tabs = screen.getAllByRole('tab');
      expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
      expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
    });

    it('should have aria-controls on segmented tabs', () => {
      render(<ThemeSelector variant="segmented" />);
      
      const lightTab = screen.getByLabelText(/switch to light theme/i);
      const darkTab = screen.getByLabelText(/switch to dark theme/i);
      const systemTab = screen.getByLabelText(/use system theme preference/i);
      
      expect(lightTab).toHaveAttribute('aria-controls', 'theme-panel-light');
      expect(darkTab).toHaveAttribute('aria-controls', 'theme-panel-dark');
      expect(systemTab).toHaveAttribute('aria-controls', 'theme-panel-system');
    });

    it('should have descriptive aria-label on all variants', () => {
      const { rerender } = render(<ThemeSelector variant="segmented" />);
      expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Theme preference selection');
      
      rerender(<ThemeSelector variant="radio" />);
      expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-label', 'Theme preference selection');
      
      rerender(<ThemeSelector variant="dropdown" />);
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-label', 'Select theme preference');
    });

    it('should mark decorative icons as aria-hidden', () => {
      const { container } = render(<ThemeSelector variant="segmented" />);
      
      const icons = container.querySelectorAll('svg[aria-hidden="true"]');
      expect(icons.length).toBeGreaterThanOrEqual(3);
    });
  });
});
