# Translation Module

## Overview

The Translation Module provides language detection, translation, and text normalization services for the Lumenpulse platform. It enables the ingestion and processing of multilingual content by automatically translating non-English articles to English.

## Features

- **Language Detection**: Automatically detect the source language of text
- **Translation**: Translate text from any language to English
- **Normalization**: Clean and standardize text formatting
- **Multiple Providers**: Support for LibreTranslate and Google Translate
- **Error Resilience**: Graceful fallback on translation failures

## Installation

The module is already integrated into the News module. No additional installation required.

## Configuration

### Environment Variables

```bash
# Enable/disable translation
TRANSLATION_ENABLED=true

# Provider selection
TRANSLATION_PROVIDER=libretranslate  # or 'google'

# LibreTranslate settings
LIBRETRANSLATE_URL=https://libretranslate.com
LIBRETRANSLATE_API_KEY=optional_api_key

# Google Translate settings
GOOGLE_TRANSLATE_API_KEY=your_google_api_key
```

## Usage

### Basic Translation

```typescript
import { TranslationService } from './translation/translation.service';

// Inject the service
constructor(private readonly translationService: TranslationService) {}

// Translate text to English
const result = await this.translationService.translateToEnglish(
  'Hola mundo'
);

console.log(result);
// {
//   translatedText: 'Hello world',
//   detectedLanguage: 'es',
//   confidence: 0.95
// }
```

### Language Detection

```typescript
const detection = await this.translationService.detectLanguage(
  'Bonjour le monde'
);

console.log(detection);
// {
//   language: 'fr',
//   confidence: 0.98
// }
```

### Text Normalization

```typescript
const normalized = this.translationService.normalizeText(
  '  Hello    world   '
);

console.log(normalized); // 'Hello world'
```

### Combined Translation and Normalization

```typescript
const result = await this.translationService.translateAndNormalize(
  'Bitcoin alcanza nuevo máximo histórico',
  'El precio de Bitcoin ha superado los $100,000...'
);

console.log(result);
// {
//   title: 'Bitcoin reaches new all-time high',
//   body: 'The price of Bitcoin has exceeded $100,000...',
//   originalLanguage: 'es',
//   translationConfidence: 0.95
// }
```

## API Reference

### TranslationService

#### Methods

##### `detectLanguage(text: string): Promise<LanguageDetectionResult>`

Detects the language of the given text.

**Parameters:**
- `text` (string): The text to analyze

**Returns:**
```typescript
{
  language: string;      // ISO 639-1 language code
  confidence: number;    // Confidence score (0-1)
}
```

##### `translateToEnglish(text: string, sourceLanguage?: string): Promise<TranslationResult>`

Translates text to English. If the text is already in English, returns it unchanged.

**Parameters:**
- `text` (string): The text to translate
- `sourceLanguage` (string, optional): Source language code (auto-detected if not provided)

**Returns:**
```typescript
{
  translatedText: string;
  detectedLanguage: string;
  confidence: number;
}
```

##### `normalizeText(text: string): string`

Normalizes text by removing extra whitespace and special characters.

**Parameters:**
- `text` (string): The text to normalize

**Returns:**
- Normalized text string

##### `translateAndNormalize(title: string, body?: string, sourceLanguage?: string): Promise<TranslationAndNormalizationResult>`

Combines translation and normalization in a single operation.

**Parameters:**
- `title` (string): Article title
- `body` (string, optional): Article body
- `sourceLanguage` (string, optional): Source language code

**Returns:**
```typescript
{
  title: string;
  body: string;
  originalLanguage: string;
  translationConfidence: number;
}
```

## Translation Providers

### LibreTranslate

**Advantages:**
- Free and open-source
- Self-hostable
- Privacy-friendly
- No billing required

**Setup:**

Public instance:
```bash
LIBRETRANSLATE_URL=https://libretranslate.com
```

Self-hosted:
```bash
docker run -ti --rm -p 5000:5000 libretranslate/libretranslate
LIBRETRANSLATE_URL=http://localhost:5000
```

### Google Translate

**Advantages:**
- High accuracy
- Fast processing
- Reliable uptime

**Setup:**

1. Enable Google Cloud Translation API
2. Create API key
3. Configure environment:

```bash
TRANSLATION_PROVIDER=google
GOOGLE_TRANSLATE_API_KEY=your_api_key_here
```

## Error Handling

The translation service is designed to be non-blocking:

```typescript
try {
  const result = await translationService.translateToEnglish(text);
  // Use translated text
} catch (error) {
  // Service returns original text on error
  // No need for explicit error handling
}
```

## Testing

### Run Unit Tests

```bash
npm test -- translation.service.spec.ts
```

### Test Coverage

The module includes comprehensive tests for:
- Language detection
- Translation (both providers)
- Text normalization
- Error handling
- Edge cases

## Performance

### Latency

- **LibreTranslate**: ~500-1000ms per request
- **Google Translate**: ~200-500ms per request

### Optimization Tips

1. **Batch Processing**: Process articles in background jobs
2. **Caching**: Cache translations for repeated content
3. **Rate Limiting**: Respect API rate limits
4. **Selective Translation**: Translate only necessary fields

## Supported Languages

Both providers support 100+ languages including:

- Spanish (es)
- French (fr)
- German (de)
- Italian (it)
- Portuguese (pt)
- Russian (ru)
- Japanese (ja)
- Korean (ko)
- Chinese (zh)
- Arabic (ar)
- And many more...

## Integration with News Module

The Translation Module is automatically integrated into the news ingestion pipeline:

```typescript
// In NewsService.createOrIgnore()
const result = await this.translationService.translateAndNormalize(
  articleDto.title,
  articleDto.body || '',
);

// Save with translation metadata
const article = this.newsRepository.create({
  title: result.title,
  originalTitle: articleDto.title,
  originalLanguage: result.originalLanguage,
  translationConfidence: result.translationConfidence,
  isTranslated: result.originalLanguage !== 'en',
  normalizedAt: new Date(),
  // ... other fields
});
```

## Troubleshooting

### Translation Not Working

1. Verify `TRANSLATION_ENABLED=true`
2. Check provider credentials
3. Test API endpoint connectivity
4. Review application logs

### Low Confidence Scores

1. Ensure text is at least 50 characters
2. Check for mixed-language content
3. Verify UTF-8 encoding

### API Rate Limits

1. Implement request throttling
2. Use caching for repeated content
3. Consider self-hosted LibreTranslate

## Contributing

When contributing to the Translation Module:

1. Add tests for new features
2. Update documentation
3. Follow existing code patterns
4. Handle errors gracefully

## License

Part of the Lumenpulse project. See main LICENSE file.
