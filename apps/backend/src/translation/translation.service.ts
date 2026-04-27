import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { AxiosError } from 'axios';

export interface TranslationResult {
  translatedText: string;
  detectedLanguage: string;
  confidence: number;
}

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly defaultTimeout = 10000;
  private readonly targetLanguage = 'en'; // Always translate to English

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Detects the language of the given text
   */
  async detectLanguage(text: string): Promise<LanguageDetectionResult> {
    const provider = this.configService.get<string>(
      'TRANSLATION_PROVIDER',
      'libretranslate',
    );

    if (provider === 'google') {
      return this.detectLanguageGoogle(text);
    } else {
      return this.detectLanguageLibreTranslate(text);
    }
  }

  /**
   * Translates text to English if it's not already in English
   */
  async translateToEnglish(
    text: string,
    sourceLanguage?: string,
  ): Promise<TranslationResult> {
    try {
      // Detect language if not provided
      let detectedLang = sourceLanguage;
      let confidence = 1.0;

      if (!detectedLang) {
        const detection = await this.detectLanguage(text);
        detectedLang = detection.language;
        confidence = detection.confidence;
      }

      // If already in English, return as-is
      if (this.isEnglish(detectedLang)) {
        return {
          translatedText: text,
          detectedLanguage: detectedLang,
          confidence: 1.0,
        };
      }

      // Translate to English
      const provider = this.configService.get<string>(
        'TRANSLATION_PROVIDER',
        'libretranslate',
      );

      let translatedText: string;
      if (provider === 'google') {
        translatedText = await this.translateGoogle(
          text,
          detectedLang,
          this.targetLanguage,
        );
      } else {
        translatedText = await this.translateLibreTranslate(
          text,
          detectedLang,
          this.targetLanguage,
        );
      }

      return {
        translatedText,
        detectedLanguage: detectedLang,
        confidence,
      };
    } catch (error) {
      this.logger.error(
        `Translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Return original text if translation fails
      return {
        translatedText: text,
        detectedLanguage: sourceLanguage || 'unknown',
        confidence: 0,
      };
    }
  }

  /**
   * Normalizes text by removing extra whitespace, special characters, etc.
   */
  normalizeText(text: string): string {
    if (!text) return '';

    return (
      text
        // Remove multiple spaces
        .replace(/\s+/g, ' ')
        // Remove leading/trailing whitespace
        .trim()
        // Normalize quotes
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        // Remove zero-width characters
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // Normalize line breaks
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
    );
  }

  /**
   * Translates and normalizes content
   */
  async translateAndNormalize(
    title: string,
    body?: string,
    sourceLanguage?: string,
  ): Promise<{
    title: string;
    body: string;
    originalLanguage: string;
    translationConfidence: number;
  }> {
    // Normalize first
    const normalizedTitle = this.normalizeText(title);
    const normalizedBody = body ? this.normalizeText(body) : '';

    // Translate title
    const titleResult = await this.translateToEnglish(
      normalizedTitle,
      sourceLanguage,
    );

    // Translate body if provided
    let bodyResult: TranslationResult | null = null;
    if (normalizedBody) {
      bodyResult = await this.translateToEnglish(
        normalizedBody,
        titleResult.detectedLanguage,
      );
    }

    return {
      title: titleResult.translatedText,
      body: bodyResult?.translatedText || normalizedBody,
      originalLanguage: titleResult.detectedLanguage,
      translationConfidence: titleResult.confidence,
    };
  }

  // ==================== LibreTranslate Implementation ====================

  private async detectLanguageLibreTranslate(
    text: string,
  ): Promise<LanguageDetectionResult> {
    const baseUrl = this.configService.get<string>(
      'LIBRETRANSLATE_URL',
      'https://libretranslate.com',
    );
    const apiKey = this.configService.get<string>('LIBRETRANSLATE_API_KEY');

    try {
      const response = await firstValueFrom(
        this.httpService
          .post(
            `${baseUrl}/detect`,
            {
              q: text.substring(0, 500), // Use first 500 chars for detection
              api_key: apiKey,
            },
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
          .pipe(
            timeout(this.defaultTimeout),
            catchError((error: AxiosError) => {
              this.logger.error(
                `LibreTranslate detect error: ${error.message}`,
              );
              throw error;
            }),
          ),
      );

      const detections = response.data as Array<{
        language: string;
        confidence: number;
      }>;

      if (detections && detections.length > 0) {
        return {
          language: detections[0].language,
          confidence: detections[0].confidence,
        };
      }

      return { language: 'en', confidence: 0 };
    } catch (error) {
      this.logger.warn('Language detection failed, defaulting to English');
      return { language: 'en', confidence: 0 };
    }
  }

  private async translateLibreTranslate(
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<string> {
    const baseUrl = this.configService.get<string>(
      'LIBRETRANSLATE_URL',
      'https://libretranslate.com',
    );
    const apiKey = this.configService.get<string>('LIBRETRANSLATE_API_KEY');

    const response = await firstValueFrom(
      this.httpService
        .post(
          `${baseUrl}/translate`,
          {
            q: text,
            source: sourceLang,
            target: targetLang,
            format: 'text',
            api_key: apiKey,
          },
          {
            headers: { 'Content-Type': 'application/json' },
          },
        )
        .pipe(
          timeout(this.defaultTimeout),
          catchError((error: AxiosError) => {
            this.logger.error(`LibreTranslate error: ${error.message}`);
            throw error;
          }),
        ),
    );

    return response.data.translatedText || text;
  }

  // ==================== Google Translate Implementation ====================

  private async detectLanguageGoogle(
    text: string,
  ): Promise<LanguageDetectionResult> {
    const apiKey = this.configService.get<string>('GOOGLE_TRANSLATE_API_KEY');
    if (!apiKey) {
      throw new Error('Google Translate API key not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService
          .post(
            `https://translation.googleapis.com/language/translate/v2/detect`,
            {
              q: text.substring(0, 500),
            },
            {
              params: { key: apiKey },
              headers: { 'Content-Type': 'application/json' },
            },
          )
          .pipe(
            timeout(this.defaultTimeout),
            catchError((error: AxiosError) => {
              this.logger.error(`Google Detect error: ${error.message}`);
              throw error;
            }),
          ),
      );

      const detection = response.data.data.detections[0][0];
      return {
        language: detection.language,
        confidence: detection.confidence,
      };
    } catch (error) {
      this.logger.warn('Language detection failed, defaulting to English');
      return { language: 'en', confidence: 0 };
    }
  }

  private async translateGoogle(
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<string> {
    const apiKey = this.configService.get<string>('GOOGLE_TRANSLATE_API_KEY');
    if (!apiKey) {
      throw new Error('Google Translate API key not configured');
    }

    const response = await firstValueFrom(
      this.httpService
        .post(
          `https://translation.googleapis.com/language/translate/v2`,
          {
            q: text,
            source: sourceLang,
            target: targetLang,
            format: 'text',
          },
          {
            params: { key: apiKey },
            headers: { 'Content-Type': 'application/json' },
          },
        )
        .pipe(
          timeout(this.defaultTimeout),
          catchError((error: AxiosError) => {
            this.logger.error(`Google Translate error: ${error.message}`);
            throw error;
          }),
        ),
    );

    return response.data.data.translations[0].translatedText || text;
  }

  // ==================== Helper Methods ====================

  private isEnglish(languageCode: string): boolean {
    return languageCode.toLowerCase().startsWith('en');
  }
}
