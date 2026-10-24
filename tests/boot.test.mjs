// A fresh clone ships without FREEBUFF_CLIENT_ID. The Worker must still boot
// and serve the public site — a missing auth client used to throw inside
// createFreebuffAuth on every request, 500ing the whole app including the
// landing page. These tests pin the graceful-degradation behaviour.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers.mjs";
import worker from "../worker/index.js";

const ASSETS_STUB = {
  fetch: () => new Response("<!doctype html><title>Mehfil</title>", {
    status: 200, headers: { "content-type": "text/html" },
  }),
};

const envWithoutAuth = () => ({ ...makeEnv(), ASSETS: ASSETS_STUB });

// The worker caches its auth instance on globalThis; isolate each call so a
// shim created for one env is never reused for another.
const call = async (env, path, init = {}) => {
  delete globalThis.__mehfilAuth;
  const res = await worker.fetch(new Request(`http://127.0.0.1:8787${path}`, init), env);
  delete globalThis.__mehfilAuth;
  return res;
};

test("public API serves with no auth client configured", async () => {
  const res = await call(envWithoutAuth(), "/api/meta");
  assert.equal(res.status, 200, "the landing page's data must not depend on auth config");
  const body = await res.json();
  assert.ok(Array.isArray(body.categories), "meta returns real shape");
});

test("protected routes answer 401, not 500, when auth is unconfigured", async () => {
  const res = await call(envWithoutAuth(), "/api/me");
  assert.equal(res.status, 401, "honest 401 — sign-in is impossible without a client ID");
  const body = await res.json().catch(() => ({}));
  assert.ok(body.error, "the 401 carries a message");
});

test("the SPA shell still renders for public pages", async () => {
  const res = await call(envWithoutAuth(), "/discover");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
});
