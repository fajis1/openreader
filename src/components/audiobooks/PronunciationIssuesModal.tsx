"use client";

import { useEffect, useRef, useState } from 'react';
import { ModalFrame } from '@/components/ui';
import { BatchRefineReviewModal } from './BatchRefineReviewModal';
import type { PronunciationIssue } from '@/lib/shared/pronunciation-issues';

type Chapter = { fileName: string; chapterIndex: number; failed: boolean };
type Finding = Chapter & { title: string; hash: string; issues: PronunciationIssue[]; jobId?: string; failureError?: string; runId?: string; audioStatus?: string; error?: string };

export function PronunciationIssuesModal({ open, onClose, bookId, profileId, onRecordingQueued }: {
  open: boolean; onClose: () => void; bookId: string; profileId?: string; onRecordingQueued: () => void;
}) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [reviewRun, setReviewRun] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) controller.current?.abort();
    return () => controller.current?.abort();
  }, [open]);
  useEffect(() => {
    controller.current?.abort();
    setFindings([]); setSelected([]); setDrafts({}); setScanned(false); setStatus(''); setError(''); setReviewRun(null);
  }, [bookId, profileId]);

  async function request(body: Record<string, unknown>, signal: AbortSignal) {
    const response = await fetch('/api/audiobooks/pronunciation-issues', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId, profileId, ...body }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The operation failed.');
    return data;
  }

  async function scan() {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError(''); setFindings([]); setSelected([]); setDrafts({}); setScanned(false);
    try {
      const response = await fetch(`/api/audiobooks/pronunciation-issues?bookId=${encodeURIComponent(bookId)}`, { signal: current.signal, cache: 'no-store' });
      const catalog = await response.json();
      if (!response.ok) throw new Error(catalog.error || 'Could not load chapters.');
      const chapters: Chapter[] = catalog.chapters;
      for (const [index, chapter] of chapters.entries()) {
        current.signal.throwIfAborted();
        setStatus(`Scanning chapter ${index + 1} of ${chapters.length}…`);
        try {
          const result: Finding = await request({ action: 'scan', fileName: chapter.fileName }, current.signal);
          current.signal.throwIfAborted();
          if (result.issues.length || result.failed) {
            setFindings(previous => [...previous, result]);
            if (result.issues.length && !result.runId) setSelected(previous => [...previous, result.fileName]);
          }
        } catch (problem) {
          if (current.signal.aborted) throw problem;
          setFindings(previous => [...previous, { ...chapter, title: `Chapter ${chapter.chapterIndex + 1}`, hash: '', issues: [], error: String(problem instanceof Error ? problem.message : problem) }]);
        }
      }
      setScanned(true);
      setStatus(`Checked ${chapters.length} chapter text files. ${catalog.failedJobs?.length ? 'Failed jobs may predate retained output; retry those jobs to capture new failures.' : ''}`);
    } catch (problem) {
      if (!current.signal.aborted) setError(problem instanceof Error ? problem.message : 'Scan failed.');
    } finally { if (controller.current === current) setBusy(false); }
  }

  async function propose(files: string[]) {
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError('');
    try {
      for (const file of files) {
        const finding = findings.find(row => row.fileName === file);
        if (!finding || !finding.issues.length || finding.runId) continue;
        current.signal.throwIfAborted();
        setStatus(`Proposing repairs for ${finding.title}…`);
        try {
          const manualPatches = finding.issues.flatMap(issue => Object.hasOwn(drafts, `${file}:${issue.id}`)
            ? [{ id: issue.id, replacement: drafts[`${file}:${issue.id}`] }] : []);
          const result = await request({ action: 'propose', fileName: file, hash: finding.hash, manualPatches }, current.signal);
          current.signal.throwIfAborted();
          setFindings(previous => previous.map(row => row.fileName === file ? { ...row, runId: result.runId, error: undefined } : row));
          setSelected(previous => previous.filter(item => item !== file));
        } catch (problem) {
          if (current.signal.aborted) throw problem;
          setFindings(previous => previous.map(row => row.fileName === file ? { ...row, error: problem instanceof Error ? problem.message : 'Repair failed.' } : row));
        }
      }
      setStatus('Proposals are ready to review. Chapter text and audio change only after approval.');
    } catch { setStatus('Stopped. Completed proposals remain available in Review AI Changes.'); }
    finally { if (controller.current === current) setBusy(false); }
  }

  async function resume(finding: Finding) {
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError('');
    try {
      await request({ action: 'resume', fileName: finding.fileName }, current.signal);
      setStatus('Generation requeued. Completed chapters will be preserved.'); onRecordingQueued();
    } catch (problem) { if (!current.signal.aborted) setError(problem instanceof Error ? problem.message : 'Resume failed.'); }
    finally { if (controller.current === current) setBusy(false); }
  }

  return <>
    <ModalFrame open={open && !reviewRun} onClose={onClose} size="xl">
      <div className="max-h-[90vh] overflow-y-auto rounded-xl border border-line-soft bg-surface p-5 text-text-strong">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Scan Pronunciation Issues</h2><button onClick={onClose} aria-label="Close pronunciation scan">Close</button></div>
        <p className="my-3 text-sm text-text-soft">Check saved chapters and retained failed output for leftover Greek/Hebrew and broken pronunciation tags. Scanning uses no AI. Proposals use dictionary matches first, and send only affected chapters to Gemini when needed. Review every proposal before recording.</p>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => void scan()} className="rounded bg-accent px-3 py-2 text-background disabled:opacity-50">{scanned ? 'Scan Again' : 'Start Scan'}</button>
          <button disabled={busy || !selected.length} onClick={() => void propose(selected)} className="rounded border border-line-soft px-3 py-2 disabled:opacity-50">Propose Repairs ({selected.length})</button>
          {busy && <button onClick={() => { controller.current?.abort(); setStatus('Stopping. Completed results are retained.'); }} className="rounded border border-line-soft px-3 py-2">Stop</button>}
        </div>
        <p role="status" className="my-3 text-sm text-text-soft">{status}</p>
        {error && <p role="alert" className="my-3 text-danger">{error}</p>}
        {scanned && findings.length === 0 && <p>No pronunciation issues found in the checked text.</p>}
        <div className="space-y-4">{findings.map(finding => <article key={finding.fileName} className="rounded border border-line-soft p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input type="checkbox" aria-label={`Select ${finding.title}`} disabled={busy || !finding.issues.length || Boolean(finding.runId)} checked={selected.includes(finding.fileName)} onChange={event => setSelected(previous => event.target.checked ? [...previous, finding.fileName] : previous.filter(file => file !== finding.fileName))} />
            <h3 className="font-semibold">{finding.chapterIndex + 1}. {finding.title}</h3>
            <span className="text-sm text-text-soft">{finding.issues.length} findings{finding.failed ? ' · Rejected generation output' : ''}</span>
            {finding.audioStatus && <span className="text-sm text-text-soft">Recording: {finding.audioStatus.replaceAll('_', ' ')}</span>}
            {finding.runId && <button onClick={() => setReviewRun(finding.runId!)} className="ml-auto text-accent">Review &amp; Approve</button>}
          </div>
          {finding.failureError && <p className="mt-2 text-sm text-text-soft">Generation error: {finding.failureError}</p>}
          {finding.error && <p role="alert" className="mt-2 text-sm text-danger">{finding.error}</p>}
          {finding.failed && finding.issues.length === 0 && <p className="mt-2 text-sm text-text-soft">No supported pronunciation defect detected. This failure may need source or speaker review.</p>}
          {finding.issues.map(issue => <details key={issue.id} className="mt-3 rounded border border-line-soft p-2">
            <summary className="cursor-pointer text-sm">{issue.reason} · {issue.replacement !== undefined ? 'Dictionary/formatting repair available' : 'AI or manual review needed'}</summary>
            <pre className="my-2 whitespace-pre-wrap text-xs">{issue.context}</pre>
            <p className="text-xs text-text-soft">Exact affected text: <code>{issue.text}</code></p>
            {issue.replacement !== undefined && <pre className="mt-2 whitespace-pre-wrap text-xs">Suggested: {issue.replacement || '(remove empty punctuation)'}</pre>}
            <button disabled={busy || Boolean(finding.runId)} onClick={() => setDrafts(previous => ({ ...previous, [`${finding.fileName}:${issue.id}`]: issue.replacement ?? issue.text }))} className="mt-2 text-sm text-accent">Enter a manual replacement</button>
            {Object.hasOwn(drafts, `${finding.fileName}:${issue.id}`) && <label className="mt-2 block text-xs">Replacement for this finding
              <textarea disabled={busy || Boolean(finding.runId)} value={drafts[`${finding.fileName}:${issue.id}`]} onChange={event => setDrafts(previous => ({ ...previous, [`${finding.fileName}:${issue.id}`]: event.target.value }))} className="mt-1 w-full rounded border border-line-soft bg-surface p-2 font-mono text-sm" />
            </label>}
          </details>)}
          {finding.jobId && <button disabled={busy} onClick={() => void resume(finding)} className="mt-3 text-sm text-accent disabled:opacity-50">Resume generation after repair recording completes</button>}
        </article>)}</div>
      </div>
    </ModalFrame>
    <BatchRefineReviewModal open={open && Boolean(reviewRun)} onClose={() => setReviewRun(null)} bookId={bookId} runId={reviewRun} onRecordingQueued={onRecordingQueued} />
  </>;
}
