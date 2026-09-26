import type { Manifest } from './data';

/**
 * - idle: not needed yet
 * - loading: first version on its way
 * - ready: the version the manifest lists
 * - outdated: an older version, because the listed one failed to load (it is retried next refresh)
 * - missing: the manifest lists no such file (anything shown before is dropped)
 * - error: nothing loaded yet and the listed version failed
 */
export type RefState = 'idle' | 'loading' | 'ready' | 'outdated' | 'missing' | 'error';
export interface RefSlot<T> {
  value: T | null;
  state: RefState;
}

/**
 * One reference file of the manifest (ref/…), fetched again only when its sha256 changes.
 * A request that a newer manifest (or a removal) superseded never overwrites the newer result.
 */
export class RefSync<T> {
  slot: RefSlot<T> = { value: null, state: 'idle' };
  private wanted: string | null = null; // sha256 being loaded or loaded
  private loaded: string | null = null; // sha256 of slot.value

  constructor(
    readonly path: string,
    private load: (manifest: Manifest, path: string) => Promise<T | null>,
    private onChange: (slot: RefSlot<T>) => void,
  ) {}

  private set(slot: RefSlot<T>) {
    this.slot = slot;
    this.onChange(slot);
  }

  async sync(manifest: Manifest): Promise<void> {
    const file = manifest.files.find((f) => f.path === this.path);
    if (!file) {
      this.wanted = null;
      this.loaded = null;
      if (this.slot.state !== 'missing' || this.slot.value)
        this.set({ value: null, state: 'missing' });
      return;
    }
    if (file.sha256 === this.loaded) {
      // back to the version already shown: a newer request still on its way must not replace it
      this.wanted = this.loaded;
      if (this.slot.state === 'outdated') this.set({ value: this.slot.value, state: 'ready' });
      return;
    }
    if (file.sha256 === this.wanted) return;
    const sha = file.sha256;
    this.wanted = sha;
    if (!this.slot.value) this.set({ value: null, state: 'loading' });
    try {
      const value = await this.load(manifest, this.path);
      if (this.wanted !== sha) return;
      this.loaded = sha;
      this.set({ value, state: value ? 'ready' : 'missing' });
    } catch {
      if (this.wanted !== sha) return;
      this.wanted = this.loaded;
      this.set(
        this.slot.value
          ? { value: this.slot.value, state: 'outdated' }
          : { value: null, state: 'error' },
      );
    }
  }
}
