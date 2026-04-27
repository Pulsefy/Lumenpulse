# Multilingual Translation and Normalization Pipeline

## Overview

The multilingual translation and normalization pipeline enables Lumenpulse to ingest, process, and analyze content from non-English sources. All content is automatically detected, translated to English, normalized, and enriched with metadata before analytics are computed.

## Features

### 1. **Automatic Language Detection**
- Detects the source language of incoming articles
- Supports 100+ languages via LibreTranslate or Google Translate
- Confidence scoring for detection accuracy

### 2. **Translation to English**
- Translates non-English content to English for unified analytics
- Preserves original content for reference
- Supports two translation providers:
  - **LibreTranslate** (free, open-source, self-hostable)
  - **Google Translate** (paid, high accuracy)

### 3. **Text Normalization**
- Removes extra whitespace
- Normalizes quotes and special characters
- Removes zero-width characters
- Standardizes line breaks

### 4. **Metadata Enrichment**
- Stores original language code (ISO 639-1)
- Preserves original title for reference
- Records translation confidence score
- Timestamps normalization process

### 5. **Retroactive Processing**
- Scheduled job to translate existing articles
- Runs daily at 2 AM
- Processes 50 articles per run
- Non-blocking and error-resilient

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    News Ingestion Flow                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  NewsProvider    │
                    │    Service       │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   NewsService    │
                    │  createOrIgnore  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   Translation    │
                    │     Service      │
                    └────────┬─────────┘
                             │
                ┌────────────┼────────────┐
                ▼            ▼            ▼
         ┌──────────┐ ┌──────────┐ ┌──────────┐
         │ Detect   │ │Translate │ │Normalize │
         │ Language │ │   Text   │ │   Text   │
         └──────────┘ └──────────┘ └──────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Save to DB      │
                    │  with metadata   │
                    └──────────────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   Sentiment      │
                    │   Analysis       │
                    └──────────────────┘
```

### Database Schema

New fields added to the `articles` table:

| Field                    | Type      | Description                                    |
|--------------------------|-----------|------------------------------------------------|
| `original_language`      | varchar   | ISO 639-1 language code (e.g., 'es', 'fr')   |
| `original_title`         | text      | Original title before translation              |
| `translation_confidence` | float     | Confidence score (0-1) of language detection   |
| `is_translated`          | boolean   | Whether the content was translated             |
| `normalized_at`          | timestamp | When content was normalized/translated         |

Indexes:
- `IDX_articles_original_language` - For filtering by language
- `IDX_articles_is_translated` - For filtering translated content

## Configuration

### Environment Variables

```bash
# Enable/disable translation pipeline
TRANSLATION_ENABLED=true

# Translation provider: 'libretranslate' or 'google'
TRANSLATION_PROVIDER=libretranslate

# LibreTranslate Configuration
LIBRETRANSLATE_URL=https://libretranslate.com
LIBRETRANSLATE_API_KEY=your_api_key_here

# Google Translate Configuration
GOOGLE_TRANSLATE_API_KEY=your_google_api_key_here
```

### Translation Providers

#### LibreTranslate (Recommended for Development)

**Pros:**
- Free and open-source
- Self-hostable for privacy
- No billing required
- Supports 100+ languages

**Cons:**
- Public instance has rate limits
- Slightly lower accuracy than Google

**Setup:**
1. Use public instance: `https://libretranslate.com`
2. Or self-host: https://github.com/LibreTranslate/LibreTranslate

```bash
# Docker setup for self-hosted LibreTranslate
docker run -ti --rm -p 5000:5000 libretranslate/libretranslate
```

#### Google Translate (Recommended for Production)

**Pros:**
- High accuracy
- Fast processing
- Reliable uptime
- Supports 130+ languages

**Cons:**
- Requires billing account
- Costs $20 per million characters

**Setup:**
1. Enable Google Cloud Translation API
2. Create API key
3. Set `GOOGLE_TRANSLATE_API_KEY` in environment

## API Endpoints

### Get Translation Statistics

```http
GET /news/translation/stats
```

**Response:**
```json
{
  "totalArticles": 1000,
  "translatedArticles": 250,
  "englishArticles": 750,
  "languageBreakdown": {
    "en": 750,
    "es": 100,
    "fr": 80,
    "de": 50,
    "ja": 20
  },
  "averageConfidence": 0.92
}
```

### Get Articles by Language

```http
GET /news/translation/language/:lang
```

**Example:**
```http
GET /news/translation/language/es
```

**Response:**
```json
{
  "articles": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "title": "Bitcoin reaches new all-time high",
      "originalTitle": "Bitcoin alcanza nuevo máximo histórico",
      "url": "https://example.com/article",
      "source": "coindesk",
      "publishedAt": "2024-01-15T10:30:00Z",
      "originalLanguage": "es",
      "isTranslated": true,
      "translationConfidence": 0.95
    }
  ],
  "totalCount": 100,
  "language": "es"
}
```

## Scheduled Jobs

