import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AnalyticsService } from './analytics.service';
import { ChartInterval, ChartRange } from './dto/chart-data.dto';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let dataSource: any;

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    dataSource = module.get<DataSource>(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getChartData', () => {
    it('should call getHourlyChartData for 1h interval', async () => {
      const query = {
        interval: ChartInterval.ONE_HOUR,
        range: ChartRange.SEVEN_DAYS,
        asset: 'XLM',
      };

      const mockData = [
        { bucket: new Date('2024-03-25T00:00:00Z'), sentiment: 0.5, count: 10 },
      ];
      dataSource.query.mockResolvedValue(mockData);

      const result = await service.getChartData(query);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining("date_trunc('hour', analyzed_at)"),
        expect.arrayContaining([expect.any(Date), 'XLM']),
      );
      expect(result[0].sentiment).toBe(0.5);
      expect(result[0].count).toBe(10);
      expect(typeof result[0].timestamp).toBe('string');
    });

    it('should call getDailyChartData for 1d interval', async () => {
      const query = {
        interval: ChartInterval.ONE_DAY,
        range: ChartRange.THIRTY_DAYS,
        asset: 'XLM',
      };

      const mockData = [
        {
          bucket: new Date('2024-03-25T00:00:00Z'),
          sentiment: 0.6,
          count: 100,
        },
      ];
      dataSource.query.mockResolvedValue(mockData);

      const result = await service.getChartData(query);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM daily_snapshots'),
        expect.arrayContaining([expect.any(Date), 'XLM']),
      );
      expect(result[0].sentiment).toBe(0.6);
    });

    it('should handle global data (no asset) for 1h interval', async () => {
      const query = {
        interval: ChartInterval.ONE_HOUR,
        range: ChartRange.SEVEN_DAYS,
      };

      dataSource.query.mockResolvedValue([]);

      await service.getChartData(query);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([expect.any(Date), null]),
      );
    });

    it('should handle global data (no asset) for 1d interval', async () => {
      const query = {
        interval: ChartInterval.ONE_DAY,
        range: ChartRange.SEVEN_DAYS,
      };

      dataSource.query.mockResolvedValue([]);

      await service.getChartData(query);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('asset_symbol IS NULL'),
        expect.arrayContaining([expect.any(Date), null]),
      );
    });
  });
});
