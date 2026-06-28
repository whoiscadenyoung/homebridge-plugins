import { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { AirmegaPlatform } from './platform.js';

export default function(api: API) {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, AirmegaPlatform);
};
