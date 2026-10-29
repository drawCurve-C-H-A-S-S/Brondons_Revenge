import type { CameraFeedId } from "../../scenes/level 1 stage 2/stageTwoLayout.js";
import prisonFootage from "../../assets/surveillance/prison.gif";
import cargoFootage from "../../assets/surveillance/cargo-hold.gif";
import tennisFootage from "../../assets/surveillance/bloomstick-tennis.gif";
import rustFootage from "../../assets/surveillance/rust-chamber.gif";
import ventFootage from "../../assets/surveillance/vent-maze.gif";
import targetFootage from "../../assets/surveillance/target-range.gif";
import reactorFootage from "../../assets/surveillance/reactor-sequencer.gif";
import rustTwoFootage from "../../assets/surveillance/rust-chamber-2.gif";

export const CAMERA_FOOTAGE: Readonly<Record<CameraFeedId, string>> = {
  "stage2-prison": prisonFootage,
  scene5: cargoFootage,
  "stage2-armory": tennisFootage,
  "stage2-rust": rustFootage,
  "stage2-vents": ventFootage,
  scene6: targetFootage,
  "stage2-reactor": reactorFootage,
  "stage2-rust2": rustTwoFootage,
};
