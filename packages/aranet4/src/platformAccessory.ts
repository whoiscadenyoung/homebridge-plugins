import {
  Characteristic as HBCharacteristic,
  Service,
  PlatformAccessory,
  CharacteristicValue,
  Logger,
  API,
  HAP,
} from 'homebridge';
import {
  Aranet4Reading,
  Aranet4DeviceConfig,
  AIR_QUALITY_THRESHOLDS,
  DEFAULT_CO2_ALERT_THRESHOLD,
  DEFAULT_LOW_BATTERY_THRESHOLD,
} from './settings.js';
import { MqttPublisher } from './mqttPublisher.js';

// ---------------------------------------------------------------------------
// Eve-compatible custom characteristic for atmospheric pressure
// Defined once at module level and reused across all accessory instances.
// ---------------------------------------------------------------------------
const EVE_AIR_PRESSURE_UUID = 'E863F10F-079E-48FF-8F27-9C2605A29F52';

let EvePressureCharacteristic: (new () => HBCharacteristic) | null = null;

/**
 * Lazily create the Eve pressure characteristic class. Must be called after
 * the HAP API is available (i.e. inside the accessory constructor, not at
 * import time). The class is created once and cached for all instances.
 */
function getEvePressureCharacteristic(hap: HAP): (new () => HBCharacteristic) | null {
  if (EvePressureCharacteristic) {
    return EvePressureCharacteristic;
  }
  try {
    const CharBase = hap.Characteristic;
    EvePressureCharacteristic = class extends CharBase {
      static readonly UUID = EVE_AIR_PRESSURE_UUID;
      constructor() {
        super('Air Pressure', EVE_AIR_PRESSURE_UUID, {
          format: hap.Formats.UINT16,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
          minValue: 300,
          maxValue: 1200,
          minStep: 1,
        });
      }
    };
    return EvePressureCharacteristic;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stable service subtype identifiers — decoupled from display names so that
// renaming a sensor doesn't orphan cached services.
// ---------------------------------------------------------------------------
const SERVICE_SUBTYPES = {
  co2: 'co2-sensor',
  temperature: 'temperature-sensor',
  humidity: 'humidity-sensor',
  airQuality: 'air-quality-sensor',
  battery: 'battery',
} as const;

// ---------------------------------------------------------------------------
// Aranet4Accessory — exposes sensor data as HomeKit services
// ---------------------------------------------------------------------------

export class Aranet4Accessory {
  private readonly hap: HAP;
  private readonly config: Aranet4DeviceConfig;

  // Services
  private readonly co2Service: Service;
  private readonly temperatureService: Service;
  private readonly humidityService: Service;
  private readonly airQualityService: Service;
  private readonly batteryService: Service;

  // Eve pressure custom characteristic (optional)
  private pressureCharacteristic: HBCharacteristic | null = null;

  // Fakegato history service (set via setHistoryService by the platform)
  private _historyService: (Service & { addEntry(entry: { time: number; [key: string]: number }): void }) | null = null;

  // Last known reading
  private latestReading: Aranet4Reading | null = null;
  private sensorActive = false;

  constructor(
    private readonly log: Logger,
    private readonly api: API,
    public readonly accessory: PlatformAccessory,
    config?: Aranet4DeviceConfig,
    private readonly mqttPublisher?: MqttPublisher,
  ) {
    this.hap = this.api.hap;
    this.config = config ?? {
      name: accessory.displayName,
      pollingInterval: 60,
      co2AlertThreshold: DEFAULT_CO2_ALERT_THRESHOLD,
      lowBatteryThreshold: DEFAULT_LOW_BATTERY_THRESHOLD,
      enableHistory: true,
    };

    // =====================================================================
    // Accessory Information
    // =====================================================================
    this.accessory.getService(this.hap.Service.AccessoryInformation)!
      .setCharacteristic(this.hap.Characteristic.Manufacturer, 'SAF Tehnika')
      .setCharacteristic(this.hap.Characteristic.Model, 'Aranet4')
      .setCharacteristic(this.hap.Characteristic.SerialNumber, this.accessory.UUID.substring(0, 12));

    // =====================================================================
    // Carbon Dioxide Sensor
    // =====================================================================
    this.co2Service = this.getOrAddService(this.hap.Service.CarbonDioxideSensor, 'CO2', SERVICE_SUBTYPES.co2);

    this.co2Service.getCharacteristic(this.hap.Characteristic.CarbonDioxideLevel)
      .onGet(this.getCO2Level.bind(this));

    this.co2Service.getCharacteristic(this.hap.Characteristic.CarbonDioxideDetected)
      .onGet(this.getCO2Detected.bind(this));

    this.co2Service.getCharacteristic(this.hap.Characteristic.StatusActive)
      .onGet(() => this.sensorActive);

    // =====================================================================
    // Temperature Sensor
    // =====================================================================
    this.temperatureService = this.getOrAddService(this.hap.Service.TemperatureSensor, 'Temperature', SERVICE_SUBTYPES.temperature);

    this.temperatureService.getCharacteristic(this.hap.Characteristic.CurrentTemperature)
      .onGet(this.getTemperature.bind(this));

    this.temperatureService.getCharacteristic(this.hap.Characteristic.StatusActive)
      .onGet(() => this.sensorActive);

    // =====================================================================
    // Humidity Sensor
    // =====================================================================
    this.humidityService = this.getOrAddService(this.hap.Service.HumiditySensor, 'Humidity', SERVICE_SUBTYPES.humidity);

    this.humidityService.getCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getHumidity.bind(this));

    this.humidityService.getCharacteristic(this.hap.Characteristic.StatusActive)
      .onGet(() => this.sensorActive);

    // =====================================================================
    // Air Quality Sensor (derived from CO2)
    // =====================================================================
    this.airQualityService = this.getOrAddService(this.hap.Service.AirQualitySensor, 'Air Quality', SERVICE_SUBTYPES.airQuality);

    this.airQualityService.getCharacteristic(this.hap.Characteristic.AirQuality)
      .onGet(this.getAirQuality.bind(this));

    this.airQualityService.getCharacteristic(this.hap.Characteristic.StatusActive)
      .onGet(() => this.sensorActive);

    // =====================================================================
    // Battery Service
    // =====================================================================
    this.batteryService = this.getOrAddService(this.hap.Service.Battery, 'Battery', SERVICE_SUBTYPES.battery);

    this.batteryService.getCharacteristic(this.hap.Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this));

    this.batteryService.getCharacteristic(this.hap.Characteristic.StatusLowBattery)
      .onGet(this.getLowBattery.bind(this));

    // =====================================================================
    // Eve-compatible Atmospheric Pressure (custom characteristic)
    // =====================================================================
    this.setupEvePressure();

    this.log.debug(`Accessory initialized: ${this.config.name}`);
  }

  // -----------------------------------------------------------------------
  // Public — called by the platform to attach FakeGato history
  // -----------------------------------------------------------------------

  /** Attach a FakeGato history service to this accessory. */
  setHistoryService(service: Service & { addEntry(entry: { time: number; [key: string]: number }): void }): void {
    this._historyService = service;
  }

  // -----------------------------------------------------------------------
  // Public — called by the platform when a new reading arrives
  // -----------------------------------------------------------------------

  /** Push a new sensor reading to all HomeKit services. */
  updateReading(reading: Aranet4Reading): void {
    this.latestReading = reading;
    this.sensorActive = true;

    // CO2
    this.co2Service.updateCharacteristic(
      this.hap.Characteristic.CarbonDioxideLevel,
      reading.co2,
    );
    this.co2Service.updateCharacteristic(
      this.hap.Characteristic.CarbonDioxideDetected,
      reading.co2 >= this.config.co2AlertThreshold
        ? this.hap.Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
        : this.hap.Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL,
    );
    this.co2Service.updateCharacteristic(this.hap.Characteristic.StatusActive, true);

    // Temperature
    this.temperatureService.updateCharacteristic(
      this.hap.Characteristic.CurrentTemperature,
      reading.temperature,
    );
    this.temperatureService.updateCharacteristic(this.hap.Characteristic.StatusActive, true);

    // Humidity
    this.humidityService.updateCharacteristic(
      this.hap.Characteristic.CurrentRelativeHumidity,
      reading.humidity,
    );
    this.humidityService.updateCharacteristic(this.hap.Characteristic.StatusActive, true);

    // Air Quality (derived from CO2)
    this.airQualityService.updateCharacteristic(
      this.hap.Characteristic.AirQuality,
      this.co2ToAirQuality(reading.co2),
    );
    this.airQualityService.updateCharacteristic(this.hap.Characteristic.StatusActive, true);

    // Battery
    this.batteryService.updateCharacteristic(
      this.hap.Characteristic.BatteryLevel,
      reading.battery,
    );
    this.batteryService.updateCharacteristic(
      this.hap.Characteristic.StatusLowBattery,
      reading.battery < this.config.lowBatteryThreshold
        ? this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    );

    // Pressure (Eve custom — UINT16 characteristic, must be integer)
    if (this.pressureCharacteristic) {
      this.pressureCharacteristic.updateValue(Math.round(reading.pressure));
    }

    // Fakegato history entry
    if (this._historyService) {
      this._historyService.addEntry({
        time: Math.round(reading.timestamp / 1000),
        temp: reading.temperature,
        humidity: reading.humidity,
        ppm: reading.co2,
      });
    }

    // MQTT logging
    this.mqttPublisher?.publish(
      (this.accessory.context.deviceId as string | undefined) ?? this.accessory.UUID,
      {
        co2:         reading.co2,
        temperature: reading.temperature,
        pressure:    reading.pressure,
        humidity:    reading.humidity,
        battery:     reading.battery,
        status:      reading.status,
        interval:    reading.interval,
        age:         reading.age,
      },
    );

  }

  /** Mark the sensor as inactive (e.g. device disconnected). */
  setFault(): void {
    this.sensorActive = false;
    const services = [
      this.co2Service,
      this.temperatureService,
      this.humidityService,
      this.airQualityService,
    ];
    for (const svc of services) {
      svc.updateCharacteristic(this.hap.Characteristic.StatusActive, false);
    }
  }

  // -----------------------------------------------------------------------
  // HomeKit characteristic getters
  // -----------------------------------------------------------------------

  private getCO2Level(): CharacteristicValue {
    return this.latestReading?.co2 ?? 0;
  }

  private getCO2Detected(): CharacteristicValue {
    if (this.latestReading && this.latestReading.co2 >= this.config.co2AlertThreshold) {
      return this.hap.Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL;
    }
    return this.hap.Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL;
  }

  private getTemperature(): CharacteristicValue {
    return this.latestReading?.temperature ?? 0;
  }

  private getHumidity(): CharacteristicValue {
    return this.latestReading?.humidity ?? 0;
  }

  private getAirQuality(): CharacteristicValue {
    if (!this.latestReading) {
      return this.hap.Characteristic.AirQuality.UNKNOWN;
    }
    return this.co2ToAirQuality(this.latestReading.co2);
  }

  private getBatteryLevel(): CharacteristicValue {
    return this.latestReading?.battery ?? 0;
  }

  private getLowBattery(): CharacteristicValue {
    if (this.latestReading && this.latestReading.battery < this.config.lowBatteryThreshold) {
      return this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    }
    return this.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  // -----------------------------------------------------------------------
  // CO2 → AirQuality mapping
  // -----------------------------------------------------------------------

  private co2ToAirQuality(co2: number): number {
    if (co2 <= AIR_QUALITY_THRESHOLDS.EXCELLENT) {
      return this.hap.Characteristic.AirQuality.EXCELLENT;
    }
    if (co2 <= AIR_QUALITY_THRESHOLDS.GOOD) {
      return this.hap.Characteristic.AirQuality.GOOD;
    }
    if (co2 <= AIR_QUALITY_THRESHOLDS.FAIR) {
      return this.hap.Characteristic.AirQuality.FAIR;
    }
    if (co2 <= AIR_QUALITY_THRESHOLDS.INFERIOR) {
      return this.hap.Characteristic.AirQuality.INFERIOR;
    }
    return this.hap.Characteristic.AirQuality.POOR;
  }

  // -----------------------------------------------------------------------
  // Eve-compatible pressure characteristic
  // -----------------------------------------------------------------------

  private setupEvePressure(): void {
    try {
      const PressureChar = getEvePressureCharacteristic(this.hap);
      if (!PressureChar) {
        this.log.warn('Could not create Eve pressure characteristic class');
        return;
      }

      // Check if the characteristic already exists (e.g. from a cached
      // accessory restore) to avoid duplicating it on every restart.
      const existing = this.airQualityService.getCharacteristic(EVE_AIR_PRESSURE_UUID);
      if (existing) {
        existing.onGet(() => Math.round(this.latestReading?.pressure ?? 1013));
        this.pressureCharacteristic = existing;
        this.log.debug('Eve-compatible pressure characteristic restored from cache');
        return;
      }

      // Add to the air quality service (first time only)
      const char = this.airQualityService.addCharacteristic(
        new PressureChar(),
      );
      char.onGet(() => Math.round(this.latestReading?.pressure ?? 1013));
      this.pressureCharacteristic = char;
      this.log.debug('Eve-compatible pressure characteristic added');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.warn(`Could not add Eve pressure characteristic: ${msg}`);
    }
  }

  // -----------------------------------------------------------------------
  // Service helper
  // -----------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getOrAddService(serviceType: any, displayName: string, subtype: string): Service {
    return (
      this.accessory.getServiceById(serviceType, subtype) ??
      this.accessory.addService(serviceType, displayName, subtype)
    );
  }
}
