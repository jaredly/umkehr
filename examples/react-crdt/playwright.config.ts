import {defineConfig, devices} from '@playwright/test';

const appPort = Number(process.env.UMKEHR_E2E_APP_PORT ?? 5173);
const serverPort = Number(process.env.UMKEHR_E2E_SERVER_PORT ?? 8788);

export default defineConfig({
    testDir: './tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
    use: {
        baseURL: `http://127.0.0.1:${appPort}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {...devices['Desktop Chrome']},
        },
    ],
    webServer: {
        command: `VITE_UMKEHR_SERVER_HTTP_URL=http://localhost:${serverPort} npm run dev -- --configLoader runner --host 127.0.0.1 --port ${appPort}`,
        url: `http://127.0.0.1:${appPort}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
