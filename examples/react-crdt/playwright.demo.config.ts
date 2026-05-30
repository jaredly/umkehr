import {defineConfig, devices} from '@playwright/test';

const appPort = Number(process.env.UMKEHR_E2E_APP_PORT ?? 5173);
const serverPort = Number(process.env.UMKEHR_E2E_SERVER_PORT ?? 8788);
const peerPort = Number(process.env.UMKEHR_E2E_PEER_PORT ?? 9000);
const peerPath = process.env.UMKEHR_E2E_PEER_PATH ?? '/peerjs';

export default defineConfig({
    testDir: './tests/demo',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    reporter: 'list',
    use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${appPort}`,
        viewport: {width: 1440, height: 1000},
        trace: 'off',
        screenshot: 'only-on-failure',
        video: 'on',
    },
    projects: [{name: 'demo-chromium'}],
    webServer: {
        command: `VITE_UMKEHR_SERVER_HTTP_URL=http://localhost:${serverPort} VITE_UMKEHR_PEERJS_HOST=127.0.0.1 VITE_UMKEHR_PEERJS_PORT=${peerPort} VITE_UMKEHR_PEERJS_PATH=${peerPath} VITE_UMKEHR_PEERJS_SECURE=false npm run dev -- --configLoader runner --host 127.0.0.1 --port ${appPort}`,
        url: `http://127.0.0.1:${appPort}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
