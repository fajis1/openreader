'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';

export function AdminLogsPanel() {
  const { data: logs, error, mutate, isLoading } = useSWR('/api/admin/logs', (url: string) => fetch(url).then(res => res.json()));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-medium text-foreground">Troubleshooting Logs</h3>
        <Button onClick={() => mutate()} size="sm" variant="secondary" className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </Button>
      </div>

      <div className="bg-surface-sunken border border-line rounded-lg overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="p-8 text-center text-soft">Loading system logs...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">Failed to load logs.</div>
        ) : !logs || logs.length === 0 ? (
          <div className="p-8 text-center text-soft">No logs found. The system is running smoothly!</div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-surface sticky top-0 border-b border-line shadow-sm">
                <tr>
                  <th className="px-4 py-2 font-medium text-soft w-32">Time</th>
                  <th className="px-4 py-2 font-medium text-soft w-24">Severity</th>
                  <th className="px-4 py-2 font-medium text-soft w-32">Context</th>
                  <th className="px-4 py-2 font-medium text-soft">Message / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-accent-wash/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-soft align-top">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold tracking-wide uppercase ${
                        log.severity === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                        log.severity === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}>
                        {log.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground align-top capitalize">
                      {log.context}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="text-foreground font-medium mb-1">{log.message}</div>
                      {log.details && (
                        <pre className="text-[10px] text-soft bg-surface border border-line rounded p-2 overflow-x-auto whitespace-pre-wrap mt-1 font-mono">
                          {log.details}
                        </pre>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
