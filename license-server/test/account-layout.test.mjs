import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/site.css', import.meta.url), 'utf8');

test('signed-in account dashboard expands to the full account shell', () => {
  assert.match(css, /\.account-layout:has\(#loginCard\.hidden\)\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.account-layout:has\(#loginCard\.hidden\)\s*>\s*\.account-card:not\(#loginCard\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
});

test('plans explain why checkout is unavailable when no payment method is enabled', () => {
  assert.match(css, /\.plan:not\(:has\(\.payment-method-select\)\)::after/);
  assert.match(css, /支付方式尚未启用，暂不能创建订单/);
});
