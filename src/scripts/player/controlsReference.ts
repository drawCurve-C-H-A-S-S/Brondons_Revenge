import {
  controllerMenuLabel,
  controllerText,
  controllerTypeName,
  type ConnectedController,
} from "./gamepadInput.js";

// This is an action reference, deliberately independent of tutorial HUD cards,
// owned equipment, scene progression and developer mode.
const bindings = [
  {
    id: "movement",
    title: "Movement and camera",
    rows: [
      ["Move", "WASD / arrow keys", "Left stick"],
      ["Look / aim", "Mouse", "Right stick"],
      ["Sprint / faster vent crawl", "Hold Shift", "Hold {zl}"],
      [
        "Stealth RUN burst",
        "Hold Shift (5 seconds); release to recharge",
        "Hold {zl} (5 seconds); release to recharge",
      ],
      [
        "Jump / climb faster",
        "Space / hold Space on a ladder",
        "{b} / hold {b} on a ladder",
      ],
      ["Crouch", "C", "{y}"],
      ["Slide tackle", "Sprint forward + C", "Sprint forward with {zl} + {y}"],
      ["First / third-person camera", "V", "{x}"],
      ["Dance", "9", "{right}"],
    ],
  },
  {
    id: "interaction",
    title: "Interaction and equipment",
    rows: [
      ["Interact / open / use / mount a ladder", "E", "{r}"],
      ["Grab / release cargo", "E; WASD to carry", "{r}; left stick to carry"],
      [
        "Weapon wheel",
        "Hold Tab; point with mouse; release Tab to equip",
        "Hold {l}; aim with right stick; release {l} to equip",
      ],
      ["Attack / shoot / unarmed punch", "Left mouse button", "{a}"],
      [
        "Directional sword attacks / combos",
        "Movement + click to chain; 5 rapid clicks for a heavy combo",
        "Left stick direction + {a}; repeated presses to chain",
      ],
      [
        "Holster",
        "Select Unarmed in the weapon wheel",
        "Select Unarmed in the weapon wheel",
      ],
      ["Wear / remove scanner goggles", "N", "{zr}"],
      [
        "Place / throw teleport crystal",
        "Tap Q / hold and release Q",
        "Tap {down} / hold and release {down}",
      ],
      ["Return to teleport anchor", "T", "{up}"],
      ["Return from minigame / retry checkpoint", "R", "{left}"],
    ],
  },
  {
    id: "menus",
    title: "Menus and cinematics",
    rows: [
      ["Pause / resume; open map from Pause", "M / Escape", "{plus}"],
      [
        "Choose menu item / scroll controls",
        "Arrow keys / Tab / mouse wheel",
        "Left stick / D-pad",
      ],
      ["Select / confirm", "Enter / left mouse button", "{confirm}"],
      ["Back / cancel weapon wheel", "Escape", "{cancel}"],
      ["Skip cinematic", "Hold Enter", "Hold {minus}"],
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
      ["Choose / confirm map button", "Tab / Enter / click", "D-pad / {confirm}"],
    ],
  },
  {
    id: "inspection",
    title: "Computers and inspection",
    rows: [
      ["Move pointer", "Mouse", "Right stick"],
      ["Select on-screen control", "Left mouse button", "{confirm}"],
      ["Close inspection", "Escape", "{cancel}"],
      ["Stand up / interact", "E", "{r}"],
    ],
  },
  {
    id: "flight",
    title: "Shuttle flight",
    rows: [
      ["Steer / move", "WASD", "Left stick"],
      ["Aim", "Mouse", "Right stick"],
      ["Fire", "Hold left mouse button", "Hold {a}"],
      ["Evade", "Space + movement direction", "{b} + left stick direction"],
      ["Activate collected shield", "Enter", "{r}"],
      ["Cockpit / chase camera", "V", "{x}"],
      ["Skip VS intro", "Enter", "{minus}"],
      ["Pause / resume", "M / Escape", "{plus}"],
    ],
  },
  {
    id: "escape",
    title: "Hangar escape actions",
    rows: [
      ["Shoot", "Y", "{a}"],
      ["Crowbar", "U", "{x}"],
      ["Dodge", "I", "{b}"],
      ["Bloomstick spin", "O", "{y}"],
      ["Launch shuttle", "E", "{r}"],
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
      ["Sword chain", "J", "{a}"],
      ["Rifle salvo", "F", "{x}"],
      ["Shield / parry", "Hold R", "Hold {zl}"],
      ["Slide tackle", "C", "{y}"],
      ["Dodge boost", "Space", "{b}"],
      ["Last Light", "E", "{r}"],
      ["Retry after defeat", "R", "{left}"],
    ],
  },
] as const;

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
      rows: group.rows.map(([action, keyboard]) => ({
        action,
        binding: keyboard as string,
        controllerBinding: null,
      })),
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
        })),
      })),
    })),
  ];
}
