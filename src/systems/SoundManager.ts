/**
 * Cozy Cat Sanctuary — SoundManager
 * Plays real MP3 audio files from /assets/sound/ with calibrated per-sound loudness normalization.
 * Uses Vite's import.meta.env.BASE_URL so the path is correct both
 * locally (/) and on GitHub Pages (/cat/).
 */

function soundUrl(filename: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const prefix = base.endsWith('/') ? base : base + '/';
  return `${prefix}assets/sound/${filename}`;
}

/**
 * Calibrated perceived loudness normalization factors (0..1.0).
 * Prevents loud raw recording transients (like meow1, meow4, kitten) from overpowering softer clips.
 */
const SOUND_NORMALIZATION_MAP: Record<string, number> = {
  // Adult Meows (meow1 & meow4 have high peak mastering; meow3 is quiet)
  'meow1.mp3': 0.44,
  'meow2.mp3': 0.65,
  'meow3.mp3': 0.85,
  'meow4.mp3': 0.38,
  'meow5.mp3': 0.65,

  // Kitten Meows (kitten.mp3 has loud high-pitch spike)
  'kitten.mp3': 0.46,
  'kitten2.mp3': 0.62,

  // Chirps
  'chirp.mp3': 0.52,
  'chirp2.mp3': 0.48,
  'chirp3.mp3': 0.48,

  // General SFX
  'purr.mp3': 0.85,
  'purr2.mp3': 0.85,
  'hungry.mp3': 0.55,
  'click.mp3': 0.50,
  'pop.mp3': 0.58,
  'coin.mp3': 0.52,
  'bounce.mp3': 0.45,
  'balldrop.mp3': 0.52,
  'fail.mp3': 0.52,
  'bigwin.mp3': 0.65,
  'success.mp3': 0.65,
  'chestreward.mp3': 0.58,
  'open.mp3': 0.58,
  'congo.mp3': 0.68,
  'done.mp3': 0.65,
  'rain.mp3': 0.70,
  'snow.mp3': 0.70,
  'love.mp3': 0.70,
  'infinity.mp3': 0.70,
  'sun.mp3': 0.70,
  'cat.mp3': 0.70,
};

// ── Per-pool audio element pool ───────────────────────────────────────────────
function makePool(filename: string, size: number, globalVolume = 1): HTMLAudioElement[] {
  const normGain = SOUND_NORMALIZATION_MAP[filename] ?? 0.60;
  const src = soundUrl(filename);
  return Array.from({ length: size }, () => {
    const a = new Audio(src);
    a.preload = 'auto';
    (a as any)._baseGain = normGain;
    a.volume = Math.max(0, Math.min(1, globalVolume * normGain));
    return a;
  });
}

const MEOW_FILES = ['meow1.mp3', 'meow2.mp3', 'meow3.mp3', 'meow4.mp3', 'meow5.mp3'];
const KITTEN_FILES = ['kitten.mp3', 'kitten2.mp3'];
const CHIRP_FILES = ['chirp.mp3', 'chirp2.mp3', 'chirp3.mp3'];

export class SoundManager {
  // Volumes 0..1
  private sfxVolume = 0.7;
  private musicVolume = 0.4;
  private sfxEnabled = true;
  private musicEnabled = true;

  // Music elements
  private musicEl: HTMLAudioElement | null = null;
  private plinkoMusicEl: HTMLAudioElement | null = null;
  private congaMusicEl: HTMLAudioElement | null = null;
  private rainMusicEl: HTMLAudioElement | null = null;
  private activeRitualMusicEl: HTMLAudioElement | null = null;
  private inPlinkoMode = false;
  private inCongaMode = false;
  private inRainDanceMode = false;

  // SFX pools (loaded lazily on first interaction)
  private poolsReady = false;
  private meowPools: HTMLAudioElement[][] = [];
  private kittenPools: HTMLAudioElement[][] = [];
  private chirpPools: HTMLAudioElement[][] = [];
  private purrPool: HTMLAudioElement[] = [];
  private hungryPool: HTMLAudioElement[] = [];
  private clickPool: HTMLAudioElement[] = [];
  private popPool: HTMLAudioElement[] = [];
  private coinPool: HTMLAudioElement[] = [];
  private bouncePool: HTMLAudioElement[] = [];
  private balldropPool: HTMLAudioElement[] = [];
  private failPool: HTMLAudioElement[] = [];
  private bigwinPool: HTMLAudioElement[] = [];
  private successPool: HTMLAudioElement[] = [];
  private openChestPool: HTMLAudioElement[] = [];
  private donePool: HTMLAudioElement[] = [];

