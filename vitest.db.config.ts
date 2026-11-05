import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // moment-timezone requires the CommonJS entry. Vite's jsnext:main preference
  // otherwise hands its require() an ESM file in workerd's test module loader.
  resolve: {
    alias: [
      {
        find: /^moment$/,
        replacement: new URL('./node_modules/moment/moment.js', import.meta.url).pathname,
      },
    ],
  },
  plugins: [
    cloudflareTest(async () => {
      const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
      const validationKeys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
      return {
        main: './src/worker/index.ts',
        miniflare: {
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB', 'MIGRATION_DB'],
          r2Buckets: ['RECOVERY', 'BACKUP_INVENTORY'],
          durableObjects: { OFFLINE_COORDINATOR: { className: 'OfflineControl', useSQLite: true } },
          bindings: {
            RECOVERY_CONTROL_SECRET: 'synthetic-offline-control-token-not-a-deployed-secret',
            QUIESCENCE_TRUST: JSON.stringify({
              ...(await crypto.subtle.exportKey('jwk', keys.publicKey)),
              alg: undefined,
            }),
            TEST_QUIESCENCE_SIGNING_KEY: JSON.stringify({
              ...(await crypto.subtle.exportKey('jwk', keys.privateKey)),
              alg: undefined,
            }),
            RECOVERY_VALIDATION_TRUST: JSON.stringify({
              ...(await crypto.subtle.exportKey('jwk', validationKeys.publicKey)),
              alg: undefined,
            }),
            TEST_RECOVERY_VALIDATION_SIGNING_KEY: JSON.stringify({
              ...(await crypto.subtle.exportKey('jwk', validationKeys.privateKey)),
              alg: undefined,
            }),
            TEST_MIGRATIONS: await readD1Migrations('src/worker/db/migrations'),
          },
        },
      };
    }),
    {
      name: 'workerd-bounded-module-transport',
      configureVitest({ project }) {
        const pool = project.config.poolRunner;
        if (!pool) throw new Error('Cloudflare pool must be configured first');
        const create = pool.createPoolWorker.bind(pool);
        pool.createPoolWorker = (options) => {
          const worker = create(options);
          const on = worker.on.bind(worker),
            send = worker.send.bind(worker);
          const warmRequests = new Set<string>();
          worker.on = (event, callback) =>
            on(event, (...args: unknown[]) => {
              const message = args[0];
              if (
                event === 'message' &&
                message &&
                typeof message === 'object' &&
                'm' in message &&
                message.m === 'fetchWarmModules' &&
                'i' in message &&
                typeof message.i === 'string'
              )
                warmRequests.add(message.i);
              callback(...args);
            });
          worker.send = (message) => {
            // Plugin 1.4.8 inlines the entire warm graph into one WebSocket frame.
            // The public gazetteer makes it exceed workerd's 32 MiB frame limit.
            // An empty warm cache makes Vitest fetch the SAME modules individually;
            // this preserves per-file isolation and every test's actual Worker code.
            if (
              't' in message &&
              message.t === 's' &&
              'i' in message &&
              typeof message.i === 'string' &&
              warmRequests.delete(message.i)
            ) {
              const reply = { ...message, r: {} };
              send(reply);
            } else send(message);
          };
          return worker;
        };
      },
    },
  ],
  test: {
    include: ['tests/db/**/*.test.ts'],
    setupFiles: ['tests/deny-network.ts'],
    // Bound simultaneous workerd/storage environments; keep per-file isolation
    // and the existing deadlines so restore-heavy suites do not starve each other.
    maxWorkers: 2,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
