export type ArcadeDifficulty = "easy" | "medium" | "hard";
export type ArcadeScoring = "time" | "time-health" | "health" | "none";

export function arcadeChallenge(id: number): {
  scoring: ArcadeScoring;
  targetSeconds: number;
  instructions: string[];
} {
  if (id === 1.1)
    return {
      scoring: "health",
      targetSeconds: 0,
      instructions: [
        "Choose your difficulty before starting.",
        "Easy: climb the exit ladder to win.",
        "Medium: disable every hangar eye drone, then climb the exit ladder.",
        "Hard: disable every hangar eye drone and ground scavenger, then climb the exit ladder.",
        "The exit ladder stays locked until your difficulty's targets are cleared. Cargo ladders remain usable.",
      ],
    };
  if (id === 1.25)
    return {
      scoring: "time",
      targetSeconds: 900,
      instructions: [
        "A speedrun through the surveillance room and its six camera minigames. The vent maze is already cleared.",
        "Collect the minigame keycards, return to the elevator and swipe the accepted card to finish.",
        "Press Start to begin the timer. Built-in cutscenes are skipped; loading and paused time do not count.",
        "Your result records active time to the millisecond. You can download a styled PNG record image afterwards.",
      ],
    };
  if (id === 13 || id === 17)
    return {
      scoring: "time-health",
      targetSeconds: id === 13 ? 480 : 300,
      instructions:
        id === 13
          ? [
              "Defeat the Bay Warden through every combat phase.",
              "The run ends when you complete the finishing QTE, before the victory dialogue.",
              "Your grade combines time and health: 60% health remaining, 40% speed. Retries lower the grade.",
            ]
          : [
              "Start in the southeast corner and follow the stone trail towards the waterfall.",
              "The bridge is sealed by a metal gate. Take the waterfall route instead.",
              "Stay inside the fenced trail. The starting boundary stops backtracking; the waterfall detour is protected from the water.",
              "Up to 4 regular enemies can be alive anywhere. Enemies left behind still count; defeated enemies are replaced one at a time.",
              "Up to 4 enemies may attack at once, including the Waterfall Warden. Hold Shift (controller: sprint trigger) to run.",
              "Defeat the Waterfall Warden to finish. Your grade combines time and health: 60% health remaining, 40% speed. Retries lower the grade.",
            ],
    };
  if (id === 14)
    return {
      scoring: "none",
      targetSeconds: 0,
      instructions: [
        "Complete the escape QTE and leave aboard the ship.",
        "This is an ungraded challenge. There is no rank, health score or time score.",
      ],
    };
  if (id === 15 || id === 21)
    return {
      scoring: "health",
      targetSeconds: 0,
      instructions: [
        "Complete the stage to return to the Arcade results.",
        "Your grade rewards taking less damage and finishing with fewer retries.",
      ],
    };
  throw new Error(`Unknown Arcade challenge: ${id}`);
}

export function formatArcadeTime(seconds: number) {
  const milliseconds = Math.max(0, Math.floor(seconds * 1000));
  const minutes = Math.floor(milliseconds / 60000);
  const wholeSeconds = Math.floor(milliseconds / 1000) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

export async function downloadArcadeRecord(record: {
  stage: string;
  character: string;
  time: number;
  retries: number;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1380;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("A canvas is required to create the record image");
  ctx.fillStyle = "#142236";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e8262d";
  ctx.fillRect(74, 74, 1080, 1260);
  ctx.fillStyle = "#fff3d4";
  ctx.fillRect(56, 56, 1080, 1260);
  ctx.strokeStyle = "#10131a";
  ctx.lineWidth = 10;
  ctx.strokeRect(56, 56, 1080, 1260);
  ctx.fillStyle = "#10131a";
  ctx.font = "bold 28px Arial";
  ctx.fillText("BRONDON'S REVENGE / ARCADE", 100, 145);
  ctx.font = "900 78px Arial";
  ctx.fillText("SPEEDRUN RECORD", 100, 255, 990);
  ctx.font = "bold 36px Arial";
  ctx.fillText(record.stage, 100, 325, 990);
  ctx.fillStyle = "#ffd23a";
  ctx.fillRect(100, 385, 990, 180);
  ctx.strokeRect(100, 385, 990, 180);
  ctx.fillStyle = "#10131a";
  ctx.font = "900 110px monospace";
  ctx.fillText(formatArcadeTime(record.time), 130, 513, 930);
  const rows = [
    ["Character", record.character],
    ["Built-in cutscenes", "SKIPPED"],
    ["Retries", String(record.retries)],
    ["Recorded", new Date().toLocaleString()],
  ];
  rows.forEach(([label, value], index) => {
    const y = 665 + index * 95;
    ctx.font = "bold 28px Arial";
    ctx.fillText(label, 100, y);
    ctx.font = "30px Arial";
    ctx.textAlign = "right";
    ctx.fillText(value, 1090, y, 640);
    ctx.textAlign = "left";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, y + 30);
    ctx.lineTo(1090, y + 30);
    ctx.stroke();
  });
  ctx.font = "bold 28px Arial";
  ctx.fillText("CAMERA ROOM / PERSONAL RUN RECORD", 100, 1110, 990);
  ctx.font = "24px Arial";
  [
    "Active gameplay time only. Loading and menus are not timed.",
    "Built-in cutscenes are skipped, not watched and subtracted.",
    "A local personal record, not an independently verified leaderboard result.",
  ].forEach((line, index) => ctx.fillText(line, 100, 1165 + index * 38, 990));
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (image) => image
        ? resolve(image)
        : reject(new Error("Could not encode the Arcade record as a PNG")),
      "image/png",
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "brondons-revenge-camera-speedrun.png";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
