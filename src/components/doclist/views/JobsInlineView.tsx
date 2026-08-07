'use client';

import { useState, useEffect } from 'react';

interface Job {
  id: string;
  documentId: string;
  status: string;
  createdAt: number;
  startedAt?: number;
  updatedAt?: number;
  progress?: number;
  error?: string;
  documentTitle?: string;
}

export function JobsInlineView() {
  const onRequeueJob = async (id: string) => {
    try {
      await fetch('/api/audiobooks/queue', { method: 'PUT', body: JSON.stringify({ id }) });
    } catch {}
  };
  const onCancelJob = async (id: string) => {
    try {
      await fetch(`/api/audiobooks/queue?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {}
  };
  const onTogglePauseJob = async (id: string, action: 'pause' | 'resume') => {
    try {
      await fetch('/api/audiobooks/queue', { method: 'PATCH', body: JSON.stringify({ id, action }) });
    } catch {}
  };
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeGlobalJob, setActiveGlobalJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const getRemainingMs = (now: number, startedAt: number, updatedAt: number, progressPercent: number) => {
    const activeMsAtLastUpdate = Math.max(0, updatedAt - startedAt);
    if (progressPercent <= 0 || activeMsAtLastUpdate <= 0) return -1;
    const totalEstimatedMs = activeMsAtLastUpdate / (progressPercent / 100);
    const elapsedSinceStart = now - startedAt;
    return Math.max(0, totalEstimatedMs - elapsedSinceStart);
  };

  const formatMs = (remainingMs: number) => {
    if (remainingMs < 0) return 'Calculating...';
    if (remainingMs === 0) return 'Almost done...';
    const remainingMins = Math.floor(remainingMs / 60000);
    const remainingSecs = Math.floor((remainingMs % 60000) / 1000);
    if (remainingMins > 60) {
      const hrs = Math.floor(remainingMins / 60);
      const mins = remainingMins % 60;
      return `${hrs}h ${mins}m`;
    }
    return `${remainingMins}m ${remainingSecs}s`;
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch('/api/audiobooks/queue');
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
        setActiveGlobalJob(data.activeGlobalJob || null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Background Audiobooks Queue</h1>

        {loading ? (
          <div className="text-soft">Loading jobs...</div>
        ) : jobs.length === 0 ? (
          <div className="text-soft bg-surface-sunken p-8 rounded-lg text-center border border-line">
            No background jobs in the queue.
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => {
              const isQueued = job.status === 'queued' || job.status === 'waiting_for_pdf';
              const globalPosition = (job as any).globalQueuePosition;
              
              let queueEtaStr = '';
              if (isQueued && globalPosition && activeGlobalJob && typeof activeGlobalJob.progress === 'number' && activeGlobalJob.progress > 0) {
                const activeRemainingMs = getRemainingMs(now, activeGlobalJob.startedAt, activeGlobalJob.updatedAt || activeGlobalJob.startedAt, activeGlobalJob.progress);
                if (activeRemainingMs >= 0) {
                  const activeTotalMs = activeRemainingMs + (now - activeGlobalJob.startedAt);
                  const myWaitMs = activeRemainingMs + (activeTotalMs * (globalPosition - 1));
                  queueEtaStr = formatMs(myWaitMs);
                }
              }

              return (
                <div key={job.id} className="bg-surface p-4 rounded-lg border border-line shadow-sm flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-foreground">{job.documentTitle || `Document ID: ${job.documentId.substring(0, 8)}...`}</h3>
                    <div className="text-sm text-soft mt-2 flex flex-col gap-2">
                      <div className="flex items-center">
                        Status: <span className="uppercase font-semibold text-accent ml-1">{job.status}</span>
                        {isQueued && globalPosition ? (
                          <span className="ml-3 px-2 py-0.5 rounded-full bg-surface-sunken border border-line text-xs">Queue Position: #{globalPosition}</span>
                        ) : null}
                        {queueEtaStr ? (
                          <span className="ml-3 text-faint">
                            (~{queueEtaStr} remaining before processing)
                          </span>
                        ) : null}
                        {job.status === 'running' && job.startedAt && typeof job.progress === 'number' ? (
                          <span className="ml-3 text-faint">
                            ({Math.round(job.progress || 0)}% done &bull; ~{formatMs(getRemainingMs(now, job.startedAt, job.updatedAt || job.startedAt, job.progress))} remaining)
                          </span>
                        ) : null}
                      </div>
                      
                      {job.status === 'running' && (
                        <div className="w-full max-w-sm h-1.5 bg-surface-sunken rounded-full overflow-hidden mt-1 border border-line">
                          <div 
                            className="h-full bg-accent" 
                            style={{ width: `${Math.round(job.progress || 0)}%`, transition: 'width 1000ms linear' }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-soft">
                    Created: {new Date(job.createdAt).toLocaleString()}
                    {job.error && <p className="text-danger mt-1">Error: {job.error}</p>}
                    <div className="mt-2 flex gap-2 justify-end">
                      {['queued', 'running', 'paused'].includes(job.status) && (
                        <a href={`/listen/${job.documentId}`} className="text-accent font-semibold hover:underline bg-surface-sunken border border-accent px-2 py-1 rounded">
                          Review Progress
                        </a>
                      )}
                      {['queued', 'running', 'waiting_for_pdf'].includes(job.status) && (
                        <button onClick={() => { onTogglePauseJob(job.id, 'pause'); fetchJobs(); }} className="text-warning font-semibold hover:underline bg-surface-sunken border border-warning px-2 py-1 rounded">
                          Pause
                        </button>
                      )}
                      {job.status === 'paused' && (
                        <button onClick={() => { onTogglePauseJob(job.id, 'resume'); fetchJobs(); }} className="text-success font-semibold hover:underline bg-surface-sunken border border-success px-2 py-1 rounded">
                          Resume
                        </button>
                      )}
                      <button onClick={() => { onCancelJob(job.id); fetchJobs(); }} className="text-danger font-semibold hover:underline bg-surface-sunken border border-danger px-2 py-1 rounded">
                        {job.status === 'error' ? 'Dismiss' : 'Cancel Generation'}
                      </button>
                      {job.status === 'error' && (
                        <button onClick={() => { onRequeueJob(job.id); fetchJobs(); }} className="text-accent font-semibold hover:underline bg-surface-sunken border border-accent px-2 py-1 rounded">
                          Requeue
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
