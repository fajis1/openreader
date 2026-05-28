'use client';

import { useEffect, type CSSProperties } from 'react';
import type { DocumentListDocument, IconSize } from '@/types/documents';
import { DocumentTile } from './DocumentTile';
import { useDocumentSelection } from '../dnd/DocumentSelectionContext';

interface IconsViewProps {
  documents: DocumentListDocument[];
  iconSize: IconSize;
  onDeleteDoc: (doc: DocumentListDocument) => void;
  onMergeIntoFolder: (sources: DocumentListDocument[], target: DocumentListDocument) => void;
}

const TILE_WIDTH_PX: Record<IconSize, number> = {
  sm: 112,
  md: 136,
  lg: 162,
  xl: 192,
};

const SMALL_GRID_ITEM_COUNT = 3;

function responsiveGridTemplate(iconSize: IconSize, itemCount: number): string {
  const width = TILE_WIDTH_PX[iconSize];
  if (itemCount <= SMALL_GRID_ITEM_COUNT) {
    return `repeat(auto-fill, minmax(${width}px, ${width}px))`;
  }
  return `repeat(auto-fit, minmax(${width}px, 1fr))`;
}

const gridGap = '12px';

function gridStyle(iconSize: IconSize, itemCount: number): CSSProperties {
  return {
    gridTemplateColumns: responsiveGridTemplate(iconSize, itemCount),
    gap: gridGap,
    justifyContent: itemCount <= SMALL_GRID_ITEM_COUNT ? 'start' : undefined,
  };
}

export function IconsView({
  documents,
  iconSize,
  onDeleteDoc,
  onMergeIntoFolder,
}: IconsViewProps) {
  const { setVisibleOrder, clear } = useDocumentSelection();

  useEffect(() => {
    setVisibleOrder(documents);
  }, [documents, setVisibleOrder]);

  const handleBackgroundClick: React.MouseEventHandler = (e) => {
    if ((e.target as HTMLElement).closest('[data-doc-tile]')) return;
    clear();
  };

  return (
    <div
      onClick={handleBackgroundClick}
      className="flex-1 min-h-0 overflow-y-auto p-3"
    >
      <div className="grid" style={gridStyle(iconSize, documents.length)}>
        {documents.map((doc) => (
          <DocumentTile
            key={`${doc.type}-${doc.id}`}
            doc={doc}
            iconSize={iconSize}
            onDelete={onDeleteDoc}
            onMergeIntoFolder={onMergeIntoFolder}
          />
        ))}
      </div>
    </div>
  );
}
