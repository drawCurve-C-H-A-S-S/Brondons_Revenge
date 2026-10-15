import * as THREE from 'three';
import { FORWARD_BULKHEAD_CODE, type QuartersProgress } from './layout.js';

export type SurfaceAction = 'read-file' | 'close-file' | 'unlock';
export interface InteractiveDisplay {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  cursor: THREE.Vector2;
  point(x: number, y: number): void;
  click(): SurfaceAction | null;
  key(code: string): SurfaceAction | 'handled' | null;
  focus(value: boolean): void;
  reset(): void;
  update(dt: number): void;
}

function canvasDisplay(width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to draw interactive ship screens');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, context, texture };
}

export function drawDesktopBackground(context: CanvasRenderingContext2D) {
  const wallpaper = context.createLinearGradient(0, 0, 800, 450);
  wallpaper.addColorStop(0, '#071b35'); wallpaper.addColorStop(1, '#15547b');
  context.fillStyle = wallpaper; context.fillRect(0, 0, 800, 450);
  context.strokeStyle = '#24759b'; context.lineWidth = 1;
  for (let row = 18; row < 408; row += 26) {
    context.beginPath(); context.moveTo(0, row); context.lineTo(800, row + 90); context.stroke();
  }
}

export function createRescueDesktop(progress: QuartersProgress): InteractiveDisplay {
  return createFileDesktop({
    title: 'save us', owner: 'BRANDEN / LOCAL BOT',
    lines: ['Brondon,', 'The ship patrol network is compromised.',
      'My local bot kept a maintenance code.', '', `Forward bulkhead access: ${FORWARD_BULKHEAD_CODE}`,
      '', 'Get to Deck One. Stay out of their sight.', 'Bring everyone home.', '- Branden'],
    onRead: () => { progress.rescueMessageRead = true; },
  });
}

export function createFileDesktop({ title, owner, lines, onRead }: {
  title: string; owner: string; lines: readonly string[]; onRead?: () => void;
}): InteractiveDisplay {
  const { canvas, context, texture } = canvasDisplay(800, 450), cursor = new THREE.Vector2(88, 106);
  texture.name = 'CrewDesktop-branden';
  let focused = false, fileOpen = false;
  const within = (x: number, y: number, width: number, height: number) =>
    cursor.x >= x && cursor.x <= x + width && cursor.y >= y && cursor.y <= y + height;
  function draw() {
    drawDesktopBackground(context);
    context.textAlign = 'left'; context.textBaseline = 'alphabetic';
    if (!fileOpen && focused && within(34, 42, 115, 127)) {
      context.fillStyle = '#27688a'; context.fillRect(34, 42, 115, 127);
      context.strokeStyle = '#9edbff'; context.strokeRect(34, 42, 115, 127);
    }
    context.fillStyle = '#dff2ff'; context.fillRect(65, 58, 46, 59);
    context.fillStyle = '#3f7394'; context.fillRect(94, 58, 17, 17);
    context.font = 'bold 14px monospace'; context.fillText('TXT', 75, 98);
    context.textAlign = 'center'; context.font = '22px sans-serif'; context.fillStyle = '#e5f4ff';
    context.fillText(title, 88, 147);
    if (fileOpen) {
      context.fillStyle = '#061425'; context.fillRect(164, 37, 592, 350);
      context.fillStyle = '#16354f'; context.fillRect(158, 31, 592, 350);
      context.strokeStyle = '#8dc5e5'; context.strokeRect(158, 31, 592, 350);
      context.fillStyle = '#2c668d'; context.fillRect(159, 32, 590, 37);
      context.textAlign = 'left'; context.fillStyle = '#edf7ff'; context.font = 'bold 22px sans-serif';
      context.fillText(title, 179, 58);
      context.fillStyle = focused && within(710, 36, 32, 29) ? '#c35862' : '#1a4260';
      context.fillRect(710, 36, 32, 29); context.fillStyle = '#ffffff'; context.fillText('x', 720, 58);
      context.font = '18px monospace';
      lines.forEach((line, index) => {
        context.fillStyle = index === 4 ? '#9de7b8' : '#d5eafa';
        context.fillText(line, 179, 102 + index * 28);
      });
    }
    context.fillStyle = '#082038'; context.fillRect(0, 408, 800, 42);
    context.textAlign = 'left'; context.fillStyle = '#b4d6ed'; context.font = '18px monospace';
    context.fillText(owner, 20, 435);
    context.textAlign = 'right'; context.fillText('OFFLINE', 779, 435);
    if (focused) {
      context.save(); context.translate(cursor.x, cursor.y);
      context.beginPath(); context.moveTo(0, 0); context.lineTo(0, 23); context.lineTo(6, 17);
      context.lineTo(12, 29); context.lineTo(17, 26); context.lineTo(11, 15); context.lineTo(21, 15); context.closePath();
      context.fillStyle = '#ffffff'; context.strokeStyle = '#07182b'; context.lineWidth = 2;
      context.fill(); context.stroke(); context.restore();
    }
    texture.needsUpdate = true;
  }
  function openFile(): SurfaceAction {
    fileOpen = true; onRead?.(); draw(); return 'read-file';
  }
  draw();
  return {
    canvas, texture, cursor,
    point(x, y) { cursor.set(THREE.MathUtils.clamp(x, 0, 799), THREE.MathUtils.clamp(y, 0, 449)); draw(); },
    click() {
      if (fileOpen && within(710, 36, 32, 29)) { fileOpen = false; draw(); return 'close-file'; }
      return !fileOpen && within(34, 42, 115, 127) ? openFile() : null;
    },
    key: code => (code === 'Enter' || code === 'NumpadEnter') && !fileOpen ? openFile() : null,
    focus(value) { focused = value; draw(); },
    reset() { focused = fileOpen = false; cursor.set(88, 106); draw(); },
    update() {},
  };
}

