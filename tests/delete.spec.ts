import { test, expect } from '@playwright/test';
import { expectDocumentListed } from './helpers';
import { setupTest, uploadFiles, expectNoDocumentLink, deleteDocumentByName } from './helpers';

test.describe('Document deletion flow', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await setupTest(page, testInfo);
  });

  test('deletes a document and updates list', async ({ page }) => {
    // Upload two documents sequentially
    await uploadFiles(page, 'sample.pdf', 'sample.txt');

    // Delete the TXT document via row action
    await deleteDocumentByName(page, 'sample.txt');

    // Assert the TXT document is removed, PDF remains
    await expectNoDocumentLink(page, 'sample.txt');
    await expectDocumentListed(page, 'sample.pdf');

  });
});
