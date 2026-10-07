import { createRequire } from 'node:module';

export const PLATFORM_NAME = 'AirmegaPlatform';
export const PLUGIN_NAME = 'homebridge-airmega-iocare';

// package.json sits outside rootDir, so it can't be imported; read it at
// runtime instead (dist/settings.js resolves it from the package root).
export const PLUGIN_VERSION: string = createRequire(import.meta.url)('../package.json').version;

export const DEFAULT_POLL_SECONDS = 60;
