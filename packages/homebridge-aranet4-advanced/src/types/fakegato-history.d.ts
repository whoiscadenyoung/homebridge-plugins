/**
 * Minimal type declarations for fakegato-history.
 *
 * fakegato-history is a CommonJS module that exports a factory function.
 * The factory accepts a Homebridge API instance and returns a class
 * constructor for Eve-compatible history services.
 */

declare module 'fakegato-history' {
  import { API, PlatformAccessory, Logger, Service } from 'homebridge';

  interface FakeGatoHistoryOptions {
    /** Logger instance. */
    log?: Logger;
    /** Storage type — 'fs' for filesystem-backed persistence. */
    storage?: 'fs' | 'googleDrive';
    /** Directory path for 'fs' storage. */
    path?: string;
    /** Custom filename for the history JSON file. */
    filename?: string;
    /** Number of minutes between persistence writes (default 10). */
    minutes?: number;
  }

  interface FakeGatoHistoryEntry {
    time: number; // Unix timestamp in seconds
    [key: string]: number;
  }

  interface FakeGatoHistoryService extends Service {
    addEntry(entry: FakeGatoHistoryEntry): void;
  }

  interface FakeGatoHistoryConstructor {
    new (
      type: 'weather' | 'energy' | 'room' | 'door' | 'motion' | 'thermo' | 'aqua',
      accessory: PlatformAccessory,
      options?: FakeGatoHistoryOptions,
    ): FakeGatoHistoryService;
  }

  function fakegato(api: API): FakeGatoHistoryConstructor;

  export = fakegato;
}
