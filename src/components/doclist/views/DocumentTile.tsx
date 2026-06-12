'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { useDrag, useDrop, type DragSourceMonitor } from 'react-dnd';
import { PDFIcon, EPUBIcon, FileIcon } from '@/components/icons/Icons';
import type { DocumentListDocument, IconSize } from '@/types/documents';
import { DocumentPreview } from '@/components/doclist/DocumentPreview';
import { IconButton, MenuRoot, MenuTrigger, MenuTransition, MenuItemsSurface, MenuActionItem } from '@/components/ui';
import { useDocumentSelection } from '../dnd/DocumentSelectionContext';
import { DND_DOCUMENT, documentIdentityKey, type DocumentDragItem } from '../dnd/dndTypes';
import useSWR from 'swr';

interface DocumentTileProps {
  doc: DocumentListDocument;
  iconSize: IconSize;
  onDelete: (doc: DocumentListDocument) => void;
  /** Fired when two unfoldered docs are dropped together → caller should open a "create folder" dialog. */
  onMergeIntoFolder: (source: DocumentListDocument[], target: DocumentListDocument) => void;
  isAudiobookView?: boolean;
}

const NAME_SIZE_CLASSES: Record<IconSize, string> = {
  sm: 'text-[10px]',
  md: 'text-[11px]',
  lg: 'text-[12px]',
  xl: 'text-[13px]',
};

const BOTTOM_PADDING_CLASSES: Record<IconSize, string> = {
  sm: 'px-[7px] py-[4px]',
  md: 'px-[8px] py-[5px]',
  lg: 'px-[9px] py-[5px]',
  xl: 'px-[10px] py-[6px]',
};

const LINK_PADDING_CLASS = 'px-[2px] py-[2px]';

const GAP_CLASSES: Record<IconSize, string> = {
  sm: 'gap-1',
  md: 'gap-1.5',
  lg: 'gap-2',
  xl: 'gap-2',
};

const FILE_ICON_CLASSES: Record<IconSize, string> = {
  sm: 'w-3 h-3',
  md: 'w-3.5 h-3.5',
  lg: 'w-3.5 h-3.5',
  xl: 'w-4 h-4',
};

const TRASH_BTN_CLASSES: Record<IconSize, string> = {
  sm: 'ml-0.5 h-[18px] w-[18px] rounded-sm',
  md: 'ml-0.5 h-[21px] w-[21px] rounded-sm',
  lg: 'ml-1 h-[23px] w-[23px] rounded',
  xl: 'ml-1.5 h-[25px] w-[25px] rounded',
};

const TRASH_ICON_CLASSES: Record<IconSize, string> = {
  sm: 'w-[10px] h-[10px]',
  md: 'w-[11px] h-[11px]',
  lg: 'w-[12px] h-[12px]',
  xl: 'w-[13px] h-[13px]',
};

