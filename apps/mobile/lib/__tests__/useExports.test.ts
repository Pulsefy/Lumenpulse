import { exportManager, ExportJob } from '../exports';

describe('useExports Integration (lib/exports.ts + ExportManager)', () => {
  it('exportManager maintains singleton instance with proper defaults', () => {
    expect(exportManager).toBeDefined();
    expect(typeof exportManager.requestExport).toBe('function');
    expect(typeof exportManager.isTypePending).toBe('function');
    expect(typeof exportManager.pollJob).toBe('function');
    expect(typeof exportManager.downloadAndShare).toBe('function');
  });

  it('prevents requesting duplicates across different job lists', async () => {
    const jobs: ExportJob[] = [
      {
        id: 'job-pending-1',
        type: 'tax_transactions',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    expect(exportManager.isTypePending('tax_transactions', jobs)).toBe(true);
    expect(exportManager.isTypePending('portfolio_history', jobs)).toBe(false);

    const result = await exportManager.requestExport('tax_transactions', jobs);
    expect(result.job).toBeNull();
    expect(result.error).toContain('already in progress');
  });
});
