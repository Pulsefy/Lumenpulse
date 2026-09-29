import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { DriftAlertIngestionService } from './drift-alert-ingestion.service';
import { DriftAlertRequestDto } from './dto/drift-alert.dto';
import { NotificationSeverity, NotificationType } from './notification.entity';

describe('DriftAlertIngestionService', () => {
  let service: DriftAlertIngestionService;
  let createSpy: jest.Mock;

  beforeEach(async () => {
    createSpy = jest
      .fn()
      .mockImplementation((dto) =>
        Promise.resolve({ id: `notif-${createSpy.mock.calls.length}`, ...dto }),
      );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftAlertIngestionService,
        {
          provide: NotificationService,
          useValue: { create: createSpy },
        },
      ],
    }).compile();

    service = module.get<DriftAlertIngestionService>(
      DriftAlertIngestionService,
    );
  });

  const baseAlert: DriftAlertRequestDto = {
    type: NotificationType.DRIFT,
    title: 'Feature drift detected',
    message: 'sentiment_score drifted beyond PSI threshold',
    severity: NotificationSeverity.HIGH,
    alertId: '123e4567-e89b-12d3-a456-426614174000',
    metadata: { alertType: 'feature_drift' },
  };

  it('stores a drift alert as a broadcast notification with mapped severity', async () => {
    const result = await service.ingestAlert(baseAlert);

    expect(result.created).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.notificationIds).toHaveLength(1);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.DRIFT,
        severity: NotificationSeverity.HIGH,
        userId: null, // broadcast when no target users provided
        metadata: expect.objectContaining({
          source: 'data-processing',
          alertId: baseAlert.alertId,
        }),
      }),
    );
  });

  it('creates one notification per explicit target user', async () => {
    const result = await service.ingestAlert({
      ...baseAlert,
      targetUserIds: ['user-1', 'user-2', 'user-1'],
    });

    expect(result.notificationIds).toHaveLength(2); // dedup of target list
    expect(createSpy.mock.calls[0][0].userId).toBe('user-1');
    expect(createSpy.mock.calls[1][0].userId).toBe('user-2');
  });

  it('deduplicates a retried alertId instead of re-creating the notification', async () => {
    await service.ingestAlert(baseAlert);
    const second = await service.ingestAlert(baseAlert);

    expect(second.created).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.notificationIds).toHaveLength(0);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('accepts the severity provided by the caller (priority model)', async () => {
    await service.ingestAlert({
      ...baseAlert,
      severity: NotificationSeverity.CRITICAL,
    });

    expect(createSpy.mock.calls[0][0].severity).toBe('critical');
  });
});
