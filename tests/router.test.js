import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../backend/routes/http.js';

test('clean routes and old hash links resolve to the same page', async () => {
  const bundle = await build({
    entryPoints: ['client/src/router.jsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'automatic',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  const { RouterProvider, Link, useRouter } = module.exports;
  const originalWindow = globalThis.window;
  let url = new URL('http://localhost:8125/#/projects');
  let backCalls = 0;
  const history = {
    state: null,
    replaceState(state, _title, next) {
      this.state = state;
      url = new URL(next, url);
    },
    pushState(state, _title, next) {
      this.state = state;
      url = new URL(next, url);
    },
    back() {
      backCalls++;
    },
  };
  globalThis.window = {
    get location() {
      return url;
    },
    history,
    scrollTo() {},
  };
  try {
    let router;
    function Capture() {
      router = useRouter();
      return React.createElement(Link, { to: '/teams' }, 'Teams');
    }
    const html = renderToStaticMarkup(
      React.createElement(RouterProvider, null, React.createElement(Capture)),
    );
    assert.equal(router.path, '/projects');
    assert.equal(url.href, 'http://localhost:8125/projects');
    assert.match(html, /href="\/teams"/);
    router.navigate('/teams');
    assert.equal(url.pathname, '/teams');
    assert.equal(url.hash, '');
    router.back();
    assert.equal(backCalls, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('server serves the app for a directly opened project URL', async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'brainadz-router-'));
  const distDir = path.join(folder, 'dist');
  mkdirSync(distDir);
  writeFileSync(
    path.join(distDir, 'index.html'),
    '<!doctype html><title>BrainADZ route test</title>',
  );
  const { app } = createApp({ db: {}, dataDir: folder, distDir });
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/projects/42/tasks/7`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /BrainADZ route test/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(folder, { recursive: true, force: true });
  }
});
