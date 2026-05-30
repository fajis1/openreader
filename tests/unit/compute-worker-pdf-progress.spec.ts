import { expect, test } from '@playwright/test';
import {
  buildInferProgressForPageParsed,
  buildInferProgressForPageStart,
} from '../../compute/worker/src/pdf-progress';

test.describe('compute worker pdf progress helpers', () => {
  test('page-start progress keeps current page but does not count it as parsed yet', () => {
    expect(buildInferProgressForPageStart({ pageNumber: 1, totalPages: 12 })).toEqual({
      totalPages: 12,
      pagesParsed: 0,
      currentPage: 1,
      phase: 'infer',
    });

    expect(buildInferProgressForPageStart({ pageNumber: 5, totalPages: 12 })).toEqual({
      totalPages: 12,
      pagesParsed: 4,
      currentPage: 5,
      phase: 'infer',
    });
  });

  test('page-parsed progress counts the current page as parsed', () => {
    expect(buildInferProgressForPageParsed({ pageNumber: 5, totalPages: 12 })).toEqual({
      totalPages: 12,
      pagesParsed: 5,
      currentPage: 5,
      phase: 'infer',
    });
  });
});
