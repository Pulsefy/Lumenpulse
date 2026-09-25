import { NotificationModule } from './notification.module';
import { DriftAlertIngestionController } from './drift-alert-ingestion.controller';
import { DriftAlertIngestionService } from './drift-alert-ingestion.service';
import { DriftAlertIngestionGuard } from './guards/drift-alert-ingestion.guard';
import { config } from '../lib/config';

describe('drift alert routing compile check (#1447)', () => {
  it('wires the module, controller, service, guard and config', () => {
    expect(NotificationModule).toBeDefined();
    expect(DriftAlertIngestionController).toBeDefined();
    expect(DriftAlertIngestionService).toBeDefined();
    expect(DriftAlertIngestionGuard).toBeDefined();
    // config export includes the new drift alert settings
    expect(config.driftAlerts).toBeDefined();
    expect(Object.keys(config.driftAlerts)).toEqual(
      expect.arrayContaining(['ingestSecret', 'timestampToleranceMs']),
    );
  });
});
