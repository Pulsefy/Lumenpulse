import logging
import unicodedata
import requests
from langdetect import detect

logger = logging.getLogger(__name__)

def normalize_text(text: str) -> str:
    """
    Applies NFKD unicode normalization, normalizes spacing, and strips text.
    Keeps casing intact as it is valuable for sentiment analysis.
    """
    if not text:
        return ""
    
    # NFKD normalization decomposes characters (e.g. accented characters)
    normalized = unicodedata.normalize("NFKD", text)
    
    # Clean up whitespace and join
    lines = normalized.splitlines()
    cleaned_lines = []
    for line in lines:
        cleaned_words = " ".join(line.split())
        if cleaned_words:
            cleaned_lines.append(cleaned_words)
            
    return "\n".join(cleaned_lines).strip()

def translate_to_english(text: str, source_lang: str = "auto") -> str:
    """
    Translates non-English text to English using Google's public translation endpoint.
    If the translation fails or times out, falls back to the original text.
    """
    if not text or not text.strip():
        return text

    url = "https://translate.googleapis.com/translate_a/single"
    params = {
        "client": "gtx",
        "sl": source_lang,
        "tl": "en",
        "dt": "t",
        "q": text
    }

    try:
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        
        # Parse the translation chunks returned by Google Translate
        if data and len(data) > 0 and data[0]:
            translated_chunks = []
            for chunk in data[0]:
                if chunk and len(chunk) > 0 and chunk[0]:
                    translated_chunks.append(chunk[0])
            if translated_chunks:
                return "".join(translated_chunks)
                
    except Exception as e:
        logger.warning(f"Translation failed, falling back to original text. Error: {e}")
        
    return text

def translate_and_normalize(text: str) -> str:
    """
    Detects the language of the text. If it is not English, normalizes and
    translates it to English. If it is English, just normalizes it.
    """
    if not text or not text.strip():
        return ""

    # 1. Normalize first (helpful for language detection)
    normalized = normalize_text(text)
    
    # 2. Detect language
    try:
        lang = detect(normalized)
    except Exception:
        # Default to English if detection fails (e.g. no letters)
        lang = "en"

    # 3. Translate if not English
    if lang != "en":
        logger.info(f"Detected language '{lang}'. Translating to English.")
        return translate_to_english(normalized, source_lang=lang)
        
    return normalized
