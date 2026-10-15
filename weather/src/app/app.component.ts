import { Component, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Forecast, Place, WeatherService } from './weather.service';
import { PixelSceneComponent } from './pixel-scene.component';
import { PixelIconComponent } from './pixel-icon.component';
import { FrogComponent } from './frog.component';

type Status = 'locating' | 'loading' | 'ready' | 'denied' | 'error';

const UNIT_KEY = 'pixel-weather-fahrenheit';

@Component({
  selector: 'app-root',
  imports: [DatePipe, FormsModule, PixelSceneComponent, PixelIconComponent, FrogComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private weather = inject(WeatherService);

  status = signal<Status>('locating');
  message = signal('');
  place = signal<Place | null>(null);
  forecast = signal<Forecast | null>(null);
  fahrenheit = signal(false);

  query = '';
  results = signal<Place[]>([]);
  searching = signal(false);
  searchOpen = signal(false);
  searchNote = signal('');
  private cityInput = viewChild<ElementRef<HTMLInputElement>>('cityInput');

  sky = computed(() => this.forecast()?.current.sky ?? 'clear');
  isDay = computed(() => this.forecast()?.current.isDay ?? true);
  unit = computed(() => (this.fahrenheit() ? '°F' : '°C'));
  windUnit = computed(() => (this.fahrenheit() ? 'mph' : 'km/h'));

  constructor() {
    // Geolocation and storage only exist in the browser, not during server rendering.
    afterNextRender(() => {
      try {
        this.fahrenheit.set(localStorage.getItem(UNIT_KEY) === '1');
      } catch { /* storage blocked: keep °C */ }
      this.useMyLocation();
    });
  }

  async useMyLocation() {
    this.status.set('locating');
    this.results.set([]);
    try {
      const { latitude, longitude } = await this.weather.locate();
      const name = await this.weather.placeName(latitude, longitude);
      await this.load({ name, latitude, longitude });
    } catch (e) {
      this.message.set((e as Error).message);
      this.status.set('denied');
    }
  }

  async load(place: Place) {
    this.place.set(place);
    this.results.set([]);
    this.status.set('loading');
    try {
      this.forecast.set(await this.weather.forecast(place.latitude, place.longitude, this.fahrenheit()));
      this.status.set('ready');
    } catch (e) {
      this.message.set((e as Error).message);
      this.status.set('error');
    }
  }

  async search() {
    const q = this.query.trim();
    if (!q) return;
    this.searching.set(true);
    this.searchNote.set('');
    try {
      const found = await this.weather.search(q);
      this.results.set(found);
      if (!found.length) this.searchNote.set(`No city found for "${q}".`);
    } catch (e) {
      this.results.set([]);
      this.searchNote.set((e as Error).message);
    } finally {
      this.searching.set(false);
    }
  }

  toggleSearch() {
    if (this.searchOpen()) {
      this.closeSearch();
      return;
    }
    this.searchOpen.set(true);
    // Focus the field once it has been rendered.
    setTimeout(() => this.cityInput()?.nativeElement.focus());
  }

  closeSearch() {
    this.searchOpen.set(false);
    this.query = '';
    this.results.set([]);
    this.searchNote.set('');
  }

  pickCity(place: Place) {
    this.closeSearch();
    this.load(place);
  }

  toggleUnit() {
    this.fahrenheit.update((f) => !f);
    try {
      localStorage.setItem(UNIT_KEY, this.fahrenheit() ? '1' : '0');
    } catch { /* ignore */ }
    const place = this.place();
    if (place) this.load(place);
  }

  refresh() {
    const place = this.place();
    if (place) this.load(place);
  }
}
