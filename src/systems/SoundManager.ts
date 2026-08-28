/**
 * Cozy Cat Sanctuary — SoundManager
 * Plays real MP3 audio files from /assets/sound/.
 * Uses Vite's import.meta.env.BASE_URL so the path is correct both
 * locally (/) and on GitHub Pages (/cat/).
 */

function soundUrl(filename: string): string {
  // import.meta.env.BASE_URL is injected by Vite at build time.
  // It equals '/' in dev and '/cat/' (or whatever base is) in production.
  const base = import.meta.env.BASE_URL ?? '/';
  const prefix = base.endsWith('/') ? base : base + '/';
  return `${prefix}assets/sound/${filename}`;
}

// ── Per-pool audio element pool ───────────────────────────────────────────────
function makePool(src: string, size: number, volume = 1): HTMLAudioElement[] {
  return Array.from({ length: size }, () => {
    const a = new Audio(src);
    a.preload = 'auto';
    a.volume = volume;
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
  private inPlinkoMode = false;

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
    this.meowPools.forEach(p => this.applyVolumeToPool(p));
    this.kittenPools.forEach(p => this.applyVolumeToPool(p));
    this.chirpPools.forEach(p => this.applyVolumeToPool(p));
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    localStorage.setItem('cozy_music_volume', String(this.musicVolume));
    if (this.musicEl) this.musicEl.volume = this.musicEnabled && !this.inPlinkoMode ? this.musicVolume : 0;
    if (this.plinkoMusicEl) this.plinkoMusicEl.volume = this.musicEnabled && this.inPlinkoMode ? this.musicVolume : 0;
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on;
    localStorage.setItem('cozy_sfx_enabled', String(on));
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    localStorage.setItem('cozy_music_enabled', String(on));
    if (this.inPlinkoMode) {
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
    pool.forEach(a => { a.volume = this.sfxVolume; });
  }

  // ── Pool lazy init ────────────────────────────────────────────────────────

  private initPools(): void {
    if (this.poolsReady) return;
    this.poolsReady = true;

    this.meowPools = MEOW_FILES.map(f => makePool(soundUrl(f), 2, this.sfxVolume));
    this.kittenPools = KITTEN_FILES.map(f => makePool(soundUrl(f), 2, this.sfxVolume));
    this.chirpPools = CHIRP_FILES.map(f => makePool(soundUrl(f), 2, this.sfxVolume));
    this.purrPool = makePool(soundUrl('purr.mp3'), 3, this.sfxVolume);
    this.hungryPool = makePool(soundUrl('hungry.mp3'), 2, this.sfxVolume);
    this.clickPool = makePool(soundUrl('click.mp3'), 4, this.sfxVolume);
    this.popPool = makePool(soundUrl('pop.mp3'), 3, this.sfxVolume);
    this.coinPool = makePool(soundUrl('coin.mp3'), 3, this.sfxVolume);
    this.bouncePool = makePool(soundUrl('bounce.mp3'), 8, this.sfxVolume * 0.85);
    this.balldropPool = makePool(soundUrl('balldrop.mp3'), 6, this.sfxVolume);
    this.failPool = makePool(soundUrl('fail.mp3'), 4, this.sfxVolume * 0.9);
    this.bigwinPool = makePool(soundUrl('bigwin.mp3'), 4, this.sfxVolume);
    this.successPool = makePool(soundUrl('success.mp3'), 4, this.sfxVolume);
    this.openChestPool = makePool(soundUrl('open.mp3'), 3, this.sfxVolume);
  }

  private playFromPool(pool: HTMLAudioElement[], volume?: number): void {
    if (!this.sfxEnabled) return;
    const el = pool.find(a => a.paused || a.ended) ?? pool[0];
    el.currentTime = 0;
    if (volume !== undefined) el.volume = Math.min(this.sfxVolume, volume);
    el.play().catch(() => {});
  }

  // ── Music ─────────────────────────────────────────────────────────────────

  /** Plays background music (with retry on user interaction) */
  startMusic(): void {
    if (this.inPlinkoMode) return;
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
    if (this.musicEnabled && this.musicEl) {
      this.musicEl.volume = this.musicVolume;
      this.musicEl.play().catch(() => {});
    }
  }

  /** Plays chest opening buildup sound effect (chestreward.mp3) */
  playChestReward(): void {
    if (!this.sfxEnabled) return;
    try {
      const audio = new Audio(soundUrl('chestreward.mp3'));
      audio.volume = this.sfxVolume;
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
      const audio = new Audio(soundUrl('chestreward.mp3'));
      audio.volume = this.sfxVolume;
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

  /** Adult cat meow – 5 variations, random pick */
  playMeow(pitchMultiplier = 1): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    if (this.activeMeowCount >= SoundManager.MAX_CONCURRENT_MEOWS) return;
    const idx = Math.floor(Math.random() * this.meowPools.length);
    this.playMeowFromPool(this.meowPools[idx], pitchMultiplier);
  }

  /** Kitten meow – 2 variations */
  playKittenMeow(birth = false, pitchMultiplier = 1): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    if (!birth && this.activeMeowCount >= SoundManager.MAX_CONCURRENT_MEOWS) return;
    const idx = birth ? 0 : Math.floor(Math.random() * this.kittenPools.length);
    this.playMeowFromPool(this.kittenPools[idx], pitchMultiplier);
  }

  /** Internal: play from a meow pool and track the active count. */
  private playMeowFromPool(pool: HTMLAudioElement[], playbackRate = 1): void {
    const el = pool.find(a => a.paused || a.ended) ?? pool[0];
    el.currentTime = 0;
    el.volume = this.sfxVolume;
    el.playbackRate = Math.max(0.5, Math.min(2.0, playbackRate));
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
    this.playFromPool(this.hungryPool, 0.6);
  }

  /** Chirp – rare vocalization for play state (3 variations) */
  playChirp(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    const now = Date.now();
    if (now - this.lastChirpTime < 15000) return; // at most 1 chirp every 15s sanctuary-wide
    this.lastChirpTime = now;
    const idx = Math.floor(Math.random() * this.chirpPools.length);
    this.playFromPool(this.chirpPools[idx], 0.55);
  }

  /** Click – UI interactions */
  playClick(): void {
    this.initPools();
    if (!this.sfxEnabled) return;
    this.playFromPool(this.clickPool, 0.6);
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
    el.volume = this.sfxVolume * 0.85;
    el.playbackRate = Math.max(0.7, Math.min(1.4, playbackRate));
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

  // ── Legacy aliases (keep existing call-sites working) ────────────────────

  playTap(): void { this.playClick(); }
  playCrunch(): void { this.playPop(); }       // food eating
  playSparkle(): void { this.playPop(); }       // sparkle / brush / automation
  playBubble(): void { this.playPop(); }        // wash bubble
  playAdoptFanfare(): void { this.playSuccess(); }

}

export const sound = new SoundManager();
