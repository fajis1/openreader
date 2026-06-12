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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTimeRemaining = (now: number, startedAt: number, updatedAt: number, progressPercent: number) => {
    const activeMsAtLastUpdate = Math.max(0, updatedAt - startedAt);
    if (progressPercent <= 0 || activeMsAtLastUpdate <= 0) return 'Calculating...';
    const totalEstimatedMs = activeMsAtLastUpdate / (progressPercent / 100);
    const elapsedSinceStart = now - startedAt;
    const remainingMs = totalEstimatedMs - elapsedSinceStart;
    if (remainingMs <= 0) return 'Almost done...';
    
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
              const position = isQueued ? jobs.filter(j => j.status === 'queued' && j.createdAt <= job.createdAt).length : null;

              return (
                <div key={job.id} className="bg-surface p-4 rounded-lg border border-line shadow-sm flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-foreground">{job.documentTitle || `Document ID: ${job.documentId.substring(0, 8)}...`}</h3>
                    <div className="text-sm text-soft mt-2 flex flex-col gap-2">
                      <div className="flex items-center">
                        Status: <span className="uppercase font-semibold text-accent ml-1">{job.status}</span>
                        {isQueued && position && (
                          <span className="ml-3 px-2 py-0.5 rounded-full bg-surface-sunken border border-line text-xs">Position: #{position}</span>
                        )}
                        {job.status === 'running' && job.startedAt && job.progress ? (
                          <span className="ml-3 text-faint">
                            (~{formatTimeRemaining(now, job.startedAt, job.updatedAt || job.startedAt, job.progress)} remaining)
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
                    <div className="mt-2 flex gap-2">
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
