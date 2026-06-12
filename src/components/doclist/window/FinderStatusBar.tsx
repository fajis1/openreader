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
      className="min-h-6 px-3 pb-[env(safe-area-inset-bottom)] flex items-center justify-between gap-3 text-[11px] text-soft bg-surface border-t border-line-soft select-none"
    >
      <span className="truncate">{summary}</span>
      <span className="shrink-0 flex items-center gap-2">
        {actions}
        <span>
          {selectedCount > 0
            ? `${selectedCount} of ${itemCount} selected`
            : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
          <span className="mx-1.5 text-soft">•</span>
          {formatDocumentSize(totalSize)}
        </span>
      </span>
    </div>
  );
}
