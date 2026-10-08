import storageOverview from '../../assets/loading/stage1-overview.jpg';
import storagePatrol from '../../assets/loading/stage1-patrol.jpg';
import finaleRooftop from '../../assets/loading/finale-rooftop.jpg';
import finaleOrbit from '../../assets/loading/finale-orbit.jpg';

export type LoadingDestination = 'stage1' | 'boss' | 'finale';

const MINIMUM_SECONDS = 3;
const CHAPTERS = {
  stage1: {
    chapter: 'DECK ONE',
    title: 'LEVEL 1 STEALTH STAGE',
    images: [storageOverview, storagePatrol],
    tips: [
      'Let the eye drone pass. Close the storage door, then slip out behind it.',
      'Peeking lets you watch a patrol without leaving cover.',
      "Use the containers to break a drone's line of sight.",
      'Reach the hangar to secure your next checkpoint.',
    ],
  },
  boss: {
    chapter: 'BAY 13 / THE BAY WARDEN',
    title: 'LEVEL 1 BOSS STAGE',
    images: [storagePatrol, storageOverview],
    tips: [
      'Keep moving. The Bay Warden punishes anyone who stands still.',
      'Shield and health supplies are scattered around the bay. Grab them when the fight turns.',
      "Watch the warden's wind-up and get clear before the strike lands.",
    ],
  },
  finale: {
    chapter: 'FINAL CHAPTER / SUDOERS 5',
    title: 'THE LAST LIGHT',
    images: [finaleRooftop, finaleOrbit],
    tips: [
      'Hold R to block. Raise your shield just before impact to reflect an attack.',
      'Move toward your opponent and press Space to step over and switch sides.',
      'E unleashes a flying sword slash. Give the ultimate time to recharge.',
      'Special-move cameras return before impact. Use that opening to dodge or guard.',
      'Watch the closing QTE ring. Mash D or hold E when the prompt calls for it.',
    ],
  },
} satisfies Record<LoadingDestination, {
  chapter: string; title: string; images: string[]; tips: string[];
}>;

export function createCinematicLoadingScreen() {
  const root = document.createElement('section');
  root.className = 'cinematic-loading hidden';
  root.setAttribute('aria-label', 'Preparing the next chapter');
  root.innerHTML = `<img class="cinematic-loading-art" alt="" aria-hidden="true">
    <div class="cinematic-loading-shade" aria-hidden="true"></div>
    <div class="cinematic-loading-copy">
      <span class="cinematic-loading-chapter"></span>
      <h1></h1>
      <aside class="cinematic-loading-tip"><strong>FIELD NOTES</strong><p></p></aside>
      <div class="cinematic-loading-status" role="status" aria-live="polite">PREPARING SCENE</div>
      <div class="cinematic-loading-track" role="progressbar" aria-label="Loading scene"><span></span></div>
      <button type="button" class="cinematic-loading-retry hidden">TRY AGAIN</button>
    </div>`;
  document.body.appendChild(root);
  const get = <T extends Element = HTMLElement>(selector: string) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Loading screen is missing ${selector}`);
    return element;
  };
  const image = get<HTMLImageElement>('img');
  const chapter = get('.cinematic-loading-chapter');
  const title = get('h1');
  const tip = get('.cinematic-loading-tip p');
  const status = get('.cinematic-loading-status');
  const track = get('.cinematic-loading-track');
  const retry = get<HTMLButtonElement>('button');
  const previousImages: Partial<Record<LoadingDestination, number>> = {};
  let active = false, generation = 0, elapsed = 0, artworkReady = false;
  let resolveMinimum: (() => void) | null = null;
  let rejectMinimum: ((error: Error) => void) | null = null;

  function hide() {
    active = false;
    image.onload = image.onerror = null;
    resolveMinimum?.();
    resolveMinimum = rejectMinimum = null;
    retry.onclick = null;
    root.classList.add('hidden');
    document.body.classList.remove('cinematic-loading-active');
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
    'pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchmove', 'touchend', 'wheel']) {
    window.addEventListener(type, blockInput, { capture: true, passive: false });
  }

  return {
    get active() { return active; },
    begin(destination: LoadingDestination) {
      hide();
      const token = ++generation, content = CHAPTERS[destination];
      const last = previousImages[destination];
      const index = last === undefined ? Math.floor(Math.random() * content.images.length) : (last + 1) % content.images.length;
      previousImages[destination] = index;
      active = true; elapsed = 0; artworkReady = false;
      root.dataset.destination = destination;
      root.classList.remove('hidden', 'loading-failed');
      document.body.classList.add('cinematic-loading-active');
      chapter.textContent = content.chapter;
      title.textContent = content.title;
      tip.textContent = content.tips[Math.floor(Math.random() * content.tips.length)];
      status.textContent = 'PREPARING SCENE';
      track.classList.remove('hidden');
      retry.classList.add('hidden');
      const presented = new Promise<void>((resolve, reject) => {
        resolveMinimum = resolve; rejectMinimum = reject;
      });
      function fail(message: string, onRetry?: () => void) {
        if (token !== generation) return;
        root.classList.add('loading-failed');
        status.textContent = message;
        track.classList.add('hidden');
        retry.classList.toggle('hidden', !onRetry);
        retry.onclick = onRetry ?? null;
        if (onRetry) retry.focus();
      }
      image.onload = () => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (token === generation && active) artworkReady = true;
        }));
      };
      image.onerror = () => {
        if (token === generation) rejectMinimum?.(new Error('Unable to load the cinematic chapter artwork. Please try again.'));
      };
      image.src = content.images[index];
      void presented.catch(error => {
        console.error('[Cinematic loading]', error);
        fail(String(error instanceof Error ? error.message : error));
      });
      return {
        presented,
        fail,
        finish() { if (token === generation) hide(); },
      };
    },
    update(delta: number) {
      if (!active || !artworkReady || document.hidden || !resolveMinimum) return;
      elapsed += Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
      if (elapsed >= MINIMUM_SECONDS) {
        resolveMinimum();
        resolveMinimum = rejectMinimum = null;
      }
    },
  };
}
