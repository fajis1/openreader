"use client";

import { useEffect, useRef, useState } from 'react';
import { ModalFrame } from '@/components/ui';
import { BatchRefineReviewModal } from './BatchRefineReviewModal';
import type { PronunciationIssue } from '@/lib/shared/pronunciation-issues';
import { PRESET_MODELS } from '@/components/constants';
import { readJsonResponse } from '@/lib/client/read-json-response';
import { v4 as uuidv4 } from 'uuid';

type Chapter = { fileName: string; chapterIndex: number; failed: boolean };
type Finding = Chapter & { title: string; hash: string; issues: PronunciationIssue[]; jobId?: string; failureError?: string; runId?: string; audioStatus?: string; error?: string };
type RepairConfig = { selectedProfileId: string; profiles: { id: string; name: string; model: string; primaryKeyRef: string; backupKeyRef: string }[]; keySources: { ref: string; label: string; masked: string }[] };
type RepairJob = { id: string; status: string; progress: number; total: number; error?: string; profileId?: string; aiModel?: string; primaryKeyRef?: string; backupKeyRef?: string; results: { fileName: string; runId?: string; error?: string; requestId: string }[] };

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
  const [config, setConfig] = useState<RepairConfig | null>(null);
  const [selection, setSelection] = useState({ profileId: profileId || '', aiModel: '', primaryKeyRef: '', backupKeyRef: '' });
  const [job, setJob] = useState<RepairJob | null>(null);
  const [reportJobs, setReportJobs] = useState<RepairJob[]>([]);
  const [reportJobId, setReportJobId] = useState('');
  const [reportDownloading, setReportDownloading] = useState(false);
  const reportController = useRef<AbortController | null>(null);
  const jobVersion = useRef('');
  const activeRepair = job?.status === 'queued' || job?.status === 'running';

  useEffect(() => {
    if (!open) return;
    const current = new AbortController();
    void fetch(`/api/audiobooks/pronunciation-issues?bookId=${encodeURIComponent(bookId)}&action=config`, { signal: current.signal, cache: 'no-store' })
      .then(readJsonResponse).then((value: RepairConfig) => {
        if (current.signal.aborted) return;
        setConfig(value);
        const profile = value.profiles.find(item => item.id === profileId) || value.profiles.find(item => item.id === value.selectedProfileId) || value.profiles[0];
        if (profile) setSelection({ profileId: profile.id, aiModel: profile.model, primaryKeyRef: profile.primaryKeyRef, backupKeyRef: profile.backupKeyRef });
      }).catch(problem => { if (!current.signal.aborted) setError(problem.message); });
    return () => current.abort();
  }, [open, bookId, profileId]);

  useEffect(() => {
    if (!open) return;
    const current = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await fetch(`/api/audiobooks/pronunciation-issues?bookId=${encodeURIComponent(bookId)}&action=jobs`, { signal: current.signal, cache: 'no-store' }).then(readJsonResponse);
        if (current.signal.aborted) return;
        const latest: RepairJob | undefined = value.jobs[0];
        setReportJobs(value.jobs);
        setJob(latest || null);
        const version = JSON.stringify(latest);
        if (latest && version !== jobVersion.current) {
          jobVersion.current = version;
          setFindings(previous => {
            const next = [...previous];
            for (const result of latest.results) {
              const index = next.findIndex(row => row.fileName === result.fileName);
              const chapterIndex = Number(result.fileName.split('__')[0]) - 1;
              const row = index >= 0 ? next[index] : { fileName: result.fileName, chapterIndex, title: `Chapter ${chapterIndex + 1}`, hash: '', issues: [], failed: result.fileName.endsWith('__rejected.txt') };
              const updated = { ...row, runId: result.runId, error: result.error ? `${result.error} Reference: ${result.requestId}` : undefined };
              if (index >= 0) next[index] = updated; else next.push(updated);
            }
            return next;
          });
          setSelected(previous => previous.filter(file => !latest.results.some(result => result.fileName === file && result.runId)));
          const ready = latest.results.filter(result => result.runId).length;
          const failed = latest.results.filter(result => result.error).length;
          setStatus(`Repair job ${latest.status}: ${latest.results.length}/${latest.total} checked; ${ready} proposals ready; ${failed} failed. ${latest.status === 'queued' || latest.status === 'running' ? 'You can close this window; work continues in the background.' : 'Review saved proposals or scan again to retry failed chapters.'}`);
        }
      } catch (problem) { if (!current.signal.aborted) setError(problem instanceof Error ? problem.message : 'Could not load repair progress.'); }
      finally { if (!current.signal.aborted) timer = setTimeout(() => void poll(), 3000); }
    };
    void poll();
    return () => { current.abort(); clearTimeout(timer); };
  }, [open, bookId]);

  useEffect(() => {
    if (!open) controller.current?.abort();
    if (!open) reportController.current?.abort();
    return () => { controller.current?.abort(); reportController.current?.abort(); };
  }, [open]);
  useEffect(() => {
    controller.current?.abort();
    setFindings([]); setSelected([]); setDrafts({}); setScanned(false); setStatus(''); setError(''); setReviewRun(null);
    setJob(null); jobVersion.current = '';
    setReportJobs([]); setReportJobId('');
    reportController.current?.abort();
  }, [bookId, profileId]);

  async function request(body: Record<string, unknown>, signal: AbortSignal) {
    const response = await fetch('/api/audiobooks/pronunciation-issues', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId, ...selection, ...body }) });
    return readJsonResponse(response);
  }

  async function downloadReport() {
    const id = reportJobId || reportJobs[0]?.id;
    if (!id) return;
    const current = new AbortController();
    reportController.current?.abort(); reportController.current = current;
    setReportDownloading(true); setError('');
    try {
      const report = await fetch(`/api/audiobooks/pronunciation-issues?bookId=${encodeURIComponent(bookId)}&action=report&jobId=${encodeURIComponent(id)}`, { signal: current.signal, cache: 'no-store' }).then(readJsonResponse);
      current.signal.throwIfAborted();
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `pronunciation-repair-${id}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (problem) { if (!current.signal.aborted) setError(problem instanceof Error ? problem.message : 'Could not download repair report.'); }
    finally { if (reportController.current === current) setReportDownloading(false); }
  }

  async function scan() {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError(''); setFindings([]); setSelected([]); setDrafts({}); setScanned(false);
    try {
      const response = await fetch(`/api/audiobooks/pronunciation-issues?bookId=${encodeURIComponent(bookId)}`, { signal: current.signal, cache: 'no-store' });
      const catalog = await readJsonResponse(response);
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
      const chapters = findings.filter(row => files.includes(row.fileName) && row.issues.length && !row.runId).map(row => ({
        fileName: row.fileName, hash: row.hash, manualPatches: row.issues.flatMap(issue => Object.hasOwn(drafts, `${row.fileName}:${issue.id}`)
          ? [{ id: issue.id, replacement: drafts[`${row.fileName}:${issue.id}`] }] : []),
      }));
      const result = await request({ action: 'queue', requestId: uuidv4(), chapters }, current.signal);
      setJob({ ...selection, id: result.jobId, status: 'queued', progress: 0, total: chapters.length, results: [] });
      setStatus('Repairs queued. You can close this window; proposals will appear as chapters finish. Approval is still required.');
    } catch (problem) { if (!current.signal.aborted) setError(problem instanceof Error ? problem.message : 'Could not queue repairs.'); }
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
        {config && !activeRepair && <fieldset disabled={busy} className="my-3 space-y-2">
          <label className="block text-sm">Profile<select aria-label="Repair profile" className="ml-2 rounded border border-line-soft bg-surface p-2" value={selection.profileId} onChange={event => {
            const profile = config.profiles.find(item => item.id === event.target.value)!;
            setSelection({ profileId: profile.id, aiModel: profile.model, primaryKeyRef: profile.primaryKeyRef, backupKeyRef: profile.backupKeyRef });
            setFindings([]); setSelected([]); setDrafts({}); setScanned(false);
          }}>{config.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label className="block text-sm">AI Model<input aria-label="Repair AI model" list="pronunciation-repair-models" value={selection.aiModel} onChange={event => setSelection(previous => ({ ...previous, aiModel: event.target.value }))} className="ml-2 rounded border border-line-soft bg-surface p-2" /></label>
          <datalist id="pronunciation-repair-models">{PRESET_MODELS.filter(model => model.id !== 'custom').map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
          {(['primaryKeyRef', 'backupKeyRef'] as const).map((field, index) => <label key={field} className="block text-sm">{index === 0 ? 'Primary Gemini key' : 'Backup Gemini key'}<select aria-label={index === 0 ? 'Primary Gemini key' : 'Backup Gemini key'} className="ml-2 rounded border border-line-soft bg-surface p-2" value={selection[field]} onChange={event => setSelection(previous => ({ ...previous, [field]: event.target.value }))}>
            <option value="">Not set</option>{config.keySources.map(key => <option key={key.ref} value={key.ref}>{key.label} ({key.masked})</option>)}
          </select></label>)}
          <p className="text-xs text-text-soft">These choices apply only to this repair job, including failed chapters. Add or change saved keys in AI Settings. Scanning and dictionary/manual-only repairs do not call Gemini.</p>
        </fieldset>}
        <div className="flex flex-wrap gap-3">
          <button disabled={busy || activeRepair || !config} onClick={() => void scan()} className="rounded bg-accent px-3 py-2 text-background disabled:opacity-50">{scanned ? 'Scan Again' : 'Start Scan'}</button>
          <button disabled={busy || activeRepair || !config || !selected.length} onClick={() => void propose(selected)} className="rounded border border-line-soft px-3 py-2 disabled:opacity-50">Propose Repairs ({selected.length})</button>
          {activeRepair && <button disabled={busy} onClick={() => {
            void request({ action: 'stop', jobId: job.id }, new AbortController().signal).then(() => setStatus('Stop requested. Saved proposals are retained.')).catch(problem => setError(problem.message));
          }} className="rounded border border-line-soft px-3 py-2">Stop repair job</button>}
          {busy && <button onClick={() => { controller.current?.abort(); setStatus('Stopping. Completed results are retained.'); }} className="rounded border border-line-soft px-3 py-2">Stop</button>}
        </div>
        <p role="status" className="my-3 text-sm text-text-soft">{status}</p>
        {job && <p className="text-xs text-text-soft">Job: {job.id} · {job.status} · {job.progress}%{activeRepair ? ' · Wait until the job stops before approving recordings.' : ''}</p>}
        {reportJobs.length > 0 && <div className="my-3 space-y-2 text-sm">
          <label>Report for job <select aria-label="Repair report job" value={reportJobId || reportJobs[0].id} onChange={event => setReportJobId(event.target.value)} className="rounded border border-line-soft bg-surface p-1">
            {reportJobs.map(item => <option key={item.id} value={item.id}>{item.id} · {item.status}</option>)}
          </select></label>
          <button disabled={reportDownloading} className="ml-3 text-accent underline disabled:opacity-50" onClick={() => void downloadReport()}>{reportDownloading ? 'Preparing report…' : 'Download repair report'}</button>
          <p className="text-xs text-text-soft">Includes saved errors, finding/replacement details and the Gemini instructions when retained. Older attempts may have only summary errors. Contains book excerpts—review before sharing.</p>
        </div>}
        {job?.aiModel && <p className="text-xs text-text-soft">Job model: {job.aiModel} · Profile: {config?.profiles.find(profile => profile.id === job.profileId)?.name || job.profileId} · Keys: {config?.keySources.find(key => key.ref === job.primaryKeyRef)?.masked || 'Not set'} / {config?.keySources.find(key => key.ref === job.backupKeyRef)?.masked || 'Not set'}</p>}
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
