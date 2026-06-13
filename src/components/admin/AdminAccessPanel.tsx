'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Section, Button, Input } from '@/components/ui';

const ADMIN_SETTINGS_QUERY_KEY = ['admin-settings'] as const;

async function fetchAdminSettings(): Promise<{ values: Record<string, unknown> }> {
  const res = await fetch('/api/admin/settings');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { values: Record<string, unknown> };
}

async function saveAllowedEmails(emails: string[]): Promise<void> {
  const res = await fetch('/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates: { allowedEmails: emails } }),
  });
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`);
}

function parseEmailInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

function parseCsv(text: string): string[] {
  // Accept any CSV structure — grab anything that looks like an email
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) ?? [];
  return matches.map((e) => e.toLowerCase());
}

export function AdminAccessPanel() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ADMIN_SETTINGS_QUERY_KEY,
    queryFn: fetchAdminSettings,
  });

  // Current DB-managed list
  const [emails, setEmails] = useState<string[]>([]);
  // Input field for adding emails
  const [inputValue, setInputValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data) return;
    const raw = data.values.allowedEmails;
    setEmails(Array.isArray(raw) ? (raw as string[]) : []);
  }, [data]);

  useEffect(() => {
    if (error) toast.error('Failed to load access settings');
  }, [error]);

  const saveMutation = useMutation({
    mutationFn: saveAllowedEmails,
    onSuccess: async () => {
      toast.success('Access list saved');
      await queryClient.invalidateQueries({ queryKey: ADMIN_SETTINGS_QUERY_KEY });
    },
    onError: () => toast.error('Failed to save access list'),
  });

  const addEmails = (toAdd: string[]) => {
    const existing = new Set(emails);
    const newOnes = toAdd.filter((e) => !existing.has(e));
    if (newOnes.length === 0) {
      toast('All emails already in the list', { icon: 'ℹ️' });
      return;
    }
    setEmails((prev) => [...prev, ...newOnes]);
    setInputValue('');
    toast.success(`Added ${newOnes.length} email${newOnes.length > 1 ? 's' : ''}`);
  };

  const handleAdd = () => {
    const parsed = parseEmailInput(inputValue);
    if (parsed.length === 0) {
      toast.error('No valid email addresses found');
      return;
    }
    addEmails(parsed);
  };

  const handleRemove = (email: string) => {
    setEmails((prev) => prev.filter((e) => e !== email));
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        toast.error('No email addresses found in CSV');
        return;
      }
      addEmails(parsed);
    };
    reader.readAsText(file);
    // Reset so same file can be re-uploaded
    e.target.value = '';
  };

  const handleSave = () => {
    saveMutation.mutate(emails);
  };

  const handleClear = () => {
    if (!confirm('Remove all emails from the allowlist?')) return;
    setEmails([]);
  };

  const saving = saveMutation.isPending;
  const hasEnvVar = false; // We can't check env vars from the client; shown as a note

  return (
    <div className="space-y-4 mt-2">
      <Section title="Email Allowlist">
        <div className="space-y-3">
          {/* Header + description */}
          <div>
            <p className="text-xs text-soft mt-1">
              When this list is non-empty, only users with a matching email address can create an
              account. Leave it empty to use the &ldquo;Allow user signups&rdquo; toggle in Site Features instead.
              Entries from the <code className="font-mono text-accent">ALLOWED_EMAILS</code> env var are
              also enforced and are additive with this list.
            </p>
          </div>

          {/* Add by typing */}
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="alice@example.com, bob@example.com"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
              className="flex-1 text-sm"
            />
            <Button variant="outline" size="sm" onClick={handleAdd} disabled={saving}>
              Add
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
              title="Upload a CSV file containing email addresses"
            >
              Upload CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={handleCsvUpload}
            />
          </div>

          {/* Current list */}
          {emails.length > 0 ? (
            <div className="rounded-lg border border-line bg-background p-3 space-y-1 max-h-64 overflow-y-auto">
              {emails.map((email) => (
                <div
                  key={email}
                  className="flex items-center justify-between gap-2 group py-0.5"
                >
                  <span className="text-sm font-mono text-foreground truncate">{email}</span>
                  <button
                    onClick={() => handleRemove(email)}
                    className="text-soft hover:text-danger transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 text-xs px-1"
                    title="Remove"
                    aria-label={`Remove ${email}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-line border-dashed bg-background p-4 text-center">
              <p className="text-xs text-soft">
                No emails in the allowlist — signups are controlled by the Site Features toggle.
              </p>
            </div>
          )}

          {/* Count + actions */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-soft">
              {emails.length} email{emails.length !== 1 ? 's' : ''} in list
            </span>
            <div className="flex gap-2">
              {emails.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleClear} disabled={saving}>
                  Clear all
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>

          {hasEnvVar && (
            <p className="text-xs text-accent bg-accent-wash border border-accent-line rounded p-2">
              The <code className="font-mono">ALLOWED_EMAILS</code> environment variable is also
              active. Those addresses are always allowed regardless of this list.
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}
