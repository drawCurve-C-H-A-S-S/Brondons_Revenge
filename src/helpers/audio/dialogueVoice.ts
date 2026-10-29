import {
  AudioManager,
  getAudioSettings,
  subscribeAudioSettings,
} from "./AudioManager.js";

interface VoiceClip {
  id: string;
  speaker: string;
  text: string;
  file: string;
  duration?: number;
}

const files = import.meta.glob<string>("../../assets/sounds/voices/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
});
const manifests = import.meta.glob<VoiceClip[]>(
  "../../assets/sounds/voices/manifest.json",
  { eager: true, import: "default" },
);
export const DIALOGUE_VOICE_URLS = Object.values(files);
export const DIALOGUE_VOICE_CLIPS = Object.values(manifests).flat();

export function dialogueVoiceKey(speaker: string, text: string) {
  const name = speaker === "???" ? "PRIME" : speaker.trim().toUpperCase();
  return `${name}\n${text
    .replace(/[’‘]/g, "'")
    .replace(/\b\d+\s*\/\s*\d+\b\s*[—-]?\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()}`;
}

const recordings = new Map(
  DIALOGUE_VOICE_CLIPS.map((clip) => {
    const url = files[`../../assets/sounds/voices/${clip.file}`];
    if (!url) throw new Error(`Missing dialogue recording: ${clip.file}`);
    return [dialogueVoiceKey(clip.speaker, clip.text), { ...clip, url }];
  }),
);
const speakers =
  /^(Prime|Brondon|Branden|Brendan|Donus|Caleb|Husain|André|Sibusiso|Sohrab|Sudoers 5|\?\?\?)$/i;
const missing = new Set<string>();
let lines = new WeakMap<HTMLElement, string>();
let manager: AudioManager | undefined;
let scene: object | null = null;
let scenePaused = false;
let active:
  | {
      element: HTMLElement;
      audio: HTMLAudioElement;
      scene: object | null;
      key: string;
    }
  | undefined;

function playbackPaused() {
  return (
    scenePaused ||
    getAudioSettings().paused ||
    document.hidden ||
    (!!active && active.scene !== scene)
  );
}

function stopActive() {
  if (active) manager?.stopSfx(active.audio);
  active = undefined;
}

subscribeAudioSettings(({ voiceActing }) => {
  if (!voiceActing) stopActive();
});

export function sayDialogue(
  element: HTMLElement,
  speaker: string,
  text: string,
  owner: object | null = scene,
  windowSeconds?: number,
) {
  if (
    windowSeconds !== undefined &&
    (!Number.isFinite(windowSeconds) || windowSeconds <= 0)
  )
    throw new RangeError(
      "A dialogue playback window must be finite and positive",
    );
  const key = dialogueVoiceKey(speaker, text);
  if (lines.get(element) === key) return;
  lines.set(element, key);
  if (!text.trim() || !speakers.test(speaker)) {
    stopDialogueVoice(element);
    return;
  }
  stopActive();
  if (!getAudioSettings().voiceActing || typeof Audio === "undefined") return;
  const clip = recordings.get(key);
  if (!clip) {
    if (!missing.has(key) && /[a-z]/i.test(text)) {
      missing.add(key);
      console.warn(
        "[Voice] Dialogue has no downloaded recording:",
        speaker,
        text,
      );
    }
    return;
  }
  manager ??= new AudioManager({
    getFile: (path: string) => ({ content: path }),
  });
  manager.setMenuPaused(
    scenePaused ||
      getAudioSettings().paused ||
      document.hidden ||
      owner !== scene,
  );
  const audio = manager.playVoice(clip.url);
  if (audio) {
    if (windowSeconds && clip.duration) {
      audio.preservesPitch = true;
      audio.playbackRate = Math.max(1, clip.duration / windowSeconds);
    }
    active = { element, audio, scene: owner, key };
  }
}

export function stopDialogueVoice(element: HTMLElement) {
  lines.delete(element);
  if (active?.element === element) stopActive();
}

export function dialogueVoiceDuration(speaker: string, text: string) {
  return getAudioSettings().voiceActing
    ? (recordings.get(dialogueVoiceKey(speaker, text))?.duration ?? 0)
    : 0;
}

export function updateDialogueVoice(
  currentScene: object | null,
  paused: boolean,
) {
  if (scene !== currentScene) {
    if (active?.scene !== currentScene) stopActive();
    lines = new WeakMap();
    if (active) lines.set(active.element, active.key);
    scene = currentScene;
  }
  scenePaused = paused;
  manager?.setMenuPaused(playbackPaused());
  if (!active || playbackPaused()) return;
  const element = active.element;
  if (
    !element.isConnected ||
    element.closest(".hidden, [hidden]") ||
    !element.getClientRects().length
  )
    stopDialogueVoice(element);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", () =>
    manager?.setMenuPaused(playbackPaused()),
  );
}
