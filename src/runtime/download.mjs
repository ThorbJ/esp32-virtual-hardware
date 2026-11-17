// Downloading one file on a network that may stall or break: what the virtual device page fetches (the package's files, and the
// page may use it for anything else big, such as the Kit model). Device independent; browser and Node 22+.
//
// A try that brings no byte for stallMs, or whose connection breaks, is given up and the file is asked for again from the first
// missing byte (HTTP Range, with If-Range on the first response's ETag so a changed file is sent whole); a server that answers
// with the whole file is read from the start. Pauses between tries grow (retryDelayMs, doubled each time, at most 8×). The tries
// give up only after `retries` tries in a row that brought nothing: a slow network that keeps delivering is never given up on.
// Errors that will not change by asking again (HTTP 4xx other than 408 / 429) fail at once. Every failure has code
// 'download_failed', so a page can say so and offer to try again.

const MAX_BACKOFF = 8;

class Retry extends Error {}

const failure = (message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code: 'download_failed' });
const transient = (status) => status >= 500 || status === 408 || status === 429;

/** The first byte a 206 response holds (Content-Range: bytes a-b/n), and n when given. */
function contentRange(res) {
  const m = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(res.headers.get('content-range') ?? '');
  return m ? { start: Number(m[1]), size: m[2] === '*' ? null : Number(m[2]) } : null;
}

/**
 * Resolves to the file's bytes. Options: size (expected bytes, else from the response), onProgress(loaded, total), onRetry({ url,
 * attempt, loaded, reason: 'stalled' | 'network' | 'http' | 'short' }), stallMs (15 s), retries (4), retryDelayMs (1 s), fetchImpl.
 */
export async function downloadFile(url, { size = null, onProgress = () => {}, onRetry = () => {}, fetchImpl = globalThis.fetch, stallMs = 15_000, retries = 4, retryDelayMs = 1000 } = {}) {
  let chunks = [];
  let loaded = 0;
  let total = size ?? 0;
  let validator = null;
  let failures = 0;
  const restart = () => { chunks = []; loaded = 0; };

  for (;;) {
    const abort = new AbortController();
    let stalled = false;
    let timer = null;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; abort.abort(); }, stallMs); };
    const before = loaded;
    try {
      arm();
      const headers = {};
      if (loaded > 0) {
        headers.Range = `bytes=${loaded}-`;
        if (validator) headers['If-Range'] = validator;
      }
      const res = await fetchImpl(url, { headers, signal: abort.signal });
      if (res.status === 206) {
        const range = contentRange(res);
        if (!range || range.start !== loaded) { restart(); throw Object.assign(new Retry('unexpected range'), { reason: 'http' }); }
        if (!size && range.size) total = range.size;
      } else if (res.ok) {
        restart(); // the whole file (first try, or a server that does not resume)
        if (!size) total = Number(res.headers.get('content-length')) || 0;
      } else if (transient(res.status)) {
        throw Object.assign(new Retry(`HTTP ${res.status}`), { reason: 'http' });
      } else {
        throw failure(`${url}: HTTP ${res.status}`);
      }
      validator ??= res.headers.get('etag');
      if (!size && res.status === 206 && !total) total = loaded + (Number(res.headers.get('content-length')) || 0);

      if (!res.body?.getReader) {
        const b = new Uint8Array(await res.arrayBuffer());
        chunks.push(b);
        loaded += b.byteLength;
      } else {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          arm();
          chunks.push(value);
          loaded += value.byteLength;
          onProgress(loaded, Math.max(total, loaded));
        }
      }
      if (total && loaded < total) throw Object.assign(new Retry('ended early'), { reason: 'short' });
      clearTimeout(timer);
      const out = new Uint8Array(loaded);
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.byteLength; }
      onProgress(loaded, loaded);
      return out;
    } catch (err) {
      clearTimeout(timer);
      abort.abort();
      if (err?.code === 'download_failed') throw err;
      const reason = stalled ? 'stalled' : err instanceof Retry ? err.reason : 'network';
      if (loaded > before) failures = 0;
      failures++;
      if (failures > retries) throw failure(`${url}: download failed (${reason}${err instanceof Retry ? `: ${err.message}` : ''}) after ${failures} tries`, err);
      onRetry({ url, attempt: failures, loaded, reason });
      await new Promise((r) => setTimeout(r, retryDelayMs * Math.min(MAX_BACKOFF, 2 ** (failures - 1))));
    }
  }
}
