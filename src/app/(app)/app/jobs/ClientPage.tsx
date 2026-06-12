'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';

interface Job {
  id: string;
  documentId: string;
  status: string;
  createdAt: number;
  progress?: number;
  error?: string;
}

export function JobsClientPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Background Audiobooks</h1>
        <Button variant="ghost" onClick={() => router.push('/app')}>Back to Documents</Button>
      </div>

      {loading ? (
        <div className="text-soft">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="text-soft bg-surface-sunken p-8 rounded-lg text-center border border-line">
          No background jobs in the queue.
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const isQueued = job.status === 'queued';
            const position = isQueued ? jobs.filter(j => j.status === 'queued' && j.createdAt <= job.createdAt).length : null;

            return (
              <div key={job.id} className="bg-surface p-4 rounded-lg border border-line shadow-sm flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Document ID: {job.documentId.substring(0, 8)}...</h3>
                  <div className="text-sm text-soft mt-1">
                    Status: <span className="uppercase font-semibold text-accent">{job.status}</span>
                    {isQueued && position && (
                      <span className="ml-3">Queue Position: #{position}</span>
                    )}
                    {job.status === 'running' && (
                      <span className="ml-3">Progress: {Math.round(job.progress || 0)}%</span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-soft">
                  Created: {new Date(job.createdAt).toLocaleString()}
                  {job.error && <p className="text-danger mt-1">Error: {job.error}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
