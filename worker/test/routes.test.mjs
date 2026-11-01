import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.ts';

const env = { ANTHROPIC_API_KEY: 'fixture-chat', ELEVENLABS_API_KEY: 'fixture-tts',
  ELEVENLABS_VOICE_ID: 'fixture-voice', ASSEMBLYAI_API_KEY: 'fixture-asr' };
const cases = [
  { path: '/chat', url: 'https://api.anthropic.com/v1/messages', method: 'POST',
    body: '{"message":"hello"}', auth: ['x-api-key', env.ANTHROPIC_API_KEY],
    response: 'chat fixture', type: 'text/event-stream' },
  { path: '/tts', url: 'https://api.elevenlabs.io/v1/text-to-speech/fixture-voice', method: 'POST',
    body: '{"text":"hello"}', auth: ['xi-api-key', env.ELEVENLABS_API_KEY],
    response: 'audio fixture', type: 'audio/mpeg' },
  { path: '/transcribe-token', url: 'https://streaming.assemblyai.com/v3/token?expires_in_seconds=480',
    method: 'GET', auth: ['authorization', env.ASSEMBLYAI_API_KEY],
    response: '{"token":"fixture"}', type: 'application/json' },
];

test('proxy routes preserve request and response contracts without real network calls', async () => {
  const original = globalThis.fetch;
  const originalError = console.error;
  let current;
  let calls = 0;
  let status = 200;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), current.url);
    assert.equal(options.method, current.method);
    assert.equal(options.headers[current.auth[0]], current.auth[1]);
    assert.equal(options.body, current.body);
    if (current.body) assert.equal(options.headers['content-type'], 'application/json');
    return new Response(status === 200 ? current.response : '{"error":"fixture"}',
      { status, headers: { 'content-type': current.type } });
  };
  console.error = () => {};
  try {
    assert.equal((await worker.fetch(new Request('https://local.invalid/chat'), env)).status, 405);
    assert.equal((await worker.fetch(new Request('https://local.invalid/nope', { method: 'POST' }), env)).status, 404);
    assert.equal(calls, 0);
    for (current of cases) {
      for (status of [200, 429]) {
        const result = await worker.fetch(new Request(`https://local.invalid${current.path}`,
          { method: 'POST', body: current.body ?? '{}' }), env);
        assert.equal(result.status, status);
        assert.equal(result.headers.get('content-type'), status === 200 ? current.type : 'application/json');
        assert.equal(await result.text(), status === 200 ? current.response : '{"error":"fixture"}');
        if (current.path === '/chat' && status === 200) assert.equal(result.headers.get('cache-control'), 'no-cache');
      }
    }
    assert.equal(calls, 6);
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
  }
});