### 1. News Fetch Job
- **Schedule:** Every 15 minutes (`0 */15 * * * *`)
- **Function:** `fetchAndSaveArticles()`
- **Process:**
  1. Fetches latest articles from provider
  2. Applies translation pipeline to new articles
  3. Saves to database with metadata

### 2. Retroactive Translation Job
- **Schedule:** Daily at 2 AM (`0 0 2 * * *`)
- **Function:** `retroactivelyTranslateArticles()`
- **Process:**
  1. Finds articles without `original_language` set
  2. Processes up to 50 articles per run
  3. Updates articles with translation metadata

### 3. Sentiment Analysis Job
- **Schedule:** Every 10 minutes
- **Function:** `updateMissingSentiments()`
- **Note:** Runs on translated English content

## Usage Examples

### Programmatic Usage

```typescript
import { TranslationService } from './translation/translation.service';

// Translate and normalize content
const result = await translationService.translateAndNormalize(
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

// Detect language only
const detection = await translationService.detectLanguage(
  'Bonjour le monde'
);
console.log(detection);
// { language: 'fr', confidence: 0.98 }

// Normalize text
const normalized = translationService.normalizeText(
  '  Hello    world   '
);
console.log(normalized); // 'Hello world'
```

### Query Translated Articles

```typescript
// Get all Spanish articles
const spanishArticles = await newsService.findByOriginalLanguage('es');

// Get translation statistics
const stats = await newsService.getTranslationStats();

// Find untranslated articles
const untranslated = await newsService.findUntranslatedArticles(100);
```

## Performance Considerations

### Translation API Latency
- LibreTranslate: ~500-1000ms per request
- Google Translate: ~200-500ms per request

### Optimization Strategies

1. **Batch Processing**
   - Process articles in scheduled jobs
   - Avoid blocking real-time requests

2. **Caching**
   - Cache translated content
   - Reuse translations for duplicate content

3. **Rate Limiting**
   - Respect API rate limits
   - Implement exponential backoff

4. **Selective Translation**
   - Only translate title initially
   - Translate body on-demand

## Error Handling

The translation pipeline is designed to be non-blocking:

1. **Translation Failure:** Returns original content
2. **Detection Failure:** Defaults to English
3. **API Timeout:** Logs error and continues
4. **Invalid Response:** Falls back to normalization only

## Testing

### Unit Tests

```bash
npm test -- translation.service.spec.ts
```

### Integration Tests

```bash
# Test with LibreTranslate
TRANSLATION_PROVIDER=libretranslate npm test

# Test with Google Translate
TRANSLATION_PROVIDER=google npm test
```

### Manual Testing

```bash
# Trigger retroactive translation
curl -X POST http://localhost:3000/admin/trigger-translation

# Check translation stats
curl http://localhost:3000/news/translation/stats

# Get Spanish articles
curl http://localhost:3000/news/translation/language/es
```

## Migration Guide

### Running the Migration

```bash
# Generate migration (already created)
npm run migration:generate AddTranslationFields

# Run migration
npm run migration:run

# Revert if needed
npm run migration:revert
```

### Backfilling Existing Data

The retroactive translation job will automatically process existing articles. To manually trigger:

```typescript
await newsService.retroactivelyTranslateArticles();
```

## Monitoring

### Key Metrics

1. **Translation Success Rate**
   - Track successful vs failed translations
   - Monitor confidence scores

2. **Language Distribution**
   - Track most common source languages
   - Identify translation patterns

3. **Processing Time**
   - Monitor translation latency
   - Identify bottlenecks

4. **API Usage**
   - Track API calls to translation service
   - Monitor costs (for Google Translate)

### Logging

Translation events are logged with context:

```
[TranslationService] Translating article from es to en
[TranslationService] Translation completed in 450ms (confidence: 0.95)
[NewsService] Retroactive translation completed. Processed: 50, Errors: 2
```

## Future Enhancements

1. **Multi-language Support**
   - Store translations in multiple languages
   - Allow users to view original or translated content

2. **Translation Quality Scoring**
   - Implement quality metrics
   - Flag low-quality translations for review

3. **Custom Translation Models**
   - Train domain-specific models for crypto terminology
   - Improve accuracy for technical content

4. **Real-time Translation**
   - WebSocket support for live translation
   - Stream translated content to clients

5. **Translation Memory**
   - Cache common phrases and terms
   - Reduce API calls and costs

## Troubleshooting

### Translation Not Working

1. Check `TRANSLATION_ENABLED` is set to `true`
2. Verify translation provider credentials
3. Check API endpoint accessibility
4. Review logs for error messages

### Low Confidence Scores

1. Ensure sufficient text for detection (min 50 chars)
2. Check for mixed-language content
3. Verify text encoding (UTF-8)

### High API Costs

1. Enable caching for repeated content
2. Reduce retroactive job frequency
3. Consider self-hosted LibreTranslate
4. Implement translation memory

## Support

For issues or questions:
- GitHub Issues: https://github.com/Pulsefy/Lumenpulse/issues
- Documentation: https://docs.lumenpulse.com
- Email: support@lumenpulse.com
