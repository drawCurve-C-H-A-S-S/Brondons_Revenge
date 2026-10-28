import {
  controllerMenuLabel,
  controllerText,
  controllerTypeName,
  type ConnectedController,
} from "./gamepadInput.js";
import { getKeysForAction, type InputAction } from "./inputActions.js";
type BindingRow = [
  action: string,
  keyboard: string,
  controller: string,
  remapAction?: InputAction,
];

type BindingGroup = {
  id: string;
  title: string;
  rows: BindingRow[];
};

// This is an action reference, deliberately independent of tutorial HUD cards,
// owned equipment, scene progression and developer mode.
const bindings: BindingGroup[] = [
  {
    id: "movement",
    title: "Movement and camera",
    rows: [
      ["Move", "WASD / arrow keys", "Left stick"],
      ["Look / aim", "Mouse", "Right stick"],
      [
        "Sprint / faster vent crawl",
        "Shift (toggle)",
        "{sprint} (toggle)",
        "sprint",
      ],
      [
        "Stealth RUN burst",
        "Shift (toggle); 5-second burst, recharges after use",
        "{sprint} (toggle); 5-second burst, recharges after use",
      ],
      [
        "Jump / climb faster",
        "Space / hold Space on a ladder",
        "{jump} / hold {jump} on a ladder",
        "jump",
      ],
      ["Crouch", "C", "{crouch}", "crouch"],
      ["Slide tackle", "Sprint forward + C", "Sprint forward with {sprint} + {crouch}"],
      [
        "First / third-person camera",
        "V",
        "{viewToggle}",
        "viewToggle",
      ],
      ["Dance", "9", "{right}"],
    ],
  },
  {
    id: "interaction",
    title: "Interaction and equipment",
    rows: [
      ["Interact / open / use / mount a ladder", "E", "{interact}", "interact"],
      ["Grab / release cargo", "E; WASD to carry", "{interact}; left stick to carry"],
      [
        "Weapon wheel",
        "Hold Tab; point with mouse; release Tab to equip",
        "Hold {weaponWheel}; aim with right stick; release {weaponWheel} to equip",
        "weaponWheel",
      ],
      [
        "Attack / shoot / unarmed punch",
        "Left mouse button",
        "{attack}",
        "attack",
      ],
      [
        "Directional sword attacks / combos",
        "Movement + click to chain; 5 rapid clicks for a heavy combo",
        "Left stick direction + {attack}; repeated presses to chain",
      ],
      [
        "Holster",
        "Select Unarmed in the weapon wheel",
        "Select Unarmed in the weapon wheel",
      ],
      ["Wear / remove scanner goggles", "N", "{dodge}"],
      [
        "Place / throw teleport crystal",
        "Tap Q / hold and release Q",
        "Tap {down} / hold and release {down}",
      ],
      ["Return to teleport anchor", "T", "{up}"],
      [
        "Return from minigame / retry checkpoint",
        "R",
        "{left}",
        "cancel",
      ],
    ],
  },
  {
    id: "menus",
    title: "Menus and cinematics",
    rows: [
      [
        "Pause / resume",
        "Escape",
        "{pause}",
        "pause",
      ],
      [
        "Open ship map",
        "M",
        "{map}",
        "map",
      ],
      [
        "Choose menu item / scroll controls",
        "Arrow keys / Tab / mouse wheel",
        "Left stick / D-pad",
      ],
      [
        "Select / confirm",
        "Enter / left mouse button",
        "{confirm}",
        "confirm",
      ],
      ["Back / cancel weapon wheel", "Escape", "{cancel}", "cancel"],
      ["Skip cinematic", "Enter", "{confirm}"],
      ["Dismiss tutorial card", "H / close button", "Closes automatically"],
      ["Hide HUD", "/", "Keyboard / (optional)"],
      ["Toggle character silhouette", "1", "Keyboard 1 (optional)"],
      ["Cycle bloom", "Backslash", "Keyboard Backslash (optional)"],
    ],
  },
  {
    id: "ship-map",
    title: "Ship map",
    rows: [
      ["Pan", "Right-drag / arrow keys", "Left stick"],
      ["Rotate", "Drag", "Right stick"],
      ["Zoom out / in", "Scroll / - and +", "{zl} / {zr}"],
      ["Change deck", "Click a deck filter", "{l} / {r}"],
      ["Locate Brondon", "F", "{y}"],
      ["Reset view", "Home", "{x}"],
      [
        "Choose / confirm map button",
        "Tab / Enter / click",
        "D-pad / {confirm}",
      ],
    ],
  },
  {
    id: "inspection",
    title: "Computers and inspection",
    rows: [
      ["Move pointer", "Mouse", "Right stick"],
      ["Select on-screen control", "Left mouse button", "{confirm}"],
      ["Close inspection", "Escape", "{cancel}", "cancel"],
      ["Stand up / interact", "E", "{r}", "interact"],
    ],
  },
  {
    id: "flight",
    title: "Shuttle flight",
    rows: [
      ["Steer / move", "WASD", "Left stick"],
      ["Aim", "Mouse", "Right stick"],
      ["Fire", "Hold left mouse button", "Hold {attack}"],
      ["Evade", "Space + movement direction", "{b} + left stick direction"],
      ["Activate collected shield", "Enter", "{r}", "confirm"],
      ["Cockpit / chase camera", "V", "{leftStick}", "viewToggle"],
      ["Skip VS intro", "Enter", "{confirm}"],
      ["Pause / resume", "Escape", "{plus}", "pause"],
    ],
  },
  {
    id: "escape",
    title: "Hangar escape actions",
    rows: [
      ["Shoot", "Y", "{zr}"],
      ["Crowbar", "U", "{x}"],
      ["Dodge", "I", "{b}", "dodge"],
      ["Bloomstick spin", "O", "{y}"],
      ["Launch shuttle", "E", "{r}", "interact"],
    ],
  },
  {
    id: "finale",
    title: "Final boss",
    rows: [
      [
        "Move / rise / dive in space",
        "A / D; W / S in space",
        "Left stick; up / down in space",
      ],
      ["Sword chain", "J", "{zr}"],
      ["Branden's Tears / rifle salvo", "F", "{x}"],
      ["Shield / parry", "Hold R", "Hold {zl}"],
      ["Slide tackle", "C", "{y}", "crouch"],
      ["Dodge boost", "Space", "{b}", "jump"],
      ["Brendan's Will", "E", "{r}", "interact"],
      ["Retry after defeat", "R", "{left}", "cancel"],
    ],
  },
];

function formatKeyCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "Space";
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  if (code === "ControlLeft" || code === "ControlRight") return "Ctrl";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  if (code === "ArrowUp") return "↑";
  if (code === "ArrowDown") return "↓";
  if (code === "ArrowLeft") return "←";
  if (code === "ArrowRight") return "→";
  if (code === "NumpadEnter") return "Numpad Enter";
  return code;
}

function currentKeyboardBinding(action?: InputAction): string | null {
  if (!action) return null;
  const keys = getKeysForAction(action);
  if (keys.length === 0) return null;
  return keys.map(formatKeyCode).join(" / ");
}

export function getControlsReference(
  controllers: readonly ConnectedController[],
) {
  const keyboard = {
    id: "keyboard",
    title: "Keyboard & Mouse",
    name: "Always available",
    ready: true,
    active: !controllers.some((device) => device.active),
    controllerType: null,
    swapAB: false,
    groups: bindings.map((group) => ({
      id: group.id,
      title: group.title,
      rows: group.rows.map(([action, keyboardDefault, , remapAction]) => {
        const liveBinding = currentKeyboardBinding(remapAction);
        return {
          action,
          binding: liveBinding ?? (keyboardDefault as string),
          controllerBinding: null,
          remapAction: remapAction ?? null,
        };
      }),
    })),
  };
  return [
    keyboard,
    ...controllers.map((device) => ({
      id: `controller-${device.index}`,
      title: `${controllerTypeName(device.type)} · Player ${device.index + 1}`,
      name: device.id,
      ready: device.ready,
      active: device.active,
      controllerType: device.type,
      swapAB: device.swapAB,
      groups: bindings.map((group) => ({
        id: group.id,
        title: group.title,
        rows: group.rows.map(([action, , controller]) => ({
          action,
          controllerBinding: controller,
          binding: controllerText(
            controller
              .replace(
                "{confirm}",
                controllerMenuLabel("confirm", device.type, device.swapAB),
              )
              .replace(
                "{cancel}",
                controllerMenuLabel("back", device.type, device.swapAB),
              ),
            device.type,
            device.swapAB,
          ),
          remapAction: null,
        })),
      })),
    })),
  ];
}
