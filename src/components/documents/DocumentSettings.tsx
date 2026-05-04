'use client';

import { Fragment, useState, useEffect } from 'react';
import { Transition, Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import { useConfig, ViewType } from '@/contexts/ConfigContext';
import { ChevronUpDownIcon, CheckIcon } from '@/components/icons/Icons';
import { ReaderSidebarShell } from '@/components/reader/ReaderSidebarShell';

const canWordHighlight = process.env.NEXT_PUBLIC_ENABLE_WORD_HIGHLIGHT?.toLowerCase() !== 'false';

const viewTypeTextMapping = [
  { id: 'single', name: 'Single Page' },
  { id: 'dual', name: 'Two Pages' },
  { id: 'scroll', name: 'Continuous Scroll' },
];

export function DocumentSettings({ isOpen, setIsOpen, epub, html }: {
  isOpen: boolean,
  setIsOpen: (isOpen: boolean) => void,
  epub?: boolean,
  html?: boolean
}) {
  const {
    viewType,
    skipBlank,
    epubTheme,
    smartSentenceSplitting,
    headerMargin,
    footerMargin,
    leftMargin,
    rightMargin,
    updateConfigKey,
    pdfHighlightEnabled,
    epubHighlightEnabled,
    pdfWordHighlightEnabled,
    epubWordHighlightEnabled,
  } = useConfig();
  const [localMargins, setLocalMargins] = useState({
    header: headerMargin,
    footer: footerMargin,
    left: leftMargin,
    right: rightMargin
  });
  const selectedView = viewTypeTextMapping.find(v => v.id === viewType) || viewTypeTextMapping[0];

  useEffect(() => {
    setLocalMargins({
      header: headerMargin,
      footer: footerMargin,
      left: leftMargin,
      right: rightMargin
    });
  }, [headerMargin, footerMargin, leftMargin, rightMargin]);

  // Handler for slider change (updates local state only)
  const handleMarginChange = (margin: keyof typeof localMargins) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalMargins(prev => ({
      ...prev,
      [margin]: Number(event.target.value)
    }));
  };

  // Handler for slider release
  const handleMarginChangeComplete = (margin: keyof typeof localMargins) => () => {
    const value = localMargins[margin];
    const configKey = `${margin}Margin`;
    if (value !== (useConfig)[configKey as keyof typeof useConfig]) {
      updateConfigKey(configKey as 'headerMargin' | 'footerMargin' | 'leftMargin' | 'rightMargin', value);
    }
  };

  return (
    <ReaderSidebarShell
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      ariaLabel="Document settings"
      title="Settings"
    >
      <div className="space-y-4">
                    {!epub && !html && <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-foreground">
                          Text extraction margins
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {/* Header Margin */}
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-xs">Header</span>
                              <span className="text-xs font-bold">{Math.round(localMargins.header * 100)}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="0.2"
                              step="0.01"
                              value={localMargins.header}
                              onChange={handleMarginChange('header')}
                              onMouseUp={handleMarginChangeComplete('header')}
                              onKeyUp={handleMarginChangeComplete('header')}
                              onTouchEnd={handleMarginChangeComplete('header')}
                              className="w-full bg-offbase rounded-lg appearance-none cursor-pointer accent-accent [&::-webkit-slider-runnable-track]:bg-offbase [&::-webkit-slider-runnable-track]:rounded-lg [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-track]:bg-offbase [&::-moz-range-track]:rounded-lg [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent"
                            />
                          </div>

                          {/* Footer Margin */}
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-xs">Footer</span>
                              <span className="text-xs font-bold">{Math.round(localMargins.footer * 100)}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="0.2"
                              step="0.01"
                              value={localMargins.footer}
                              onChange={handleMarginChange('footer')}
                              onMouseUp={handleMarginChangeComplete('footer')}
                              onKeyUp={handleMarginChangeComplete('footer')}
                              onTouchEnd={handleMarginChangeComplete('footer')}
                              className="w-full bg-offbase rounded-lg appearance-none cursor-pointer accent-accent [&::-webkit-slider-runnable-track]:bg-offbase [&::-webkit-slider-runnable-track]:rounded-lg [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-track]:bg-offbase [&::-moz-range-track]:rounded-lg [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent"
                            />
                          </div>

                          {/* Left Margin */}
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-xs">Left</span>
                              <span className="text-xs font-bold">{Math.round(localMargins.left * 100)}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="0.2"
                              step="0.01"
                              value={localMargins.left}
                              onChange={handleMarginChange('left')}
                              onMouseUp={handleMarginChangeComplete('left')}
                              onKeyUp={handleMarginChangeComplete('left')}
                              onTouchEnd={handleMarginChangeComplete('left')}
                              className="w-full bg-offbase rounded-lg appearance-none cursor-pointer accent-accent [&::-webkit-slider-runnable-track]:bg-offbase [&::-webkit-slider-runnable-track]:rounded-lg [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-track]:bg-offbase [&::-moz-range-track]:rounded-lg [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent"
                            />
                          </div>

                          {/* Right Margin */}
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-xs">Right</span>
                              <span className="text-xs font-bold">{Math.round(localMargins.right * 100)}%</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="0.2"
                              step="0.01"
                              value={localMargins.right}
                              onChange={handleMarginChange('right')}
                              onMouseUp={handleMarginChangeComplete('right')}
                              onKeyUp={handleMarginChangeComplete('right')}
                              onTouchEnd={handleMarginChangeComplete('right')}
                              className="w-full bg-offbase rounded-lg appearance-none cursor-pointer accent-accent [&::-webkit-slider-runnable-track]:bg-offbase [&::-webkit-slider-runnable-track]:rounded-lg [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-track]:bg-offbase [&::-moz-range-track]:rounded-lg [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted mt-2">
                          Adjust margins to exclude content from edges of the page during text extraction (experimental)
                        </p>
                      </div>
                      <Listbox
                        value={selectedView}
                        onChange={(newView) => updateConfigKey('viewType', newView.id as ViewType)}
                      >
                        <div className="relative z-10 space-y-2">
                          <label className="block text-sm font-medium text-foreground">Mode</label>
                          <ListboxButton className="relative w-full cursor-pointer rounded-lg bg-background py-1.5 pl-3 pr-10 text-left text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-accent transform transition-transform duration-200 ease-in-out hover:scale-[1.009] hover:text-accent hover:bg-offbase">
                            <span className="block truncate">{selectedView.name}</span>
                            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                              <ChevronUpDownIcon className="h-5 w-5 text-muted" />
                            </span>
                          </ListboxButton>
                          <Transition
                            as={Fragment}
                            leave="transition ease-in duration-100"
                            leaveFrom="opacity-100"
                            leaveTo="opacity-0"
                          >
                            <ListboxOptions className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-background py-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
                              {viewTypeTextMapping.map((view) => (
                                <ListboxOption
                                  key={view.id}
                                  className={({ active }) =>
                                    `relative cursor-pointer select-none py-1.5 pl-10 pr-4 ${active ? 'bg-offbase text-accent' : 'text-foreground'
                                    }`
                                  }
                                  value={view}
                                >
                                  {({ selected }) => (
                                    <>
                                      <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                        {view.name}
                                      </span>
                                      {selected ? (
                                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-accent">
                                          <CheckIcon className="h-5 w-5" />
                                        </span>
                                      ) : null}
                                    </>
                                  )}
                                </ListboxOption>
                              ))}
                            </ListboxOptions>
                          </Transition>
                          {selectedView.id === 'scroll' && (
                            <p className="text-sm text-warning pt-2">
                              Note: Continuous scroll may perform poorly for larger documents.
                            </p>
                          )}
                        </div>
                      </Listbox>

                    </div>}

                    {!html && <div className="space-y-1">
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={skipBlank}
                          onChange={(e) => updateConfigKey('skipBlank', e.target.checked)}
                          className="form-checkbox h-4 w-4 text-accent rounded border-muted"
                        />
                        <span className="text-sm font-medium text-foreground">Skip blank pages</span>
                      </label>
                      <p className="text-sm text-muted pl-6">
                        Automatically skip pages with no text content
                      </p>
                    </div>}
                    {!html && (
                      <div className="space-y-1">
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={smartSentenceSplitting}
                            onChange={(e) => updateConfigKey('smartSentenceSplitting', e.target.checked)}
                            className="form-checkbox h-4 w-4 text-accent rounded border-muted"
                          />
                          <span className="text-sm font-medium text-foreground">
                            Smart sentence splitting
                          </span>
                        </label>
                        <p className="text-sm text-muted pl-6">
                          Merge sentences across page or section breaks
                        </p>
                      </div>
                    )}
                    {!epub && !html && (
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={pdfHighlightEnabled}
                              onChange={(e) => updateConfigKey('pdfHighlightEnabled', e.target.checked)}
                              className="form-checkbox h-4 w-4 text-accent rounded border-muted"
                            />
                            <span className="text-sm font-medium text-foreground">Highlight text during playback</span>
                          </label>
                          <p className="text-sm text-muted pl-6">
                            Visual text playback highlighting in the PDF viewer
                          </p>
                        </div>
                        <div className="space-y-1 pl-6">
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={pdfWordHighlightEnabled && pdfHighlightEnabled}
                              disabled={!pdfHighlightEnabled || !canWordHighlight}
                              onChange={(e) =>
                                updateConfigKey('pdfWordHighlightEnabled', e.target.checked)
                              }
                              className="form-checkbox h-4 w-4 text-accent rounded border-muted disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <span className="text-sm font-medium text-foreground">
                              Word-by-word
                            </span>
                          </label>
                          <p className="text-sm text-muted pl-6">
                            Highlight individual words using audio timestamps generated by whisper.cpp {!canWordHighlight && '(disabled by configuration)'}
                          </p>
                        </div>
                      </div>
                    )}
                    {epub && (
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={epubHighlightEnabled}
                              onChange={(e) => updateConfigKey('epubHighlightEnabled', e.target.checked)}
                              className="form-checkbox h-4 w-4 text-accent rounded border-muted"
                            />
                            <span className="text-sm font-medium text-foreground">Highlight text during playback</span>
                          </label>
                          <p className="text-sm text-muted pl-6">
                            Visual text playback highlighting in the EPUB viewer
                          </p>
                        </div>
                        <div className="space-y-1 pl-6">
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={epubWordHighlightEnabled && epubHighlightEnabled}
                              disabled={!epubHighlightEnabled || !canWordHighlight}
                              onChange={(e) =>
                                updateConfigKey('epubWordHighlightEnabled', e.target.checked)
                              }
                              className="form-checkbox h-4 w-4 text-accent rounded border-muted disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <span className="text-sm font-medium text-foreground">
                              Word-by-word
                            </span>
                          </label>
                          <p className="text-sm text-muted pl-6">
                            Highlight individual words using audio timestamps generated by whisper.cpp {!canWordHighlight && '(disabled by configuration)'}
                          </p>
                        </div>
                      </div>
                    )}
                    {epub && (
                      <div className="space-y-1">
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={epubTheme}
                            onChange={(e) => updateConfigKey('epubTheme', e.target.checked)}
                            className="form-checkbox h-4 w-4 text-accent rounded border-muted"
                          />
                          <span className="text-sm font-medium text-foreground">Use theme</span>
                        </label>
                        <p className="text-sm text-muted pl-6">
                          Apply the current app theme to the EPUB viewer background and text colors
                        </p>
                      </div>
                    )}
      </div>
    </ReaderSidebarShell>
  );
}
