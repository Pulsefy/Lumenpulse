export enum BatteryState {
  UNKNOWN = 0,
  UNPLUGGED = 1,
  CHARGING = 2,
  FULL = 3,
}

export const getPowerStateAsync = jest.fn(async () => ({
  batteryLevel: 1,
  batteryState: BatteryState.UNPLUGGED,
  lowPowerMode: false,
}));
