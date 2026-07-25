import { getReleaseMetadata, fallbackReleaseMetadata } from '../release-metadata';

/**
 * Test: Verify release metadata contains valid format
 */
export function testReleaseMetadataKeys(): boolean {
  try {
    const data = getReleaseMetadata();
    
    if (!data || !Array.isArray(data.releases)) {
      console.error('✗ Release metadata releases list is missing or not an array');
      return false;
    }

    if (data.releases.length === 0) {
      console.error('✗ Release metadata releases list is empty');
      return false;
    }

    const firstRelease = data.releases[0];
    const hasKeys = 
      typeof firstRelease.version === 'string' &&
      typeof firstRelease.title === 'string' &&
      Array.isArray(firstRelease.notes);

    if (!hasKeys) {
      console.error('✗ Release info is missing required fields (version, title, or notes)');
      return false;
    }

    console.log('✓ Release metadata structure verified successfully');
    return true;
  } catch (error) {
    console.error('✗ testReleaseMetadataKeys threw an error:', error);
    return false;
  }
}

/**
 * Test: Verify fallback content matches fallbackReleaseMetadata keys
 */
export function testFallbackActivation(): boolean {
  try {
    const fallback = fallbackReleaseMetadata;
    
    if (!fallback || !Array.isArray(fallback.releases) || fallback.releases.length === 0) {
      console.error('✗ Fallback metadata releases list is missing or invalid');
      return false;
    }

    const firstFallback = fallback.releases[0];
    const isCorrect = 
      firstFallback.version === '1.0.0' && 
      Array.isArray(firstFallback.notes) &&
      firstFallback.notes.length > 0;

    if (!isCorrect) {
      console.error('✗ Fallback metadata structure is incorrect');
      return false;
    }

    console.log('✓ Fallback release metadata verified successfully');
    return true;
  } catch (error) {
    console.error('✗ testFallbackActivation threw an error:', error);
    return false;
  }
}

/**
 * Run all release notes tests
 */
export function runReleaseMetadataTests(): boolean {
  console.log('=== Release Metadata Tests ===\n');

  console.log('1. Testing metadata structure...');
  const test1 = testReleaseMetadataKeys();
  console.log(test1 ? '✓ PASS\n' : '✗ FAIL\n');

  console.log('2. Testing fallback activation...');
  const test2 = testFallbackActivation();
  console.log(test2 ? '✓ PASS\n' : '✗ FAIL\n');

  const allPassed = test1 && test2;
  console.log(allPassed ? '=== ALL RELEASE METADATA TESTS PASSED ===' : '=== SOME RELEASE METADATA TESTS FAILED ===');
  
  return allPassed;
}
