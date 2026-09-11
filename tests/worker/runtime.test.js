import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { keccak256, parseTransaction, recoverTransactionAddress, erc20Abi, decodeFunctionData, encodeFunctionResult } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Build the actual entrypoint in an isolated directory with only test configuration.
// All external traffic is intercepted; no Cloudflare account or real funds are used.
test('complete compiled Worker validates CAPTCHA, signs and broadcasts, persists D1 cooldown and runs cron', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anubis-worker-'));
  let mf;
  try {
    cpSync('worker', join(dir, 'worker'), { recursive: true });
    mkdirSync(join(dir, 'src/lib'), { recursive: true });
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
    writeFileSync(join(dir, 'src/lib/faucet-config.json'), JSON.stringify({ chain: { id: 31337, rpcUrl: 'https://rpc.example.test', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 } }, tokens: [{ address: '0x3333333333333333333333333333333333333333', name: 'DAI', symbol: 'DAI', decimals: 18 }], distribution: { nativeAmount: '', tokenAmount: '1', rateLimitHours: '24' } }));
    writeFileSync(join(dir, 'worker/config.json'), JSON.stringify({ allowedOrigins: [], turnstile: { hostnames: ['faucet.example'], action: 'faucet_claim' } }));
    writeFileSync(join(dir, 'wrangler.jsonc'), JSON.stringify({ name: 'faucet-runtime-test', main: 'worker/index.js', compatibility_date: '2026-09-09', compatibility_flags: ['nodejs_compat'], d1_databases: [{ binding: 'DB', database_name: 'test', database_id: '00000000-0000-0000-0000-000000000000' }] }));
    execFileSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--outdir', 'build'], { cwd: dir, stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    const sent = [];
    const privateKey = `0x${'1'.repeat(64)}`;
    mf = new Miniflare(convertV4MiniflareOptions({
      modules: true, modulesRoot: join(dir, 'build'), scriptPath: join(dir, 'build/index.js'), compatibilityDate: '2026-09-09', compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'], bindings: { FAUCET_PRIVATE_KEY: privateKey, TURNSTILE_SECRET_KEY: 'test-secret' },
      async outboundService(request) {
        const body = await request.json();
        if (new URL(request.url).hostname === 'challenges.cloudflare.com') {
          assert.equal(body.secret, 'test-secret');
          assert.ok(body.remoteip);
          return Response.json({ success: body.response === 'valid-token', hostname: 'faucet.example', action: 'faucet_claim' });
        }
        assert.equal(new URL(request.url).hostname, 'rpc.example.test');
        const results = {
          eth_chainId: '0x7a69', eth_getTransactionCount: '0x7', eth_estimateGas: '0x5208', eth_gasPrice: '0x3b9aca00',
          eth_getBlockByNumber: { number: '0x1', hash: `0x${'0'.repeat(64)}`, timestamp: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [] },
          eth_getTransactionReceipt: null,
        };
        if (body.method === 'eth_call') {
          assert.equal(body.params[0].to.toLowerCase(), '0x3333333333333333333333333333333333333333');
          const call = decodeFunctionData({ abi: erc20Abi, data: body.params[0].data });
          assert.ok(['decimals', 'transfer'].includes(call.functionName));
          if (call.functionName === 'transfer') assert.deepEqual(call.args, ['0x2222222222222222222222222222222222222222', 10n ** 18n]);
          results.eth_call = encodeFunctionResult({ abi: erc20Abi, functionName: call.functionName, result: call.functionName === 'decimals' ? 18 : true });
        }
        if (body.method === 'eth_sendRawTransaction') { sent.push(body.params[0]); results.eth_sendRawTransaction = keccak256(body.params[0]); }
        assert.ok(body.method in results, body.method);
        return Response.json({ jsonrpc: '2.0', id: body.id, result: results[body.method] });
      },
    }));
    const db = await mf.getD1Database('DB');
    const sql = readFileSync('worker/migrations/0001_claims.sql', 'utf8').replace(/--[^\n]*/g, '');
    await db.batch(sql.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
    assert.equal((await mf.dispatchFetch('https://faucet.example/api/health')).status, 200);
    const claim = token => mf.dispatchFetch('https://faucet.example/api/distribute', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://faucet.example' }, body: JSON.stringify({ recipientAddress: '0x2222222222222222222222222222222222222222', turnstileToken: token, amount: '999999', tokenAddress: '0x4444444444444444444444444444444444444444' }) });
    assert.equal((await claim('invalid-token')).status, 400);
    assert.equal(sent.length, 0);
    const response = await claim('valid-token');
    assert.equal(response.status, 202, await response.clone().text());
    const result = await response.json();
    assert.equal(result.txHashes[0], keccak256(sent[0]));
    const transaction = parseTransaction(sent[0]);
    assert.equal(transaction.value ?? 0n, 0n);
    assert.equal(transaction.to.toLowerCase(), '0x3333333333333333333333333333333333333333');
    assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: transaction.data }), { functionName: 'transfer', args: ['0x2222222222222222222222222222222222222222', 10n ** 18n] });
    assert.equal(await recoverTransactionAddress({ serializedTransaction: sent[0] }), privateKeyToAccount(privateKey).address);
    assert.equal((await claim('different-token')).status, 429);
    assert.equal(new Set(sent).size, 1);
    const worker = await mf.getWorker();
    await worker.scheduled({ cron: '* * * * *' });
    assert.equal(new Set(sent).size, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM claims WHERE status='signed'").first()).n, 1);
  } finally { await mf?.dispose(); rmSync(dir, { recursive: true, force: true }); }
});
