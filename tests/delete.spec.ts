import { test, expect } from '@playwright/test';
import { setupTest, uploadFile, expectDocumentListed, expectNoDocumentLink, deleteDocumentByName, deleteAllLocalDocuments, ensureDocumentsListed } from './helpers';

test.describe('Document deletion flow', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await setupTest(page, testInfo);
  });

  test('deletes a document and updates list', async ({ page }) => {
    // Upload two documents
    await uploadFile(page, 'sample.pdf');
    await uploadFile(page, 'sample.txt');

    // Verify both appear
    await expectDocumentListed(page, 'sample.pdf');
    await expectDocumentListed(page, 'sample.txt');

    // Delete the TXT document via row action
    await deleteDocumentByName(page, 'sample.txt');

    // Assert the TXT document is removed, PDF remains
    await expectNoDocumentLink(page, 'sample.txt');
    await expectDocumentListed(page, 'sample.pdf');

  });

  test('deletes all local documents from Settings modal', async ({ page }) => {
    // This test only applies when auth is NOT enabled, since with auth
    // the bulk-delete UI lives in the delete-account flow instead.
    test.skip(
      Boolean(process.env.AUTH_SECRET && process.env.BASE_URL),
      'Bulk document deletion is part of the delete-account flow when auth is enabled',
    );

    // Upload multiple docs (PDF + EPUB)
    await uploadFile(page, 'sample.pdf');
    await uploadFile(page, 'sample.epub');

    // Verify both appear
    await ensureDocumentsListed(page, ['sample.pdf', 'sample.epub']);

    // Delete all local documents via Settings
    await deleteAllLocalDocuments(page);

    // Assert both documents are removed
    await expectNoDocumentLink(page, 'sample.pdf');
    await expectNoDocumentLink(page, 'sample.epub');

    // Uploader should be visible when no docs remain
    await expect(page.locator('input[type=file]')).toBeVisible({ timeout: 10000 });
  });
});