export function createBulkheadKeypad(progress: QuartersProgress): InteractiveDisplay {
  return createKeypad({ code: FORWARD_BULKHEAD_CODE, title: 'FORWARD BULKHEAD',
    isUnlocked: () => progress.bulkheadUnlocked, onUnlock: () => { progress.bulkheadUnlocked = true; } });
}

export function createKeypad({ code, title, isUnlocked, onUnlock, validate }: {
  code: string; title: string; isUnlocked: () => boolean; onUnlock: () => void; validate?: () => string | null;
}): InteractiveDisplay {
  if (!/^\d{4}$/.test(code)) throw new Error('Ship keypads require a four-digit code');
  const { canvas, context, texture } = canvasDisplay(360, 560), cursor = new THREE.Vector2(180, 285);
  texture.name = 'ForwardBulkheadKeypad';
  const buttons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'OK'].map((label, index) => ({
    label, x: 28 + index % 3 * 104, y: 144 + Math.floor(index / 3) * 98, width: 96, height: 83,
  }));
  let entry = '', focused = false, message = '', messageTime = 0, pressed = '', pressTime = 0;
  function hovered(button: typeof buttons[number]) {
    return cursor.x >= button.x && cursor.x <= button.x + button.width
      && cursor.y >= button.y && cursor.y <= button.y + button.height;
  }
  function draw() {
    context.fillStyle = '#0e1b29'; context.fillRect(0, 0, 360, 560);
    context.strokeStyle = '#526a7b'; context.lineWidth = 3; context.strokeRect(9, 9, 342, 542);
    context.textAlign = 'center'; context.textBaseline = 'alphabetic';
    context.fillStyle = '#a8d6ef'; context.font = 'bold 21px monospace'; context.fillText(title, 180, 38);
    context.fillStyle = '#07121c'; context.fillRect(27, 54, 306, 75);
    context.fillStyle = isUnlocked() ? '#96edbc' : message ? '#ff9494' : '#c5eaff';
    context.font = 'bold 33px monospace';
    context.fillText(isUnlocked() ? 'UNLOCKED' : entry.padEnd(code.length, '_').split('').join(' '), 180, 87);
    context.font = '15px monospace';
    context.fillText(isUnlocked() ? 'ACCESS GRANTED' : message || 'ENTER CODE / PRESS OK', 180, 115);
    for (const button of buttons) {
      const down = pressTime > 0 && pressed === button.label, y = button.y + (down ? 4 : 0);
      context.fillStyle = '#050b12'; context.fillRect(button.x, button.y + 5, button.width, button.height);
      context.fillStyle = focused && hovered(button) ? '#3a6480' : button.label === 'OK' ? '#23533f' : '#253c4e';
      context.fillRect(button.x, y, button.width, button.height - 4);
      context.strokeStyle = button.label === 'OK' ? '#69bf91' : '#698ca4';
      context.strokeRect(button.x, y, button.width, button.height - 4);
      context.fillStyle = '#eff7fc'; context.font = `bold ${button.label.length > 1 ? 23 : 35}px monospace`;
      context.fillText(button.label, button.x + button.width / 2, y + 51);
    }
    texture.needsUpdate = true;
  }
  function press(label: string): SurfaceAction | null {
    pressed = label === 'BACK' ? 'CLR' : label; pressTime = 0.18;
    if (isUnlocked()) { draw(); return null; }
    message = ''; messageTime = 0;
    let action: SurfaceAction | null = null;
    if (label === 'CLR') entry = '';
    else if (label === 'BACK') entry = entry.slice(0, -1);
    else if (label === 'OK') {
      if (entry === code) {
        const error = validate?.();
        if (error) { message = error; messageTime = 3; }
        else { onUnlock(); action = 'unlock'; }
      }
      else {
        message = entry.length === code.length ? 'CODE NOT RECOGNISED' : 'FOUR DIGITS REQUIRED';
        if (entry.length === code.length) entry = '';
        messageTime = 2.4;
      }
    } else if (entry.length < code.length) entry += label;
    draw(); return action;
  }
  draw();
  return {
    canvas, texture, cursor,
    point(x, y) { cursor.set(THREE.MathUtils.clamp(x, 0, 359), THREE.MathUtils.clamp(y, 0, 559)); draw(); },
    click() { const button = buttons.find(hovered); return button ? press(button.label) : null; },
    key(code) {
      const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
      const label = digit?.[1] ?? (code === 'Enter' || code === 'NumpadEnter' ? 'OK'
        : code === 'Backspace' ? 'BACK' : code === 'Delete' ? 'CLR' : null);
      if (!label) return null;
      const button = buttons.find(button => button.label === (label === 'BACK' ? 'CLR' : label))!;
      cursor.set(button.x + button.width / 2, button.y + button.height / 2);
      return press(label) ?? 'handled';
    },
    focus(value) { focused = value; draw(); },
    reset() { entry = message = pressed = ''; messageTime = pressTime = 0; focused = false; draw(); },
    update(dt) {
      const redraw = pressTime > 0 && pressTime <= dt || messageTime > 0 && messageTime <= dt;
      pressTime = Math.max(0, pressTime - dt); messageTime = Math.max(0, messageTime - dt);
      if (messageTime === 0) message = '';
      if (redraw) draw();
    },
  };
}
