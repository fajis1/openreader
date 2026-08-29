import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const readRepositoryFile = (relativePath: string) => readFileSync(
  path.resolve(process.cwd(), relativePath),
  'utf8',
);

describe('CI workflow resilience', () => {
  const dockerWorkflow = readRepositoryFile('.github/workflows/docker-publish.yml');
  const playwrightWorkflow = readRepositoryFile('.github/workflows/playwright.yml');
  const vitestWorkflow = readRepositoryFile('.github/workflows/vitest.yml');
  const installRetryScript = readRepositoryFile('scripts/ci-install-with-retry.sh');

  test('retries root dependency installation after transient binary download failures', () => {
    const retryCommand = 'bash scripts/ci-install-with-retry.sh --frozen-lockfile';

    expect(vitestWorkflow).toContain(retryCommand);
    expect(playwrightWorkflow).toContain(retryCommand);
    expect(installRetryScript).toContain('max_attempts=3');
    expect(installRetryScript).toContain('if pnpm install "$@"; then');
    expect(installRetryScript).toContain('retry_delay=$((attempt * 10))');
  });

  test('retries registry login in both Docker build and merge jobs', () => {
    expect(dockerWorkflow.match(/uses: docker\/login-action@v4/g)).toHaveLength(6);
    expect(dockerWorkflow.match(/id: ghcr_login_1/g)).toHaveLength(2);
    expect(dockerWorkflow.match(/id: ghcr_login_2/g)).toHaveLength(2);
    expect(dockerWorkflow.match(/continue-on-error: true/g)).toHaveLength(4);
  });

  test('publishes complete image families independently after a matrix failure', () => {
    expect(dockerWorkflow).toContain(
      "if: ${{ always() && !cancelled() && needs.prepare.result == 'success' }}",
    );
    expect(dockerWorkflow).toContain('- name: Validate architecture digests');
    expect(dockerWorkflow).toContain('web|compute-worker) expected=2');
    expect(dockerWorkflow).toContain('*) expected=1');
    expect(dockerWorkflow).toContain('refusing to publish an incomplete image');
    expect(dockerWorkflow.indexOf('Validate architecture digests')).toBeLessThan(
      dockerWorkflow.indexOf('Create manifest list and push'),
    );
  });
});
