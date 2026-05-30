import type { CSSProperties } from 'react';
import type { IconSize } from '@/types/documents';

const TILE_WIDTH_PX: Record<IconSize, number> = {
  sm: 112,
  md: 136,
  lg: 162,
  xl: 192,
};

const SMALL_GRID_ITEM_COUNT = 3;
export const GRID_GAP_PX = 12;

export function iconTileWidthPx(iconSize: IconSize): number {
  return TILE_WIDTH_PX[iconSize];
}

export function maxColumnsForIconGrid(iconSize: IconSize, gridWidthPx: number): number {
  if (!Number.isFinite(gridWidthPx) || gridWidthPx <= 0) return 1;
  const tileWidth = iconTileWidthPx(iconSize);
  return Math.max(1, Math.floor((gridWidthPx + GRID_GAP_PX) / (tileWidth + GRID_GAP_PX)));
}

function responsiveGridTemplate(iconSize: IconSize, itemCount: number, suppressStretch: boolean): string {
  const width = TILE_WIDTH_PX[iconSize];
  if (suppressStretch || itemCount <= SMALL_GRID_ITEM_COUNT) {
    return `repeat(auto-fill, minmax(min(100%, ${width}px), ${width}px))`;
  }
  return `repeat(auto-fit, minmax(${width}px, 1fr))`;
}

export function iconsGridStyle(
  iconSize: IconSize,
  itemCount: number,
  options?: { suppressSingleRowStretch?: boolean },
): CSSProperties {
  const suppressSingleRowStretch = Boolean(options?.suppressSingleRowStretch);
  return {
    gridTemplateColumns: responsiveGridTemplate(iconSize, itemCount, suppressSingleRowStretch),
    gap: `${GRID_GAP_PX}px`,
    justifyContent: suppressSingleRowStretch || itemCount <= SMALL_GRID_ITEM_COUNT ? 'start' : undefined,
  };
}
