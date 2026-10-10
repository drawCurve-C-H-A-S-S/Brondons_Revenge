import { assetUrl } from '../../core/assetCache.js';
import { createLoadingSlideDeck, type LoadingDestination } from '../../core/chapters.js';
import { inputHint } from '../../scripts/gamepadInput.js';
export type { LoadingDestination } from '../../core/chapters.js';

export const LOADING_SLIDE_SECONDS = 6;

export function createCinematicLoadingScreen() {
  const root = document.createElement('section');
  root.className = 'cinematic-loading hidden';
  root.setAttribute('aria-label', 'Preparing the game');
  root.innerHTML = `<img class="cinematic-loading-art" alt="" aria-hidden="true">
    <div class="cinematic-loading-shade" aria-hidden="true"></div>
    <div class="cinematic-loading-copy">
      <span class="cinematic-loading-chapter"></span>
      <h1></h1>
      <aside class="cinematic-loading-tip"><strong>FIELD NOTES</strong><p></p></aside>
      <div class="cinematic-loading-status" role="status" aria-live="polite">PREPARING SCENE</div>
      <div class="cinematic-loading-track" role="progressbar" aria-label="Loading game"><span></span></div>
      <p class="cinematic-loading-note"></p>
      <button type="button" class="cinematic-loading-retry hidden">TRY AGAIN</button>
    </div>`;
  document.body.appendChild(root);
  const get = <T extends Element = HTMLElement>(selector: string) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Loading screen is missing ${selector}`);
    return element;
  };
  const image = get<HTMLImageElement>('img'), chapter = get('.cinematic-loading-chapter'), title = get('h1');
  const tip = get('.cinematic-loading-tip p'), status = get('.cinematic-loading-status');
  const track = get('.cinematic-loading-track'), bar = get('.cinematic-loading-track span');
  const note = get('.cinematic-loading-note'), retry = get<HTMLButtonElement>('button');
  let active = false, failed = false, generation = 0, elapsed = 0, slideTime = 0, artworkReady = false;
  let minimumSeconds = 3, artworkError: Error | null = null;
  let deck: ReturnType<typeof createLoadingSlideDeck> | null = null;
  let resolveMinimum: (() => void) | null = null, rejectMinimum: ((error: Error) => void) | null = null;

  function hide() {
    active = false; deck = null;
    image.onload = image.onerror = null;
    resolveMinimum?.(); resolveMinimum = rejectMinimum = null;
    retry.onclick = null;
    root.classList.add('hidden'); document.body.classList.remove('cinematic-loading-active');
  }

  function blockInput(event: Event) {
    if (!active) return;
    if (event.target instanceof Node && retry.contains(event.target) && !retry.classList.contains('hidden')
      && (!(event instanceof KeyboardEvent) || ['Enter', 'NumpadEnter', 'Space', 'Tab'].includes(event.code))) return;
    event.stopImmediatePropagation();
    if (event.cancelable) event.preventDefault();
  }
  retry.addEventListener('keydown', event => event.stopPropagation());
  retry.addEventListener('keyup', event => event.stopPropagation());
  for (const type of ['keydown', 'keyup', 'click', 'mousedown', 'mouseup', 'mousemove',
    'pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchmove', 'touchend', 'wheel'])
    window.addEventListener(type, blockInput, { capture: true, passive: false });

  async function showSlide(token: number) {
    if (!deck) return;
    const slide = deck.next();
    const source = await assetUrl(slide.image);
    if (token !== generation || !active) return;
    const decoded = new Image(); decoded.src = source;
    await decoded.decode();
    if (token !== generation || !active) return;
    image.src = source; root.dataset.chapter = slide.id;
    chapter.textContent = slide.content.chapter; title.textContent = slide.content.title;
    tip.textContent = inputHint(slide.tip); artworkReady = true; slideTime = 0;
    image.classList.remove('slide-enter');
    requestAnimationFrame(() => { if (token === generation && active) image.classList.add('slide-enter'); });
  }
  function slideFailed(error: unknown, token: number) {
    if (token !== generation || !active) return;
    artworkError = error instanceof Error ? error : new Error(String(error));
    console.error('[Cinematic loading] Screenshot preparation failed:', artworkError);
    rejectMinimum?.(artworkError);
    failed = true; root.classList.add('loading-failed');
    status.textContent = 'Loading artwork could not be prepared. Please try again.';
  }

  return {
    get active() { return active; },
    get menuRoot() { return active && !retry.classList.contains('hidden') ? root : null; },
    begin(destination: LoadingDestination, minimum = 3) {
      if (!Number.isFinite(minimum) || minimum < 0) throw new RangeError('Loading presentation duration must be nonnegative');
      hide();
      const token = ++generation;
      active = true; failed = false; elapsed = slideTime = 0; artworkReady = false; artworkError = null;
      minimumSeconds = minimum; deck = createLoadingSlideDeck(destination);
      root.dataset.destination = destination; root.classList.remove('hidden', 'loading-failed');
      document.body.classList.add('cinematic-loading-active');
      status.textContent = destination === 'game' ? 'PREPARING THE ENTIRE GAME' : 'PREPARING SCENE';
      note.textContent = ''; track.classList.remove('hidden', 'determinate');
      track.removeAttribute('aria-valuenow'); bar.style.width = '';
      retry.classList.add('hidden');
      const presented = new Promise<void>((resolve, reject) => { resolveMinimum = resolve; rejectMinimum = reject; });
      void presented.catch(error => console.error('[Cinematic loading]', error));
      void showSlide(token).catch(error => slideFailed(error, token));
      return {
        presented,
        setProgress(completed: number, total: number, label: string) {
          if (token !== generation) return;
          if (!Number.isInteger(completed) || !Number.isInteger(total) || total <= 0 || completed < 0 || completed > total)
            throw new RangeError('Loading progress must reflect completed preparation tasks');
          const percent = Math.floor(completed / total * 100);
          track.classList.add('determinate'); track.setAttribute('aria-valuemin', '0');
          track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(percent));
          bar.style.width = `${percent}%`;
          if (!failed) status.textContent = `${label} / ${completed} of ${total} / ${percent}%`;
        },
        setNote(message: string) { if (token === generation) note.textContent = message; },
        setStatus(message: string) { if (token === generation && !failed) status.textContent = message; },
        fail(message: string, onRetry?: () => void) {
          if (token !== generation) return;
          failed = true; root.classList.add('loading-failed');
          status.textContent = message; track.classList.add('hidden');
          retry.classList.toggle('hidden', !onRetry); retry.onclick = onRetry ?? null;
          if (onRetry) retry.focus();
        },
        finish() {
          if (token !== generation) return;
          if (artworkError) throw artworkError;
          hide();
        },
      };
    },
    update(delta: number) {
      if (!active || failed || !artworkReady || document.hidden) return;
      const frame = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
      elapsed += frame; slideTime += frame;
      if (resolveMinimum && elapsed >= minimumSeconds) {
        resolveMinimum(); resolveMinimum = rejectMinimum = null;
      }
      if (slideTime >= LOADING_SLIDE_SECONDS) {
        slideTime = 0;
        const token = generation;
        void showSlide(token).catch(error => slideFailed(error, token));
      }
    },
  };
}
