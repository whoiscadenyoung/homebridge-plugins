import { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { Aranet4Platform } from './platform.js';

/**
 * Register the Aranet4 Dynamic Platform Plugin with Homebridge.
 */
export default (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, Aranet4Platform);
};
