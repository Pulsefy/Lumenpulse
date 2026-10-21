/** Any HTTP response means the endpoint is reachable, including 4xx and 5xx. */
export async function checkConnection(url: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
