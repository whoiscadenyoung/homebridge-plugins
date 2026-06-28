import { AIR_QUALITY_THRESHOLDS } from '../src/settings';

/**
 * CO2 → AirQuality mapping tests.
 *
 * The mapping from the project plan:
 *   ≤600  → EXCELLENT (1)
 *   ≤800  → GOOD (2)
 *   ≤1000 → FAIR (3)
 *   ≤1500 → INFERIOR (4)
 *   >1500 → POOR (5)
 *
 * Since the actual mapping lives in platformAccessory.ts (a class with
 * HomeKit dependencies), we test the thresholds and a pure-function
 * equivalent here.
 */

// Reproduce the mapping logic as a pure function for testing
function co2ToAirQuality(co2: number): number {
  if (co2 <= AIR_QUALITY_THRESHOLDS.EXCELLENT) {
    return 1; // EXCELLENT
  }
  if (co2 <= AIR_QUALITY_THRESHOLDS.GOOD) {
    return 2; // GOOD
  }
  if (co2 <= AIR_QUALITY_THRESHOLDS.FAIR) {
    return 3; // FAIR
  }
  if (co2 <= AIR_QUALITY_THRESHOLDS.INFERIOR) {
    return 4; // INFERIOR
  }
  return 5; // POOR
}

describe('CO2 → AirQuality mapping', () => {
  it('should return EXCELLENT for CO2 ≤ 600', () => {
    expect(co2ToAirQuality(0)).toBe(1);
    expect(co2ToAirQuality(400)).toBe(1);
    expect(co2ToAirQuality(600)).toBe(1);
  });

  it('should return GOOD for CO2 601–800', () => {
    expect(co2ToAirQuality(601)).toBe(2);
    expect(co2ToAirQuality(700)).toBe(2);
    expect(co2ToAirQuality(800)).toBe(2);
  });

  it('should return FAIR for CO2 801–1000', () => {
    expect(co2ToAirQuality(801)).toBe(3);
    expect(co2ToAirQuality(900)).toBe(3);
    expect(co2ToAirQuality(1000)).toBe(3);
  });

  it('should return INFERIOR for CO2 1001–1500', () => {
    expect(co2ToAirQuality(1001)).toBe(4);
    expect(co2ToAirQuality(1200)).toBe(4);
    expect(co2ToAirQuality(1500)).toBe(4);
  });

  it('should return POOR for CO2 > 1500', () => {
    expect(co2ToAirQuality(1501)).toBe(5);
    expect(co2ToAirQuality(2000)).toBe(5);
    expect(co2ToAirQuality(5000)).toBe(5);
  });

  it('should handle exact boundary values', () => {
    expect(co2ToAirQuality(600)).toBe(1);  // Boundary → EXCELLENT
    expect(co2ToAirQuality(601)).toBe(2);  // Just over → GOOD
    expect(co2ToAirQuality(800)).toBe(2);  // Boundary → GOOD
    expect(co2ToAirQuality(801)).toBe(3);  // Just over → FAIR
    expect(co2ToAirQuality(1000)).toBe(3); // Boundary → FAIR
    expect(co2ToAirQuality(1001)).toBe(4); // Just over → INFERIOR
    expect(co2ToAirQuality(1500)).toBe(4); // Boundary → INFERIOR
    expect(co2ToAirQuality(1501)).toBe(5); // Just over → POOR
  });
});

describe('AIR_QUALITY_THRESHOLDS constants', () => {
  it('should have the expected threshold values', () => {
    expect(AIR_QUALITY_THRESHOLDS.EXCELLENT).toBe(600);
    expect(AIR_QUALITY_THRESHOLDS.GOOD).toBe(800);
    expect(AIR_QUALITY_THRESHOLDS.FAIR).toBe(1000);
    expect(AIR_QUALITY_THRESHOLDS.INFERIOR).toBe(1500);
  });

  it('thresholds should be in ascending order', () => {
    expect(AIR_QUALITY_THRESHOLDS.EXCELLENT).toBeLessThan(AIR_QUALITY_THRESHOLDS.GOOD);
    expect(AIR_QUALITY_THRESHOLDS.GOOD).toBeLessThan(AIR_QUALITY_THRESHOLDS.FAIR);
    expect(AIR_QUALITY_THRESHOLDS.FAIR).toBeLessThan(AIR_QUALITY_THRESHOLDS.INFERIOR);
  });
});
