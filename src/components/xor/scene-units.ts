import {
  IDLE_GATE_COLOR,
  INK_COLOR,
  LIGHT_TONE,
  LINE_COLOR,
  MID_TONE,
  PAPER_COLOR,
} from "../../games/xor/constants";

export const SCENE_SCALE = 5;

const hexColorOf = (color: number): string =>
  `#${color.toString(16).padStart(6, "0")}`;

export const TONES = {
  ink: hexColorOf(INK_COLOR),
  mid: hexColorOf(MID_TONE),
  light: hexColorOf(LIGHT_TONE),
  paper: hexColorOf(PAPER_COLOR),
  idle: hexColorOf(IDLE_GATE_COLOR),
  line: hexColorOf(LINE_COLOR),
} as const;
export type Tone = keyof typeof TONES;
