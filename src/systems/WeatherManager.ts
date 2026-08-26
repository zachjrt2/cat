import type { GameState, TimeOfDay, WeatherType } from '../data/types';
import { EventBus } from '../ui/EventBus';

export class WeatherManager {
  private phaseTimer = 0;
  private weatherTimer = 0;
  private readonly PHASE_DURATION_SEC = 180; // 3 minutes per time-of-day phase (12 min full day/night cycle)
  private readonly WEATHER_DURATION_SEC = 300; // 5 minutes per weather roll

  constructor(private state: GameState) {}

  get timeOfDay(): TimeOfDay {
    return this.state.timeOfDay;
  }

  get weather(): WeatherType {
    return this.state.weather;
  }

  setTimeOfDay(time: TimeOfDay): void {
    this.state.timeOfDay = time;
    this.phaseTimer = 0;
    EventBus.emit('time-changed', { timeOfDay: this.state.timeOfDay });
  }

  setWeather(weather: WeatherType): void {
    this.state.weather = weather;
    this.weatherTimer = 0;
    EventBus.emit('weather-changed', { weather: this.state.weather });
  }

  cycleTime(): void {
    const sequence: TimeOfDay[] = ['morning', 'day', 'sunset', 'night'];
    const idx = sequence.indexOf(this.state.timeOfDay);
    const next = sequence[(idx + 1) % sequence.length];
    this.setTimeOfDay(next);
  }

  cycleWeather(): void {
    const sequence: WeatherType[] = ['sunny', 'rain', 'snow'];
    const idx = sequence.indexOf(this.state.weather);
    const next = sequence[(idx + 1) % sequence.length];
    this.setWeather(next);
  }

  tick(deltaSeconds: number): void {
    this.phaseTimer += deltaSeconds;
    if (this.phaseTimer >= this.PHASE_DURATION_SEC) {
      this.phaseTimer = 0;
      this.cycleTime();
    }

    this.weatherTimer += deltaSeconds;
    if (this.weatherTimer >= this.WEATHER_DURATION_SEC) {
      this.weatherTimer = 0;
      // Random weather roll with cozy bias towards sunny
      const roll = Math.random();
      if (roll < 0.6) {
        this.setWeather('sunny');
      } else if (roll < 0.85) {
        this.setWeather('rain');
      } else {
        this.setWeather('snow');
      }
    }
  }

  getAmbientOverlayColor(): { color: number; alpha: number } {
    switch (this.state.timeOfDay) {
      case 'morning':
        return { color: 0xffd166, alpha: 0.08 }; // soft morning gold
      case 'day':
        return { color: 0xffffff, alpha: 0.0 }; // clear daylight
      case 'sunset':
        return { color: 0xf77f00, alpha: 0.14 }; // warm sunset glow
      case 'night':
        return { color: 0x14213d, alpha: 0.45 }; // deep cozy night
    }
  }
}
