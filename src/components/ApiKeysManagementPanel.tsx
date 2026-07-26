'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Input, Select, Card } from '@/components/ui';
import { KeyIcon } from '@/components/icons/Icons';
import toast from 'react-hot-toast';

interface ApiKeyItem {
  id: string;
  name: string;
  keyLast4: string;
  expiresAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export function ApiKeysManagementPanel() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [keyName, setKeyName] = useState('');
  const [expirationDays, setExpirationDays] = useState<number>(0);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/user/api-keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    try {
      setIsCreating(true);
      const res = await fetch('/api/user/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: keyName.trim(),
          expirationDays: expirationDays > 0 ? expirationDays : null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to create API key');
        return;
      }

      setNewlyCreatedKey(data.apiKey.rawKey);
      setKeyName('');
      toast.success('API key created successfully!');
      void fetchKeys();
    } catch (err) {
      toast.error('An error occurred while creating the API key.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key? External applications using it will lose access.')) {
      return;
    }

    try {
      const res = await fetch(`/api/user/api-keys?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('API key revoked.');
        void fetchKeys();
      } else {
        toast.error('Failed to revoke API key.');
      }
    } catch (err) {
      toast.error('Failed to revoke API key.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
          <KeyIcon className="w-5 h-5 text-accent" />
          API & Automation Keys
        </h3>
        <p className="text-xs text-soft mt-1">
          Generate Bearer tokens to upload documents headlessly from automated scripts (Logos export pipelines, cURL, Python).
        </p>
      </div>

      {/* Creation Modal / Callout for Newly Created Key */}
      {newlyCreatedKey && (
        <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-2">
          <p className="text-sm font-semibold text-emerald-400">
            🔑 Save your API Key now! It will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-surface border border-line px-3 py-1.5 rounded text-xs font-mono text-foreground break-all select-all">
              {newlyCreatedKey}
            </code>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(newlyCreatedKey);
                toast.success('API key copied to clipboard');
              }}
            >
              Copy
            </Button>
          </div>
        </div>
      )}

      {/* Create Key Form */}
      <form onSubmit={handleCreateKey} className="p-4 rounded-lg border border-line bg-surface-sunken space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-soft">Generate New Key</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-soft mb-1">Key Name / Description</label>
            <Input
              type="text"
              placeholder="e.g. Logos Desktop Automation"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-soft mb-1">Expiration</label>
            <select
              value={expirationDays.toString()}
              onChange={(e) => setExpirationDays(parseInt(e.target.value, 10))}
              className="w-full bg-surface-sunken border border-line rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-line hover:bg-accent-wash transition-colors duration-fast ease-standard"
            >
              <option value="0">Never Expires</option>
              <option value="30">30 Days</option>
              <option value="90">90 Days</option>
              <option value="365">1 Year</option>
            </select>
          </div>
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={isCreating || !keyName.trim()}>
          {isCreating ? 'Generating...' : 'Create API Key'}
        </Button>
      </form>

      {/* Keys List */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-soft">Active Keys</h4>
        {isLoading ? (
          <p className="text-xs text-soft animate-pulse">Loading API keys...</p>
        ) : keys.length === 0 ? (
          <p className="text-xs text-soft italic">No API keys created yet.</p>
        ) : (
          <div className="divide-y divide-line border border-line rounded-lg overflow-hidden bg-surface">
            {keys.map((k) => (
              <div key={k.id} className="p-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{k.name}</span>
                    <span className="text-xs font-mono text-soft bg-surface-sunken px-1.5 py-0.5 rounded">
                      •••• {k.keyLast4}
                    </span>
                  </div>
                  <div className="text-[11px] text-soft mt-0.5 flex flex-wrap items-center gap-2">
                    <span>Created: {new Date(k.createdAt).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>
                      {k.expiresAt
                        ? `Expires: ${new Date(k.expiresAt).toLocaleDateString()}`
                        : 'Never expires'}
                    </span>
                    {k.lastUsedAt && (
                      <>
                        <span>•</span>
                        <span>Last used: {new Date(k.lastUsedAt).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="secondary"
                  className="text-red-500 hover:text-red-600 hover:bg-red-500/10 shrink-0"
                  onClick={() => handleRevokeKey(k.id)}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 rounded-lg border border-line bg-surface text-xs text-soft space-y-1">
        <p className="font-semibold text-foreground">💡 How to use with cURL:</p>
        <code className="block bg-surface-sunken p-2 rounded font-mono text-[11px] text-foreground select-all overflow-x-auto">
          curl -X POST https://your-domain.com/api/v1/upload \<br />
          &nbsp;&nbsp;-H "Authorization: Bearer OR_YOUR_GENERATED_KEY" \<br />
          &nbsp;&nbsp;-F "file=@/path/to/document.pdf" \<br />
          &nbsp;&nbsp;-F "title=Genesis 1 Export"
        </code>
      </div>
    </div>
  );
}