export function DocumentTile({
  doc,
  iconSize,
  onDelete,
  onMergeIntoFolder,
  isAudiobookView,
}: DocumentTileProps) {
  const href = isAudiobookView ? `/api/audiobook?bookId=${encodeURIComponent(doc.id)}&format=m4b` : `/${doc.type}/${encodeURIComponent(doc.id)}`;
  const selection = useDocumentSelection();

  const { data: audiobooksData } = useSWR('/api/audiobooks', async (url) => {
    try {
      const res = await fetch(url);
      const json = await res.json();
      return json;
    } catch {
      return { audiobooks: [], smartAudiobookIds: [] };
    }
  });
  const generatedAudiobookIds = audiobooksData?.audiobooks || [];
  const smartAudiobookIds = audiobooksData?.smartAudiobookIds || [];
  const audiobookSizes = audiobooksData?.audiobookSizes || {};

  const hasAudiobook = generatedAudiobookIds?.includes(doc.id) ?? false;
  const hasSmartAudio = smartAudiobookIds?.includes(doc.id) ?? false;

  const showDeleteButton = true;
  const isSelected = selection.isSelected(doc);
  const isInFolder = Boolean(doc.folderId);
  const didDragRef = useRef(false);

  const [{ isDragging }, dragRef, previewRef] = useDrag<
    DocumentDragItem,
    void,
    { isDragging: boolean }
  >(() => {
    return {
      type: DND_DOCUMENT,
      item: () => {
        // If the dragged doc is selected and there are multiple selected, drag the group.
        const selected = selection.getSelectedDocs();
        const dragging = isSelected && selected.length > 1
          ? selected
          : [doc];
        // Reflect the actual drag in the selection so visuals match.
        if (!isSelected) selection.replace([doc]);
        return {
          items: dragging.map(({ id, type }) => ({ id, type })),
          docs: dragging,
          fromFolderId: doc.folderId,
        };
      },
      // A mouse drag ending on the same tile is followed by a click that would
      // open the doc. Flag the drag so handleClick can swallow that click; clear
      // on the next macrotask in case the drag ended elsewhere (no click fires).
      end: () => {
        didDragRef.current = true;
        setTimeout(() => { didDragRef.current = false; }, 0);
      },
      collect: (monitor: DragSourceMonitor) => ({ isDragging: monitor.isDragging() }),
    };
  }, [doc, isSelected, selection]);

  const [{ isOver, canDrop }, dropRef] = useDrop<
    DocumentDragItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(() => ({
    accept: DND_DOCUMENT,
    canDrop: (item) => {
      // Only allow drop-to-merge on unfoldered docs, and don't drop a doc on itself.
      if (isInFolder) return false;
      return !item.items.some((it) => documentIdentityKey(it) === documentIdentityKey(doc));
    },
    drop: (item) => onMergeIntoFolder(item.docs, doc),
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }),
      canDrop: monitor.canDrop(),
    }),
  }), [doc, isInFolder, onMergeIntoFolder]);

  const isDropTarget = isOver && canDrop;

  const setRefs = (node: HTMLDivElement | null) => {
    dragRef(node);
    dropRef(node);
    previewRef(node);
  };

  const handleClick: React.MouseEventHandler = (e) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      e.preventDefault();
      return;
    }
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      selection.select(doc, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
    }
  };

  return (
    <div
      ref={setRefs}
      data-doc-tile
      aria-selected={isSelected}
      className={
        'group relative flex flex-col rounded-md overflow-hidden border transition duration-base ease-standard ' +
        // iOS: suppress the long-press link preview/callout and selection magnifier so the
        // long-press is handed to the touch DnD backend instead of the native preview.
        'select-none [-webkit-touch-callout:none] ' +
        (isSelected
          ? 'border-accent-line bg-surface-sunken'
          : 'border-line bg-surface hover:bg-accent-wash hover:border-accent-line') +
        (isDropTarget ? ' ring-1 ring-accent-line' : '') +
        (isDragging ? ' opacity-50' : '')
      }
    >
      <Link
        href={href}
        prefetch={false}
        draggable={false}
        className="block"
        aria-label={`Open ${doc.name}`}
        onClick={handleClick}
      >
        <DocumentPreview doc={doc} />
      </Link>
      <div className={`flex items-center w-full ${BOTTOM_PADDING_CLASSES[iconSize]}`}>
        <Link
          href={href}
          prefetch={false}
          draggable={false}
          className={`flex items-center flex-1 min-w-0 rounded-md ${LINK_PADDING_CLASS} ${GAP_CLASSES[iconSize]}`}
          onClick={handleClick}
          {...(isAudiobookView ? { download: true } : {})}
        >
          <span className="flex-shrink-0 flex items-center">
            {isAudiobookView ? (
              <svg className={`${FILE_ICON_CLASSES[iconSize]} text-accent`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            ) : doc.type === 'pdf' ? (
              <PDFIcon className={`${FILE_ICON_CLASSES[iconSize]} text-danger`} />
            ) : doc.type === 'epub' ? (
              <EPUBIcon className={`${FILE_ICON_CLASSES[iconSize]} text-accent`} />
            ) : (
              <FileIcon className={`${FILE_ICON_CLASSES[iconSize]} text-soft`} />
            )}
          </span>
          <span
            className={
              'leading-none font-medium truncate flex-1 min-w-0 ' +
              NAME_SIZE_CLASSES[iconSize] +
              ' ' +
              (isSelected ? 'text-accent' : 'text-foreground group-hover:text-accent')
            }
          >
            {doc.name}{isAudiobookView ? ' (Audiobook)' : ''}
          </span>
        </Link>
        {hasAudiobook && (
          <>
            {hasSmartAudio && (
              <div className="relative flex" onClick={(e) => e.stopPropagation()}>
              <MenuRoot>
                <MenuTrigger className={`${TRASH_BTN_CLASSES[iconSize]} flex items-center justify-center text-purple-500 hover:bg-purple-500/10 transition-colors`} aria-label={`View AI Changelog for ${doc.name}`} title="AI Changelog">
                  <svg className={TRASH_ICON_CLASSES[iconSize]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </MenuTrigger>
                <MenuTransition>
                  <MenuItemsSurface className="w-48 z-[60] right-0 mt-1">
                    <MenuActionItem
                      onClick={() => {
                        window.open(`/api/audiobook/changelog?bookId=${encodeURIComponent(doc.id)}`, '_blank');
                      }}
                      >View in Browser</MenuActionItem>
                    <MenuActionItem
                      onClick={() => {
                        window.location.href = `/api/audiobook/changelog?bookId=${encodeURIComponent(doc.id)}&download=true`;
                      }}
                      >Download as File</MenuActionItem>
                  </MenuItemsSurface>
                </MenuTransition>
              </MenuRoot>
              </div>
            )}
            <a
              href={`/api/audiobook?bookId=${encodeURIComponent(doc.id)}&format=m4b`}
              download
              onClick={(e) => e.stopPropagation()}
              className={`${TRASH_BTN_CLASSES[iconSize]} flex items-center justify-center text-accent hover:bg-accent-wash transition-colors`}
              aria-label={`Download M4B Audiobook for ${doc.name}`}
              title="Download Audiobook"
            >
              <svg className={TRASH_ICON_CLASSES[iconSize]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </a>
          </>
        )}
        {!isAudiobookView && (
          <a
            href={`/api/documents/blob/get/fallback?id=${encodeURIComponent(doc.id)}&download=true`}
            download
            onClick={(e) => e.stopPropagation()}
            className={`${TRASH_BTN_CLASSES[iconSize]} flex items-center justify-center text-foreground hover:text-white hover:bg-accent transition-colors`}
            aria-label={`Download ${doc.name}`}
            title="Download Original Document"
          >
            <svg className={TRASH_ICON_CLASSES[iconSize]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        )}
        {showDeleteButton && (
          <IconButton
            onClick={() => onDelete(doc)}
            size="xs"
            className={TRASH_BTN_CLASSES[iconSize]}
            aria-label={`Delete ${doc.name}`}
          >
            <svg className={TRASH_ICON_CLASSES[iconSize]} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </IconButton>
        )}
      </div>
    </div>
  );
}
