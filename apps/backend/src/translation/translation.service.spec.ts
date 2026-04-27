import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { TranslationService } from './translation.service';
import { of } from 'rxjs';

describe('TranslationService', () => {
  let service: TranslationService;
  let httpService: HttpService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranslationService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const config: Record<string, string> = {
                TRANSLATION_PROVIDER: 'libretranslate',
                LIBRETRANSLATE_URL: 'https://libretranslate.com',
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TranslationService>(TranslationService);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('normalizeText', () => {
    it('should remove extra whitespace', () => {
      const input = 'Hello    world   test';
      const result = service.normalizeText(input);
      expect(result).toBe('Hello world test');
    });

    it('should normalize quotes', () => {
      const input = '"Hello" 'world'';
      const result = service.normalizeText(input);
      expect(result).toBe('"Hello" \'world\'');
    });

    it('should trim leading and trailing whitespace', () => {
      const input = '  Hello world  ';
      const result = service.normalizeText(input);
      expect(result).toBe('Hello world');
    });
  });

  describe('detectLanguage', () => {
    it('should detect language using LibreTranslate', async () => {
      const mockResponse = {
        data: [{ language: 'es', confidence: 0.95 }],
      };

      jest.spyOn(httpService, 'post').mockReturnValue(of(mockResponse) as any);

      const result = await service.detectLanguage('Hola mundo');
      expect(result.language).toBe('es');
      expect(result.confidence).toBe(0.95);
    });

    it('should default to English on error', async () => {
      jest.spyOn(httpService, 'post').mockImplementation(() => {
        throw new Error('API Error');
      });

      const result = await service.detectLanguage('Some text');
      expect(result.language).toBe('en');
      expect(result.confidence).toBe(0);
    });
  });

  describe('translateToEnglish', () => {
    it('should return original text if already in English', async () => {
      const mockDetection = {
        data: [{ language: 'en', confidence: 0.99 }],
      };

      jest
        .spyOn(httpService, 'post')
        .mockReturnValue(of(mockDetection) as any);

      const result = await service.translateToEnglish('Hello world');
      expect(result.translatedText).toBe('Hello world');
      expect(result.detectedLanguage).toBe('en');
    });

    it('should translate non-English text', async () => {
      const mockDetection = {
        data: [{ language: 'es', confidence: 0.95 }],
      };

      const mockTranslation = {
        data: { translatedText: 'Hello world' },
      };

      jest
        .spyOn(httpService, 'post')
        .mockReturnValueOnce(of(mockDetection) as any)
        .mockReturnValueOnce(of(mockTranslation) as any);

      const result = await service.translateToEnglish('Hola mundo');
      expect(result.translatedText).toBe('Hello world');
      expect(result.detectedLanguage).toBe('es');
    });
  });

  describe('translateAndNormalize', () => {
    it('should normalize and translate content', async () => {
      const mockDetection = {
        data: [{ language: 'fr', confidence: 0.9 }],
      };

      const mockTranslation = {
        data: { translatedText: 'Hello world' },
      };

      jest
        .spyOn(httpService, 'post')
        .mockReturnValueOnce(of(mockDetection) as any)
        .mockReturnValueOnce(of(mockTranslation) as any);

      const result = await service.translateAndNormalize(
        '  Bonjour   monde  ',
        '',
      );

      expect(result.title).toBe('Hello world');
      expect(result.originalLanguage).toBe('fr');
    });
  });
});