  // Concurrent meow & chirp limiter
  private activeMeowCount = 0;
  private lastChirpTime = 0;
  private static readonly MAX_CONCURRENT_MEOWS = 2;

  constructor() {
    this.sfxVolume = parseFloat(localStorage.getItem('cozy_sfx_volume') ?? '0.7');
    this.musicVolume = parseFloat(localStorage.getItem('cozy_music_volume') ?? '0.4');
    this.sfxEnabled = (localStorage.getItem('cozy_sfx_enabled') ?? 'true') === 'true';
    this.musicEnabled = (localStorage.getItem('cozy_music_enabled') ?? 'true') === 'true';

    // Initialise music element immediately
    this.initMusic();

    // Auto-unlock music and sound on first user gesture (pointerdown, keydown, touch)
    const unlockAudio = () => {
      this.initPools();
      if (this.musicEnabled && !this.inPlinkoMode && !this.inCongaMode && !this.inRainDanceMode) {
        if (!this.musicEl || this.musicEl.paused) {
          this.startMusic();
        }
      }
    };

    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (this.musicEnabled && !this.inPlinkoMode && !this.inCongaMode && !this.inRainDanceMode && this.musicEl && this.musicEl.paused) {
          this.musicEl.play().catch(() => {});
        }
      }
    });

    window.addEventListener('focus', () => {
      if (this.musicEnabled && !this.inPlinkoMode && !this.inCongaMode && !this.inRainDanceMode && this.musicEl && this.musicEl.paused) {
        this.musicEl.play().catch(() => {});
      }
    });
  }

  private initMusic(): void {
    if (!this.musicEl) {
      this.musicEl = new Audio(soundUrl('music.mp3'));
      this.musicEl.loop = true;
      this.musicEl.volume = this.musicEnabled ? this.musicVolume : 0;
      this.musicEl.preload = 'auto';

      this.musicEl.addEventListener('ended', () => {
        if (this.musicEnabled && this.musicEl && !this.inPlinkoMode) {
          this.musicEl.currentTime = 0;
          this.musicEl.play().catch(() => {});
        }
      });
    }

    if (!this.plinkoMusicEl) {
      this.plinkoMusicEl = new Audio(soundUrl('music2.mp3'));
      this.plinkoMusicEl.loop = true;
      this.plinkoMusicEl.volume = this.musicEnabled ? this.musicVolume : 0;
      this.plinkoMusicEl.preload = 'auto';

      this.plinkoMusicEl.addEventListener('ended', () => {
        if (this.musicEnabled && this.plinkoMusicEl && this.inPlinkoMode) {
          this.plinkoMusicEl.currentTime = 0;
          this.plinkoMusicEl.play().catch(() => {});
        }
      });
    }

    if (!this.congaMusicEl) {
      this.congaMusicEl = new Audio(soundUrl('congo.mp3'));
      this.congaMusicEl.loop = true;
      this.congaMusicEl.volume = this.musicEnabled && this.inCongaMode ? this.musicVolume : 0;
      this.congaMusicEl.preload = 'auto';

      this.congaMusicEl.addEventListener('ended', () => {
        if (this.musicEnabled && this.congaMusicEl && this.inCongaMode) {
          this.congaMusicEl.currentTime = 0;
          this.congaMusicEl.play().catch(() => {});
        }
      });
    }
  }

  // ── Volume API (called from UI sliders) ──────────────────────────────────

  getSfxVolume(): number { return this.sfxVolume; }
  getMusicVolume(): number { return this.musicVolume; }
  isSfxEnabled(): boolean { return this.sfxEnabled; }
  isMusicEnabled(): boolean { return this.musicEnabled; }
  isMusicPlaying(): boolean {
    const activeEl = this.inPlinkoMode ? this.plinkoMusicEl : this.musicEl;
    return !!(activeEl && !activeEl.paused && !activeEl.ended);
  }

  /** Legacy compat — returns true if any sound is on */
  isSoundEnabled(): boolean { return this.sfxEnabled || this.musicEnabled; }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    localStorage.setItem('cozy_sfx_volume', String(this.sfxVolume));
    this.applyVolumeToPool(this.purrPool);
    this.applyVolumeToPool(this.hungryPool);
    this.applyVolumeToPool(this.clickPool);
    this.applyVolumeToPool(this.popPool);
    this.applyVolumeToPool(this.coinPool);
    this.applyVolumeToPool(this.bouncePool);
    this.applyVolumeToPool(this.balldropPool);
    this.applyVolumeToPool(this.failPool);
    this.applyVolumeToPool(this.bigwinPool);
    this.applyVolumeToPool(this.successPool);
    this.applyVolumeToPool(this.openChestPool);
    this.applyVolumeToPool(this.donePool);
    this.meowPools.forEach(p => this.applyVolumeToPool(p));
    this.kittenPools.forEach(p => this.applyVolumeToPool(p));
    this.chirpPools.forEach(p => this.applyVolumeToPool(p));
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    localStorage.setItem('cozy_music_volume', String(this.musicVolume));
    if (this.musicEl) this.musicEl.volume = this.musicEnabled && !this.inPlinkoMode && !this.inCongaMode && !this.inRainDanceMode ? this.musicVolume : 0;
    if (this.plinkoMusicEl) this.plinkoMusicEl.volume = this.musicEnabled && this.inPlinkoMode ? this.musicVolume : 0;
    if (this.congaMusicEl) this.congaMusicEl.volume = this.musicEnabled && this.inCongaMode ? this.musicVolume : 0;
    if (this.rainMusicEl) this.rainMusicEl.volume = this.musicEnabled && this.inRainDanceMode ? this.musicVolume : 0;
    if (this.activeRitualMusicEl) this.activeRitualMusicEl.volume = this.musicEnabled && this.inRainDanceMode ? this.musicVolume : 0;
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on;
    localStorage.setItem('cozy_sfx_enabled', String(on));
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    localStorage.setItem('cozy_music_enabled', String(on));
    if (this.inRainDanceMode) {
      if (this.activeRitualMusicEl) {
        if (on) {
          this.activeRitualMusicEl.volume = this.musicVolume;
          this.activeRitualMusicEl.play().catch(() => {});
        } else {
          this.activeRitualMusicEl.pause();
        }
      } else if (this.rainMusicEl) {
        if (on) {
          this.rainMusicEl.volume = this.musicVolume;
          this.rainMusicEl.play().catch(() => {});
        } else {
          this.rainMusicEl.pause();
        }
      }
    } else if (this.inCongaMode) {
      if (this.congaMusicEl) {
        if (on) {
          this.congaMusicEl.volume = this.musicVolume;
          this.congaMusicEl.play().catch(() => {});
        } else {
          this.congaMusicEl.pause();
        }
      }
    } else if (this.inPlinkoMode) {
      if (this.plinkoMusicEl) {
        if (on) {
          this.plinkoMusicEl.volume = this.musicVolume;
          this.plinkoMusicEl.play().catch(() => {});
        } else {
          this.plinkoMusicEl.pause();
        }
      }
    } else {
      if (this.musicEl) {
        if (on) {
          this.musicEl.volume = this.musicVolume;
          this.startMusic();
        } else {
          this.musicEl.pause();
        }
      } else if (on) {
        this.startMusic();
      }
    }
  }

  /** Legacy toggle — flips SFX, returns new state */
  toggleSound(): boolean {
    this.sfxEnabled = !this.sfxEnabled;
    localStorage.setItem('cozy_sfx_enabled', String(this.sfxEnabled));
    if (this.sfxEnabled) this.playClick();
    return this.sfxEnabled;
  }

  private applyVolumeToPool(pool: HTMLAudioElement[]): void {
    pool.forEach(a => {
      const baseGain = (a as any)._baseGain ?? 0.60;
      a.volume = Math.max(0, Math.min(1, this.sfxVolume * baseGain));
    });
  }

  // ── Pool lazy init ────────────────────────────────────────────────────────

  private initPools(): void {
    if (this.poolsReady) return;
    this.poolsReady = true;

    this.meowPools = MEOW_FILES.map(f => makePool(f, 2, this.sfxVolume));
    this.kittenPools = KITTEN_FILES.map(f => makePool(f, 2, this.sfxVolume));
    this.chirpPools = CHIRP_FILES.map(f => makePool(f, 2, this.sfxVolume));
    this.purrPool = makePool('purr.mp3', 3, this.sfxVolume);
    this.hungryPool = makePool('hungry.mp3', 2, this.sfxVolume);
    this.clickPool = makePool('click.mp3', 4, this.sfxVolume);
    this.popPool = makePool('pop.mp3', 3, this.sfxVolume);
    this.coinPool = makePool('coin.mp3', 3, this.sfxVolume);
    this.bouncePool = makePool('bounce.mp3', 8, this.sfxVolume);
    this.balldropPool = makePool('balldrop.mp3', 6, this.sfxVolume);
    this.failPool = makePool('fail.mp3', 4, this.sfxVolume);
    this.bigwinPool = makePool('bigwin.mp3', 4, this.sfxVolume);
    this.successPool = makePool('success.mp3', 4, this.sfxVolume);
    this.openChestPool = makePool('open.mp3', 3, this.sfxVolume);
    this.donePool = makePool('done.mp3', 2, this.sfxVolume);
  }

  private playFromPool(pool: HTMLAudioElement[], volumeMultiplier = 1): void {
    if (!this.sfxEnabled) return;
    const el = pool.find(a => a.paused || a.ended) ?? pool[0];
    el.currentTime = 0;
    const baseGain = (el as any)._baseGain ?? 0.60;
    el.volume = Math.max(0, Math.min(1, this.sfxVolume * baseGain * volumeMultiplier));
    el.play().catch(() => {});
  }

  // ── Music ─────────────────────────────────────────────────────────────────

  /** Plays background music (with retry on user interaction) */
  startMusic(): void {
    if (this.inPlinkoMode || this.inCongaMode || this.inRainDanceMode) return;
    if (!this.musicEnabled) return;
    if (!this.musicEl) {
      this.initMusic();
    }
    if (!this.musicEl) return;

    this.musicEl.volume = this.musicVolume;
    this.musicEl.play().catch(() => {});
  }

  /** Switches to high-energy Plinko BGM (music2.mp3) */
  startPlinkoMusic(): void {
    this.inPlinkoMode = true;
    if (this.musicEl) {
      this.musicEl.pause();
    }
    if (this.congaMusicEl) {
      this.congaMusicEl.pause();
    }
    if (!this.musicEnabled) return;
    this.initMusic();
    if (this.plinkoMusicEl) {
      this.plinkoMusicEl.volume = this.musicVolume;
      this.plinkoMusicEl.currentTime = 0;
      this.plinkoMusicEl.play().catch(() => {
        // If music2.mp3 is not yet created or blocked, fallback
      });
    }
  }

  /** Stops Plinko BGM and resumes ambient sanctuary music (music.mp3) */
  stopPlinkoMusic(): void {
    this.inPlinkoMode = false;
    if (this.plinkoMusicEl) {
      this.plinkoMusicEl.pause();
      this.plinkoMusicEl.currentTime = 0;
    }
    if (this.musicEnabled && this.musicEl && !this.inCongaMode) {
      this.musicEl.volume = this.musicVolume;
      this.musicEl.play().catch(() => {});
    }
  }

  /** Switches to festive Conga BGM (congo.mp3) */
  startCongaMusic(): void {
    this.inCongaMode = true;
    if (this.musicEl) {
      this.musicEl.pause();
    }
    if (this.plinkoMusicEl) {
      this.plinkoMusicEl.pause();
    }
    if (!this.musicEnabled) return;
    this.initMusic();
    if (this.congaMusicEl) {
      this.congaMusicEl.volume = this.musicVolume;
      this.congaMusicEl.currentTime = 0;
      this.congaMusicEl.play().catch(() => {});
    }
  }

  /** Stops Conga BGM, plays completion fanfare (done.mp3), and resumes ambient sanctuary music */
  stopCongaMusic(): void {
    this.inCongaMode = false;
    if (this.congaMusicEl) {
      this.congaMusicEl.pause();
      this.congaMusicEl.currentTime = 0;
    }
    this.playDone();
    if (this.musicEnabled && this.musicEl && !this.inPlinkoMode) {
      this.musicEl.volume = this.musicVolume;
      this.musicEl.play().catch(() => {});
    }
  }

  /** Plays conga completion sound effect (done.mp3) */
  playDone(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.donePool);
  }

  /** Plays chest opening buildup sound effect (chestreward.mp3) */
  playChestReward(): void {
    if (!this.sfxEnabled) return;
    try {
      const audio = new Audio(soundUrl('chestreward.mp3'));
      audio.volume = this.sfxVolume * (SOUND_NORMALIZATION_MAP['chestreward.mp3'] ?? 0.58);
      const p = audio.play();
      if (p !== undefined) {
        p.catch(() => {});
      }
    } catch {}
  }

  /** Plays chest opening sound effect (open.mp3 / success.mp3) */
  playChestOpen(): void {
    if (!this.sfxEnabled) return;
    try {
      const audio = new Audio(soundUrl('open.mp3'));
      audio.volume = this.sfxVolume * (SOUND_NORMALIZATION_MAP['open.mp3'] ?? 0.58);
      const p = audio.play();
      if (p !== undefined) {
        p.catch(() => {
          this.playSuccess();
        });
      }
    } catch {
      this.playSuccess();
    }
  }

  // ── SFX API ───────────────────────────────────────────────────────────────

  /** Adult cat meow – 5 variations, random pick with calibrated normalized loudness */
  playMeow(pitchParam = 1): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    if (this.activeMeowCount >= SoundManager.MAX_CONCURRENT_MEOWS) return;
    const idx = Math.floor(Math.random() * this.meowPools.length);
    this.playMeowFromPool(this.meowPools[idx], pitchParam);
  }

  /** Kitten meow – 2 variations with balanced gain */
  playKittenMeow(birth = false, pitchParam = 1): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    if (!birth && this.activeMeowCount >= SoundManager.MAX_CONCURRENT_MEOWS) return;
    const idx = birth ? 0 : Math.floor(Math.random() * this.kittenPools.length);
    this.playMeowFromPool(this.kittenPools[idx], pitchParam);
  }

  /** Internal: play from a meow pool and track the active count with calibrated playbackRate & gain. */
  private playMeowFromPool(pool: HTMLAudioElement[], pitchParam = 1): void {
    const el = pool.find(a => a.paused || a.ended) ?? pool[0];
    el.currentTime = 0;
    const baseGain = (el as any)._baseGain ?? 0.60;
    el.volume = Math.max(0, Math.min(1, this.sfxVolume * baseGain));

    // Convert pitch: handles direct multiplier (e.g. 0.85..1.2) or semitones (-2..+5)
    let rate = 1.0;
    if (pitchParam > 0.4 && pitchParam < 2.2 && pitchParam !== 1) {
      rate = pitchParam;
    } else if (pitchParam >= -12 && pitchParam <= 12 && pitchParam !== 0) {
      rate = Math.pow(2, pitchParam / 12);
    }
    // Add subtle natural feline variety (+-2.5%)
    rate *= (0.975 + Math.random() * 0.05);
    el.playbackRate = Math.max(0.75, Math.min(1.4, rate));

    this.activeMeowCount++;
    const decrement = () => {
      this.activeMeowCount = Math.max(0, this.activeMeowCount - 1);
      el.playbackRate = 1;
    };
    el.addEventListener('ended', decrement, { once: true });
    el.addEventListener('pause', decrement, { once: true });
    el.play().catch(() => { decrement(); });
  }

  /** Purr – when petting */
  playPurr(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.purrPool);
  }

  /** Hungry / distress sound – played once when a need hits 0 */
  playHungry(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.hungryPool, 0.9);
  }

  /** Chirp – rare vocalization for play state (3 variations) */
  playChirp(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    const now = Date.now();
    if (now - this.lastChirpTime < 15000) return; // at most 1 chirp every 15s sanctuary-wide
    this.lastChirpTime = now;
    const idx = Math.floor(Math.random() * this.chirpPools.length);
    this.playFromPool(this.chirpPools[idx], 0.9);
  }

  /** Click – UI interactions */
  playClick(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.clickPool);
  }

  /** Pop – new item / kitten spawns */
  playPop(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.popPool);
  }

  /** Coin – care points earned or spent */
  playCoin(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.coinPool);
  }

  // ── Plinko Juicy Sounds ──────────────────────────────────────────────────

  /** Bounce – when a ball hits a peg */
  playBounce(playbackRate = 1): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    const el = this.bouncePool.find(a => a.paused || a.ended) ?? this.bouncePool[0];
    el.currentTime = 0;
    const baseGain = (el as any)._baseGain ?? 0.45;
    el.volume = Math.max(0, Math.min(1, this.sfxVolume * baseGain));
    el.playbackRate = Math.max(0.75, Math.min(1.35, playbackRate));
    el.play().catch(() => {});
  }

  /** Ball Drop – for each ball dropped into the chute */
  playBalldrop(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.balldropPool);
  }

  /** Fail – when a ball falls into a miss slot */
  playFail(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.failPool);
  }

  /** Big Win – when a ball lands in any non-miss slot */
  playBigWin(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.bigwinPool);
  }

  /** Success – triumphant fanfare when rewards are delivered */
  playSuccess(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.successPool);
  }

  /**
   * Plays unique ritual dance music (snow.mp3, love.mp3, infinity.mp3, sun.mp3, cat.mp3, rain.mp3)
   * instead of background music for the exact duration of the song.
   * Background music is paused and automatically resumes once the ritual ends with done.mp3 fanfare.
   */
  startRitualMusic(filename: string, onEnded?: () => void): number {
    this.inRainDanceMode = true;
    if (this.musicEl) {
      this.musicEl.pause();
    }
    if (this.plinkoMusicEl) {
      this.plinkoMusicEl.pause();
    }
    if (this.congaMusicEl) {
      this.congaMusicEl.pause();
    }
    if (this.activeRitualMusicEl) {
      this.activeRitualMusicEl.pause();
      this.activeRitualMusicEl.currentTime = 0;
    }

    const el = new Audio(soundUrl(filename));
    el.preload = 'auto';
    this.activeRitualMusicEl = el;

    const normGain = SOUND_NORMALIZATION_MAP[filename] ?? 0.70;
    el.currentTime = 0;
    el.volume = (this.musicEnabled ? this.musicVolume : 0) * normGain;

    if (onEnded) {
      const handleEnded = () => {
        el.removeEventListener('ended', handleEnded);
        onEnded();
      };
      el.addEventListener('ended', handleEnded, { once: true });
    }

    if (this.musicEnabled) {
      el.play().catch(() => {});
    }

    const duration = (el.duration && isFinite(el.duration) && el.duration > 0) ? el.duration : 18.0;
    return duration;
  }

  /** Stops active ritual music, plays done.mp3 fanfare, and restores ambient background music */
  stopRitualMusic(playDoneFanfare = true): void {
    if (!this.inRainDanceMode) return;
    this.inRainDanceMode = false;
    if (this.activeRitualMusicEl) {
      this.activeRitualMusicEl.pause();
      this.activeRitualMusicEl.currentTime = 0;
      this.activeRitualMusicEl = null;
    }
    if (this.rainMusicEl) {
      this.rainMusicEl.pause();
      this.rainMusicEl.currentTime = 0;
    }
    if (playDoneFanfare) {
      this.playDone();
    }
    if (this.musicEnabled && this.musicEl && !this.inPlinkoMode && !this.inCongaMode) {
      this.musicEl.volume = this.musicVolume;
      this.musicEl.play().catch(() => {});
    }
  }

  /** Plays rain dance music (rain.mp3) instead of background music for the duration of the ritual */
  startRainMusic(onEnded?: () => void): number {
    return this.startRitualMusic('rain.mp3', onEnded);
  }

  /** Stops rain dance music, plays done.mp3 fanfare, and restores ambient background music */
  stopRainMusic(playDoneFanfare = true): void {
    this.stopRitualMusic(playDoneFanfare);
  }

  // ── Legacy aliases (keep existing call-sites working) ────────────────────

  playTap(): void { this.playClick(); }
  playCrunch(): void { this.playPop(); }       // food eating
  playSparkle(): void { this.playPop(); }       // sparkle / brush / automation
  playBubble(): void { this.playPop(); }        // wash bubble
  playAdoptFanfare(): void { this.playPop(); }

  playWhistle(): void {
    if (!this.sfxEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        this.playPop();
        return;
      }
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.10);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.18);
      osc.frequency.exponentialRampToValueAtTime(2093, now + 0.32);

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.22 * this.sfxVolume, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.44);
      setTimeout(() => ctx.close(), 550);
    } catch {
      this.playPop();
    }
  }

}

export const sound = new SoundManager();
