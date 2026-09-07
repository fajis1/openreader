import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

test('scan selects only affected chapters and carries repair through approval', async ({ page }) => {
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
  let approved = false;
  await page.route('http://pronunciation.test/**', async route => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    if (url.pathname === '/bundle.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text });
    if (url.pathname.endsWith('/pronunciation-issues')) {
      if (route.request().method() === 'GET') return json({ chapters: [{ fileName: '0107__text.txt', chapterIndex: 106, failed: false }, { fileName: '0108__text.txt', chapterIndex: 107, failed: false }], failedJobs: [] });
      const body = route.request().postDataJSON();
      if (body.action === 'scan') return json({ fileName: body.fileName, chapterIndex: body.fileName === '0107__text.txt' ? 106 : 107, title: 'Aetherian chapter', hash: 'fixture-hash', failed: false,
        issues: body.fileName === '0107__text.txt' ? [{ id: '0', start: 4, end: 34, text: '[Aetherian](/bad split/)', context: 'The Aetherian arrived.', reason: 'Pronunciation cannot be aligned.', replacement: '[Aetherian](/eɪθɪriən/)' }] : [] });
      if (body.action === 'propose') { proposedFiles.push(body.fileName); return json({ runId: 'fixture-run' }); }
    }
    if (url.pathname.endsWith('/batch-refine/review')) {
      if (route.request().method() === 'POST') { approved = true; return json({ success: true }); }
      return json({ run: { id: 'fixture-run', rule: 'pronunciation-repair:v1', status: 'completed', processedChapters: 1, totalChapters: 1 },
        changes: [{ id: 'change', textFileName: '0107__text.txt', chapterIndex: 106, chapterTitle: 'Aetherian chapter', previousText: 'The [Aetherian](/bad split/) arrived.', proposedText: 'The [Aetherian](/eɪθɪriən/) arrived.', diffText: '-bad split\n+eɪθɪriən', changedCharacters: 10, changePercent: 20, reviewPriority: 'high', priorityScore: 70, decision: approved ? 'approved' : 'pending', audioStatus: approved ? 'queued' : 'not_requested' }], flagDefinitions: [] });
    }
    return route.fulfill({ status: 404, body: 'Unexpected fixture request' });
  });
  await page.goto('http://pronunciation.test/');
  await expect.poll(async () => pageErrors.length + await page.getByRole('button', { name: 'Start Scan', exact: true }).count()).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await page.getByRole('button', { name: 'Start Scan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Propose Repairs (1)' })).toBeEnabled();
  await expect(page.getByText('Checked 2 chapter text files.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Propose Repairs (1)' }).click();
  await page.getByRole('button', { name: 'Review & Approve' }).click();
  await expect(page.getByRole('heading', { name: 'Pronunciation Repair Review' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve & Record', exact: true }).click();
  await expect(page.getByTestId('queued')).toHaveText('1');
  expect(proposedFiles).toEqual(['0107__text.txt']);
  expect(approved).toBe(true);
});
