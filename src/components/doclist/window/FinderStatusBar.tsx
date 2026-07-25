'use client';

import { formatDocumentSize } from '@/components/doclist/formatSize';

interface FinderStatusBarProps {
  itemCount: number;
  selectedCount: number;
  totalSize: number;
  summary?: string;
  actions?: React.ReactNode;
}

export function FinderStatusBar({
  itemCount,
  selectedCount,
  totalSize,
  summary,
  actions,
}: FinderStatusBarProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-12 px-4 py-1.5 flex flex-wrap items-center justify-between gap-3 text-xs text-soft bg-surface border-t border-line-soft select-none"
    >
      <span className="truncate">{summary}</span>
      <div className="flex items-center gap-3 flex-wrap">
        {actions}
        <span className="shrink-0">
          {selectedCount > 0
            ? `${selectedCount} of ${itemCount} selected`
            : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
          <span className="mx-1.5 text-soft">•</span>
          {formatDocumentSize(totalSize)}
        </span>
      </div>
    </div>
  );
}
