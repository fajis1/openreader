'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useDrop } from 'react-dnd';
import type { Folder, SidebarFilter } from '@/types/documents';
import { PDFIcon, EPUBIcon, FileIcon } from '@/components/icons/Icons';
import { FolderIcon, HomeIcon, ClockIcon, FolderPlusIcon } from './finderIcons';
import { DND_DOCUMENT, type DocumentDragItem } from '../dnd/dndTypes';

interface FinderSidebarProps {
  filter: SidebarFilter;
  onFilterChange: (filter: SidebarFilter) => void;
  folders: Folder[];
  counts: { all: number; pdf: number; epub: number; html: number };
  onDeleteFolder: (folderId: string) => void;
  onNewFolder: () => void;
  /** When dragging onto a folder row, move dropped docs into that folder. */
  onDropOnFolder: (folderId: string, item: DocumentDragItem) => void;
  /** Width controls (desktop only). */
  width: number;
  onWidthChange: (px: number) => void;
  topSlot?: ReactNode;
}

const MIN_WIDTH = 168;
const MAX_WIDTH = 320;

interface SidebarRowProps {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count?: number;
  countClassName?: string;
  trailing?: ReactNode;
  isDropTarget?: boolean;
}

function SidebarRow({
  active,
  onClick,
  icon,
  label,
  count,
  countClassName,
  trailing,
  isDropTarget,
}: SidebarRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'group w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] border transform transition-all duration-200 ease-out text-left hover:scale-[1.01] ' +
        (active
          ? 'border-accent bg-offbase text-accent'
          : 'border-transparent text-foreground hover:border-accent hover:bg-offbase hover:text-accent') +
        (isDropTarget ? ' ring-1 ring-accent' : '')
      }
    >
      <span
        className={
          'w-4 h-4 shrink-0 flex items-center justify-center transition-colors duration-200 ' +
          (active ? 'text-accent' : 'text-muted group-hover:text-accent')
        }
      >
        {icon}
      </span>
      <span className="truncate flex-1">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span
          className={`text-[10px] text-muted tabular-nums transition-transform duration-200 ease-out ${countClassName ?? ''}`}
        >
          {count}
        </span>
      )}
      {trailing}
    </button>
  );
}

function FolderRow({
  folder,
  active,
  onClick,
  onDelete,
  onDropOnFolder,
}: {
  folder: Folder;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onDropOnFolder: (folderId: string, item: DocumentDragItem) => void;
}) {
  const [{ isOver, canDrop }, dropRef] = useDrop<
    DocumentDragItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(() => ({
    accept: DND_DOCUMENT,
    drop: (item) => {
      onDropOnFolder(folder.id, item);
    },
    canDrop: (item) => {
      // Don't accept if all items are already in this folder.
      return item.docs.some((d) => d.folderId !== folder.id);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }),
      canDrop: monitor.canDrop(),
    }),
  }), [folder.id, onDropOnFolder]);

  const isDropTarget = isOver && canDrop;
  return (
    <div
      ref={dropRef as unknown as React.RefObject<HTMLDivElement>}
      className="group/folder relative"
    >
      <SidebarRow
        active={active}
        onClick={onClick}
        icon={<FolderIcon className="w-3.5 h-3.5" />}
        label={folder.name}
        count={folder.documents.length}
        countClassName="group-hover/folder:-translate-x-6 group-focus-within/folder:-translate-x-6"
        isDropTarget={isDropTarget}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded text-muted opacity-0 group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 hover:text-accent hover:bg-offbase transition"
        aria-label={`Delete ${folder.name}`}
        title={`Delete ${folder.name}`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function SectionLabel({ children, isFirst }: { children: ReactNode; isFirst?: boolean }) {
  return (
    <p
      className={
        'px-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-muted font-semibold ' +
        (isFirst ? 'pt-1.5' : 'pt-3')
      }
    >
      {children}
    </p>
  );
}

export function FinderSidebar({
  filter,
  onFilterChange,
  folders,
  counts,
  onDeleteFolder,
  onNewFolder,
  onDropOnFolder,
  width,
  onWidthChange,
  topSlot,
}: FinderSidebarProps) {
  const startRef = useRef<{ x: number; w: number } | null>(null);

  const onResizeStart = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, w: width };
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    const delta = e.clientX - startRef.current.x;
    const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startRef.current.w + delta));
    onWidthChange(next);
  };
  const onResizeEnd = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    startRef.current = null;
  };

  return (
    <aside
      style={{ '--sidebar-width': `${width}px` } as CSSProperties}
      className="relative h-full w-full md:[width:var(--sidebar-width)] bg-base border-r border-offbase shrink-0 overflow-y-auto"
    >
      <div className="p-2 flex flex-col gap-0.5">
        {topSlot && (
          <div className="mb-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            {topSlot}
          </div>
        )}
        <SectionLabel isFirst={!!topSlot}>Library</SectionLabel>
        <SidebarRow
          active={filter === 'all'}
          onClick={() => onFilterChange('all')}
          icon={<HomeIcon className="w-3.5 h-3.5" />}
          label="All Documents"
          count={counts.all}
        />
        <SidebarRow
          active={filter === 'recents'}
          onClick={() => onFilterChange('recents')}
          icon={<ClockIcon className="w-3.5 h-3.5" />}
          label="Recently Opened"
        />

        <SectionLabel>Kinds</SectionLabel>
        <SidebarRow
          active={filter === 'pdf'}
          onClick={() => onFilterChange('pdf')}
          icon={<PDFIcon className="w-3.5 h-3.5" />}
          label="PDF"
          count={counts.pdf}
        />
        <SidebarRow
          active={filter === 'epub'}
          onClick={() => onFilterChange('epub')}
          icon={<EPUBIcon className="w-3.5 h-3.5" />}
          label="EPUB"
          count={counts.epub}
        />
        <SidebarRow
          active={filter === 'html'}
          onClick={() => onFilterChange('html')}
          icon={<FileIcon className="w-3.5 h-3.5" />}
          label="HTML / Text"
          count={counts.html}
        />

        <div className="px-2 pt-3 pb-1 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.08em] text-muted font-semibold">
            Folders
          </p>
          <button
            type="button"
            onClick={onNewFolder}
            className="inline-flex items-center justify-center h-6 w-6 rounded-md border border-offbase bg-base text-foreground hover:text-accent hover:border-accent hover:bg-offbase transition-all duration-200 ease-out hover:scale-[1.01]"
            title="New folder"
            aria-label="New folder"
          >
            <FolderPlusIcon className="w-4 h-4" />
          </button>
        </div>
        {folders.length === 0 ? (
          <p className="px-2 py-1 text-[11px] text-muted">No folders yet</p>
        ) : (
          folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              active={filter === `folder:${folder.id}`}
              onClick={() => onFilterChange(`folder:${folder.id}`)}
              onDelete={() => onDeleteFolder(folder.id)}
              onDropOnFolder={onDropOnFolder}
            />
          ))
        )}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className="hidden md:block absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-offbase active:bg-accent transition-colors duration-200 ease-out"
      />
    </aside>
  );
}
