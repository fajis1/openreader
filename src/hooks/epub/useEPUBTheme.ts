import { useCallback, useEffect } from 'react';
import { Rendition } from 'epubjs';
import { ReactReaderStyle, IReactReaderStyle } from 'react-reader';

// Returns ReactReader styles, with:
// - default look when epubTheme === false (except hiding built-in arrows)
// - themed colors + layout tweaks when epubTheme === true
export const getThemeStyles = (epubTheme: boolean): IReactReaderStyle => {
  const baseStyle = ReactReaderStyle;

  // Always hide the built-in prev/next arrow buttons so we can
  // provide our own navigation controls outside the reader.
  if (!epubTheme) {
    return {
      ...baseStyle,
      reader: {
        ...baseStyle.reader,
        // Always tighten the inset a bit for better use of space
        top: 8,
        left: 8,
        right: 8,
        bottom: 8,
      },
      prev: {
        ...baseStyle.prev,
        display: 'none',
        pointerEvents: 'none',
      },
      next: {
        ...baseStyle.next,
        display: 'none',
        pointerEvents: 'none',
      },
      titleArea: {
        ...baseStyle.titleArea,
        display: 'none',
      },
    };
  }

  const colors = {
    background: getComputedStyle(document.documentElement).getPropertyValue('--background'),
    foreground: getComputedStyle(document.documentElement).getPropertyValue('--foreground'),
    base: getComputedStyle(document.documentElement).getPropertyValue('--base'),
    offbase: getComputedStyle(document.documentElement).getPropertyValue('--offbase'),
    muted: getComputedStyle(document.documentElement).getPropertyValue('--muted'),
  };

  return {
    ...baseStyle,
    reader: {
      ...baseStyle.reader,
      // Reduce the large default inset (50px 50px 20px)
      // so the EPUB content can use more of the available area.
      top: 8,
      left: 8,
      right: 8,
      bottom: 8,
    },
    prev: {
      ...baseStyle.prev,
      display: 'none',
      pointerEvents: 'none',
    },
    next: {
      ...baseStyle.next,
      display: 'none',
      pointerEvents: 'none',
    },
    arrow: {
      ...baseStyle.arrow,
      color: colors.foreground,
    },
    arrowHover: {
      ...baseStyle.arrowHover,
      color: colors.muted,
    },
    readerArea: {
      ...baseStyle.readerArea,
      backgroundColor: colors.base,
      height: '100%',
    },
    titleArea: {
      ...baseStyle.titleArea,
      color: colors.foreground,
      display: 'none',
    },
    tocArea: {
      ...baseStyle.tocArea,
      background: colors.base,
    },
    tocButtonExpanded: {
      ...baseStyle.tocButtonExpanded,
      background: colors.offbase,
    },
    tocButtonBar: {
      ...baseStyle.tocButtonBar,
      background: colors.muted,
    },
    tocButton: {
      ...baseStyle.tocButton,
      color: colors.muted,
      // Ensure the TOC toggle sits above the swipe wrapper
      // and text iframe, avoiding z-index conflicts.
      zIndex: 300,
    },
    tocAreaButton: {
      ...baseStyle.tocAreaButton,
      color: colors.muted,
      backgroundColor: colors.offbase,
      padding: '0.25rem',
      paddingLeft: '0.5rem',
      paddingRight: '0.5rem',
      marginBottom: '0.25rem',
      borderRadius: '0.25rem',
      borderColor: 'transparent',
    },
  };
};

export const useEPUBTheme = (epubTheme: boolean, rendition: Rendition | undefined) => {
  const updateTheme = useCallback(() => {
    if (!epubTheme || !rendition) return;
    const maybeBook = (rendition as unknown as { book?: { isOpen?: boolean } }).book;
    if (!maybeBook?.isOpen) return;

    const colors = {
      foreground: getComputedStyle(document.documentElement).getPropertyValue('--foreground'),
      base: getComputedStyle(document.documentElement).getPropertyValue('--base'),
    };

    try {
      // Register theme rules instead of using override
      rendition.themes.registerRules('theme-light', {
        'body': {
          'color': colors.foreground,
          'background-color': colors.base
        }
      });

      // Select the theme to apply it
      rendition.themes.select('theme-light');
    } catch (error) {
      console.warn('Failed to apply EPUB theme rules:', error);
    }
  }, [epubTheme, rendition]);

  // Watch for theme changes
  useEffect(() => {
    if (!epubTheme || !rendition) return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          updateTheme();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, [epubTheme, rendition, updateTheme]);

  // Watch for epubTheme changes
  useEffect(() => {
    if (!epubTheme || !rendition) return;
    updateTheme();
  }, [epubTheme, rendition, updateTheme]);

  // Ensure theme is applied once the rendition has fully rendered/opened.
  useEffect(() => {
    if (!epubTheme || !rendition) return;
    const emitter = rendition as unknown as {
      on?: (event: string, callback: () => void) => void;
      off?: (event: string, callback: () => void) => void;
    };
    if (!emitter.on) return;

    const handleRendered = () => {
      updateTheme();
    };
    emitter.on('rendered', handleRendered);
    return () => {
      emitter.off?.('rendered', handleRendered);
    };
  }, [epubTheme, rendition, updateTheme]);

  return { updateTheme };
};
