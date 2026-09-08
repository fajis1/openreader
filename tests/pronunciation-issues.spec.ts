import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

for (const mode of ['complete', 'manual', 'retry']) test(`scan carries repair through approval (${mode})`, async ({ page }) => {
  const partial = mode !== 'complete';
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  // Exercise the actual React modals with fixture APIs: no paid AI/TTS calls
  // and no writes to a user's audiobook are needed for this interaction test.
  const bundle = await build({
    stdin: { contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {PronunciationIssuesModal} from './src/components/audiobooks/PronunciationIssuesModal';
      function App() { const [open,setOpen]=useState(true); const [queued,setQueued]=useState(0);
        return <><button onClick={()=>setOpen(true)}>Open scan</button><span data-testid="queued">{queued}</span>
        <PronunciationIssuesModal open={open} onClose={()=>setOpen(false)} bookId="fixture-book" profileId="fixture-profile" onRecordingQueued={()=>setQueued(n=>n+1)}/></>; }
      createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, outfile: '/tmp/pronunciation-issues-fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': path.join(process.cwd(), 'src') }, define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  });
  const proposedFiles: string[] = [];
  let queued = false;
  let queuedSettings: Record<string, unknown> = {};
  let approved = false;
  let retried = false;
  await page.route('http://localhost/**', async route => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    if (url.pathname.endsWith('/pronunciation-issues')) {
      if (url.searchParams.get('action') === 'report') return route.fulfill({ contentType: 'application/json', headers: { 'Content-Disposition': 'attachment; filename="pronunciation-repair-fixture-job.json"' }, body: JSON.stringify({ jobId: 'fixture-job', summary: { failures: 0, proposals: 1 } }) });
      if (url.searchParams.get('action') === 'config') return json({ selectedProfileId: 'fixture-profile', profiles: [{ id: 'fixture-profile', name: 'Scholar', model: 'gemini-3.8-flash', primaryKeyRef: 'fixture-profile:primary', backupKeyRef: '' }], keySources: [{ ref: 'fixture-profile:primary', label: 'Scholar primary', masked: '...1111' }, { ref: 'other:primary', label: 'Other primary', masked: '...2222' }] });
      if (url.searchParams.get('action') === 'jobs') return json({ jobs: queued ? [{ id: 'fixture-job', status: 'completed', progress: 100, total: 1, results: [{ fileName: '0107__text.txt', runId: 'fixture-run', requestId: 'fixture-request', unresolvedCount: partial && !retried ? 1 : 0 }] }] : [] });
      if (route.request().method() === 'GET') return json({ chapters: [{ fileName: '0107__text.txt', chapterIndex: 106, failed: false }, { fileName: '0108__text.txt', chapterIndex: 107, failed: false }], failedJobs: [] });
      const body = route.request().postDataJSON();
      if (body.action === 'scan' && queued && partial) return json({ fileName: body.fileName, hash: 'fixture-hash', retryRunId: 'fixture-run', proposalHash: 'current-proposal-hash', issues: [{ id: '0', text: 'θεῷ', start: 40, end: 43 }] });
      if (body.action === 'scan') return json({ fileName: body.fileName, chapterIndex: body.fileName === '0107__text.txt' ? 106 : 107, title: 'Aetherian chapter', hash: 'fixture-hash', failed: false,
        issues: body.fileName === '0107__text.txt' ? [{ id: '0', start: 4, end: 34, text: '[Aetherian](/bad split/)', context: 'The Aetherian arrived.', reason: 'Pronunciation cannot be aligned.', replacement: '[Aetherian](/eɪθɪriən/)' }] : [] });
      if (body.action === 'queue') { queued = true; queuedSettings = body; retried = Boolean(body.chapters[0].retryRunId); proposedFiles.push(...body.chapters.map((chapter: { fileName: string }) => chapter.fileName)); return json({ jobId: 'fixture-job' }); }
    }
    if (url.pathname.endsWith('/batch-refine/review')) {
      if (route.request().method() === 'POST') { approved = true; return json({ success: true }); }
      return json({ run: { id: 'fixture-run', rule: 'pronunciation-repair:v1', status: 'completed', processedChapters: 1, totalChapters: 1 },
        changes: [{ id: 'change', textFileName: '0107__text.txt', chapterIndex: 106, chapterTitle: 'Aetherian chapter', previousText: 'The [Aetherian](/bad split/) arrived.', proposedText: 'The [Aetherian](/eɪθɪriən/) arrived.' + (partial ? retried ? ' [θεῷ](/θeɪoʊ/)' : ' θεῷ' : ''), reviewNote: partial && !retried ? 'NEEDS REVIEW: unresolved passage.' : null, diffText: '-bad split\n+eɪθɪriən', changedCharacters: 10, changePercent: 20, reviewPriority: 'high', priorityScore: 70, decision: approved ? 'approved' : 'pending', audioStatus: approved ? 'queued' : 'not_requested' }], flagDefinitions: [] });
    }
    return route.fulfill({ status: 404, body: 'Unexpected fixture request' });
  });
  await page.goto('http://localhost/');
  await expect.poll(async () => pageErrors.length + await page.getByRole('button', { name: 'Start Scan', exact: true }).count()).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await expect(page.getByLabel('Repair AI model')).toHaveValue('gemini-3.8-flash');
  await page.getByLabel('Repair AI model').fill('custom-fixture-model');
  await page.getByLabel('Primary Gemini key', { exact: true }).selectOption('other:primary');
  await page.getByRole('button', { name: 'Start Scan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Propose Repairs (1)' })).toBeEnabled();
  await expect(page.getByText('Checked 2 chapter text files.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Propose Repairs (1)' }).click();
  await expect(page.getByText('Repairs queued.', { exact: false })).toBeVisible();
  // A reload must restore durable progress and the proposal review link.
  await page.reload();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download repair report' }).click();
  const reportDownload = await downloaded;
  expect(reportDownload.suggestedFilename()).toBe('pronunciation-repair-fixture-job.json');
  expect(await reportDownload.failure()).toBeNull();
  const reportStream = await reportDownload.createReadStream();
  const reportChunks: Buffer[] = [];
  for await (const chunk of reportStream!) reportChunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(reportChunks).toString('utf8'))).toMatchObject({ jobId: 'fixture-job', summary: { proposals: 1 } });
  if (mode === 'retry') {
    await page.getByRole('button', { name: 'Retry unresolved', exact: true }).click();
    await expect.poll(() => retried).toBe(true);
    expect(queuedSettings.chapters).toEqual([{ fileName: '0107__text.txt', hash: 'fixture-hash', retryRunId: 'fixture-run', proposalHash: 'current-proposal-hash' }]);
  }
  await page.getByRole('button', { name: 'Review & Approve' }).click();
  await expect(page.getByRole('heading', { name: 'Pronunciation Repair Review' })).toBeVisible();
  if (mode === 'manual') {
    await expect(page.getByText('Needs review: 1 unresolved passages.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve & Record', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Edit proposal', exact: true }).click();
    await page.locator('textarea').fill('The [Aetherian](/eɪθɪriən/) arrived. [θεῷ](/θeɪoʊ/)');
    await page.getByRole('button', { name: 'Approve Edit & Record', exact: true }).click();
  } else await page.getByRole('button', { name: 'Approve & Record', exact: true }).click();
  await expect(page.getByTestId('queued')).toHaveText('1');
  expect(proposedFiles).toEqual(mode === 'retry' ? ['0107__text.txt', '0107__text.txt'] : ['0107__text.txt']);
  if (mode !== 'retry') expect(queuedSettings).toMatchObject({ aiModel: 'custom-fixture-model', primaryKeyRef: 'other:primary', backupKeyRef: '' });
  expect(approved).toBe(true);
});
