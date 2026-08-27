"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';

import { ModalFrame } from '@/components/ui';

type ReviewFlag = {
  id: string;
  label: string;
  description: string;
};

type BatchRefineRun = {
  id: string;
  status: string;
  recordingMode: string;
  profileCategory: string;
  totalChapters: number;
  processedChapters: number;
  changedChapters: number;
  unchangedChapters: number;
  failedChapters: number;
};

type BatchRefineChange = {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  previousText: string;
  proposedText: string;
  diffText: string;
  changedCharacters: number;
  addedCharacters: number;
  removedCharacters: number;
  changePercent: number;
  reviewPriority: 'low' | 'medium' | 'high';
  priorityScore: number;
  flagsJson: unknown;
  reviewNote: string | null;
  decision: 'pending' | 'approved' | 'rejected';
  edited: boolean;
  audioStatus: 'not_requested' | 'queued' | 'running' | 'completed' | 'error';
  audioError: string | null;
};

type ReviewResponse = {
  run: BatchRefineRun | null;
  changes: BatchRefineChange[];
  flagDefinitions: ReviewFlag[];
  profileConfig: { label: string; description: string } | null;
};

type ReviewSort = 'chapter' | 'changed' | 'concern';
type ReviewFilter = 'pending' | 'high' | 'all';

function flagIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function priorityClasses(priority: BatchRefineChange['reviewPriority']): string {
  if (priority === 'high') return 'border-danger bg-danger-wash text-danger';
  if (priority === 'medium') return 'border-accent-line bg-accent-wash text-accent';
  return 'border-line bg-surface-sunken text-soft';
}

function audioStatusLabel(change: BatchRefineChange): string {
  if (change.decision === 'rejected') return 'Previous text kept';
  if (change.decision === 'pending') return 'Waiting for review';
  if (change.audioStatus === 'completed') return 'Replacement recording complete';
  if (change.audioStatus === 'running') return 'Kokoro is recording';
  if (change.audioStatus === 'queued') return 'Queued for Kokoro';
  if (change.audioStatus === 'error') return 'Recording failed';
  return 'Approved';
}

export function BatchRefineReviewModal({
  open,
  onClose,
  bookId,
  runId,
  onRecordingQueued,
}: {
  open: boolean;
  onClose: () => void;
  bookId: string;
  runId?: string | null;
  onRecordingQueued?: () => void;
}) {
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<ReviewSort>('chapter');
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openFlag, setOpenFlag] = useState<string | null>(null);
  const [expandedComparisons, setExpandedComparisons] = useState<string[]>([]);

  const loadReview = useCallback(async (quiet = false) => {
    if (!open) return;
    if (!quiet) setLoading(true);
    try {
      const query = new URLSearchParams({ bookId });
      if (runId) query.set('runId', runId);
      const response = await fetch(`/api/audiobooks/batch-refine/review?${query.toString()}`, {
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as ReviewResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Review could not be loaded.');
      setReview(body);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Review could not be loaded.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [bookId, open, runId]);

  useEffect(() => {
    if (!open) return;
    void loadReview();
    const poll = window.setInterval(() => void loadReview(true), 4000);
    return () => window.clearInterval(poll);
  }, [loadReview, open]);

  const flagsById = useMemo(() => new Map(
    (review?.flagDefinitions || []).map((flag) => [flag.id, flag]),
  ), [review?.flagDefinitions]);

  const shownChanges = useMemo(() => {
    const filtered = (review?.changes || []).filter((change) => {
      if (filter === 'pending') return change.decision === 'pending';
      if (filter === 'high') return change.reviewPriority === 'high';
      return true;
    });
    return [...filtered].sort((left, right) => {
      if (sort === 'changed') {
        return right.changedCharacters - left.changedCharacters || left.chapterIndex - right.chapterIndex;
      }
      if (sort === 'concern') {
        return right.priorityScore - left.priorityScore || left.chapterIndex - right.chapterIndex;
      }
      return left.chapterIndex - right.chapterIndex;
    });
  }, [filter, review?.changes, sort]);

  const pendingCount = review?.changes.filter((change) => change.decision === 'pending').length || 0;
  const approvedCount = review?.changes.filter((change) => change.decision === 'approved').length || 0;
  const rejectedCount = review?.changes.filter((change) => change.decision === 'rejected').length || 0;

  const reviewAction = async (body: Record<string, unknown>, successMessage: string) => {
    const response = await fetch('/api/audiobooks/batch-refine/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({})) as { error?: string; failures?: unknown[] };
    if (!response.ok) throw new Error(result.error || 'The review action failed.');
    if (result.failures?.length) {
      toast.error(`${successMessage} ${result.failures.length} change(s) could not be approved.`);
    } else {
      toast.success(successMessage);
    }
    await loadReview(true);
  };

  const approve = async (change: BatchRefineChange) => {
    setBusyId(change.id);
    try {
      const editedText = editingId === change.id ? drafts[change.id] : undefined;
      await reviewAction({ action: 'approve', changeId: change.id, editedText }, 'Approved and queued for Kokoro.');
      setEditingId(null);
      onRecordingQueued?.();
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : 'Approval failed.');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (change: BatchRefineChange) => {
    setBusyId(change.id);
    try {
      await reviewAction({ action: 'reject', changeId: change.id }, 'Kept the previous text.');
      setEditingId(null);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : 'The previous text could not be kept.');
    } finally {
      setBusyId(null);
    }
  };

  const approveAll = async () => {
    if (!review?.run || pendingCount === 0) return;
    if (!window.confirm(`Approve all ${pendingCount} pending changes and queue their replacement recordings?`)) return;
    setBusyId('approve-all');
    try {
      await reviewAction({ action: 'approve-all', runId: review.run.id }, `Approved ${pendingCount} change(s) and queued Kokoro.`);
      onRecordingQueued?.();
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : 'Approve All failed.');
    } finally {
      setBusyId(null);
    }
  };

  const retry = async (change: BatchRefineChange) => {
    setBusyId(change.id);
    try {
      await reviewAction({ action: 'retry', changeId: change.id }, 'Recording queued again.');
      onRecordingQueued?.();
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : 'Retry failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ModalFrame open={open} onClose={onClose} size="xl">
      <div className="flex max-h-[92vh] flex-col overflow-hidden rounded-xl border border-line-soft bg-surface">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line-soft bg-surface-raised p-4">
          <div>
            <h2 className="text-xl font-bold text-text-strong">AI Batch Refine Review</h2>
            <p className="mt-1 text-sm text-text-soft">
              Only chapters Gemini changed appear here. Approval saves that text and immediately queues its Kokoro replacement.
            </p>
          </div>
          <button onClick={onClose} className="px-2 text-2xl leading-none text-text-soft hover:text-text-strong" aria-label="Close review">&times;</button>
        </div>

        <div className="shrink-0 space-y-3 border-b border-line-soft p-4">
          {review?.run && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded border border-line-soft bg-surface-sunken px-2 py-1 text-text-strong">
                {review.profileConfig?.label || review.run.profileCategory}
              </span>
              <span className="text-text-soft">Run: {review.run.status}</span>
              <span className="text-text-soft">Scanned {review.run.processedChapters}/{review.run.totalChapters}</span>
              <span className="text-accent">{pendingCount} pending</span>
              <span className="text-foreground">{approvedCount} approved</span>
              <span className="text-text-soft">{rejectedCount} kept previous</span>
              {review.run.failedChapters > 0 && (
                <span className="text-danger">{review.run.failedChapters} failed to scan</span>
              )}
              <a
                className="ml-auto font-semibold text-accent hover:underline"
                href={`/api/audiobooks/batch-refine/changelog?bookId=${encodeURIComponent(bookId)}&runId=${encodeURIComponent(review.run.id)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Raw changelog
              </a>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-text-soft" htmlFor="batch-refine-sort">Sort:</label>
            <select
              id="batch-refine-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as ReviewSort)}
              className="rounded border border-line-soft bg-surface px-2 py-1.5 text-sm text-text-strong"
            >
              <option value="chapter">Chapter order</option>
              <option value="changed">Most changed text</option>
              <option value="concern">Highest AI/review concern</option>
            </select>
            <label className="ml-2 text-xs font-semibold text-text-soft" htmlFor="batch-refine-filter">Show:</label>
            <select
              id="batch-refine-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as ReviewFilter)}
              className="rounded border border-line-soft bg-surface px-2 py-1.5 text-sm text-text-strong"
            >
              <option value="pending">Pending review</option>
              <option value="high">High concern</option>
              <option value="all">All changed text</option>
            </select>
            <button
              onClick={approveAll}
              disabled={pendingCount === 0 || busyId !== null || editingId !== null}
              title={editingId ? 'Approve or cancel the open edit before using Approve All.' : undefined}
              className="ml-auto rounded bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-secondary-accent disabled:opacity-50"
            >
              {busyId === 'approve-all' ? 'Approving…' : `Approve All (${pendingCount})`}
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {loading && !review && <p className="text-sm text-text-soft">Loading changed chapters…</p>}
          {error && <div className="rounded border border-danger bg-danger-wash p-3 text-sm text-danger">{error}</div>}
          {!loading && !error && !review?.run && (
            <div className="rounded border border-line-soft bg-surface-raised p-6 text-center text-sm text-text-soft">
              No Batch Refine review exists for this book yet.
            </div>
          )}
          {review?.run && shownChanges.length === 0 && (
            <div className="rounded border border-line-soft bg-surface-raised p-6 text-center text-sm text-text-soft">
              No changed chapters match this filter.
            </div>
          )}

          {shownChanges.map((change) => {
            const isEditing = editingId === change.id;
            const isBusy = busyId === change.id;
            const isExpanded = isEditing || expandedComparisons.includes(change.id);
            const ids = flagIds(change.flagsJson);
            return (
              <article key={change.id} className="overflow-hidden rounded-lg border border-line-soft bg-surface-raised">
                <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
                  <h3 className="font-semibold text-text-strong">
                    {change.chapterIndex + 1}. {change.chapterTitle}
                  </h3>
                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${priorityClasses(change.reviewPriority)}`}>
                    {change.reviewPriority} concern · {change.priorityScore}
                  </span>
                  <span className="text-xs text-text-soft">
                    {change.changedCharacters.toLocaleString()} characters changed ({change.changePercent}%)
                  </span>
                  <span className="ml-auto text-xs font-semibold text-text-soft">{audioStatusLabel(change)}</span>
                </div>

                {(ids.length > 0 || change.reviewNote) && (
                  <div className="space-y-2 border-b border-line-soft bg-surface-sunken px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {ids.map((id) => {
                        const definition = flagsById.get(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setOpenFlag((current) => current === `${change.id}:${id}` ? null : `${change.id}:${id}`)}
                            className="rounded-full border border-accent-line bg-accent-wash px-2.5 py-1 text-xs font-medium text-accent hover:bg-surface-sunken"
                          >
                            ⚑ {definition?.label || id}
                          </button>
                        );
                      })}
                    </div>
                    {ids.map((id) => openFlag === `${change.id}:${id}` && (
                      <p key={id} className="rounded border border-line-soft bg-surface px-3 py-2 text-xs text-text-soft">
                        {flagsById.get(id)?.description || 'Gemini marked this change for additional human review.'}
                      </p>
                    ))}
                    {change.reviewNote && <p className="text-xs text-text-soft"><span className="font-semibold">AI note:</span> {change.reviewNote}</p>}
                  </div>
                )}

                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-text-soft">Changed lines with nearby context</span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedComparisons((current) => current.includes(change.id)
                          ? current.filter((id) => id !== change.id)
                          : [...current, change.id])}
                        className="text-xs font-semibold text-accent hover:underline"
                      >
                        {isExpanded && !isEditing ? 'Hide full comparison' : 'View full chapter comparison'}
                      </button>
                      {change.decision === 'pending' && (
                        <button
                          onClick={() => {
                            if (isEditing) {
                              setEditingId(null);
                            } else {
                              setDrafts((current) => ({ ...current, [change.id]: change.proposedText }));
                              setEditingId(change.id);
                            }
                          }}
                          className="text-xs font-semibold text-accent hover:underline"
                        >
                          {isEditing ? 'Cancel edit' : 'Edit proposal'}
                        </button>
                      )}
                    </div>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line-soft bg-surface-sunken p-3 text-xs leading-relaxed text-text-strong">{change.diffText}</pre>
                  {isExpanded && (
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-soft">Previous approved text</div>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line-soft bg-surface p-3 text-xs leading-relaxed text-text-strong">{change.previousText}</pre>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-soft">
                          {change.edited ? 'Reviewer-edited text' : 'Gemini proposal'}
                        </div>
                        {isEditing ? (
                          <textarea
                            value={drafts[change.id] ?? change.proposedText}
                            onChange={(event) => setDrafts((current) => ({ ...current, [change.id]: event.target.value }))}
                            className="h-72 w-full resize-y rounded border border-accent bg-surface p-3 font-mono text-xs leading-relaxed text-text-strong focus:outline-none focus:ring-2 focus:ring-accent-line"
                          />
                        ) : (
                          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line-soft bg-surface p-3 text-xs leading-relaxed text-text-strong">{change.proposedText}</pre>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-4 py-3">
                  {change.audioStatus === 'error' && (
                    <>
                      <span className="mr-auto text-xs text-danger" title={change.audioError || undefined}>{change.audioError || 'Recording failed.'}</span>
                      <button
                        onClick={() => void retry(change)}
                        disabled={isBusy}
                        className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-secondary-accent disabled:opacity-50"
                      >
                        Retry Kokoro
                      </button>
                    </>
                  )}
                  {change.decision === 'pending' && (
                    <>
                      <button
                        onClick={() => void reject(change)}
                        disabled={isBusy}
                        className="rounded border border-line-soft px-3 py-1.5 text-sm font-semibold text-text-strong hover:bg-surface-sunken disabled:opacity-50"
                      >
                        Keep Previous
                      </button>
                      <button
                        onClick={() => void approve(change)}
                        disabled={isBusy}
                        className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-secondary-accent disabled:opacity-50"
                      >
                        {isBusy ? 'Saving…' : isEditing ? 'Approve Edit & Record' : 'Approve & Record'}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </ModalFrame>
  );
}
