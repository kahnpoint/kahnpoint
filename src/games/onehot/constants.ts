export const FIXED_STEP_SECONDS = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;
export const MAX_PIXEL_RATIO = 2;
export const PAUSED_KEY = "paused";

export const WALK_SPEED = 9;
export const WALK_DAMPING = 10;
export const TAP_SECONDS = 0.18;
export const CAMERA_CLOSE_PER_STEP = 0.7;
export const BODY_ACROSS = 0.84;
export const OVERLAP_EPSILON = 1e-6;
export const PERPENDICULAR_PULL = 0.1;
export const PERPENDICULAR_SNAP = 0.005;
export const SETTLE_PULL = 0.35;
export const SETTLE_SNAP = 0.02;
export const SETTLE_LOOKAHEAD = 0.07;
export const REST_EPSILON = 1e-9;
export const TIME_EPSILON = 1e-9;

export const STICK_DEAD_ZONE = 0.2;
export const STICK_AXIS_SLOPE = 0.38;

export const TOUCH_SHAPE_COLOR = "#8a8a8a";
export const TOUCH_BAND_HEIGHT_PX = 200;
export const TOUCH_PAD_SIZE_PX = 150;
export const TOUCH_BUTTON_WIDTH_PX = 150;
export const TOUCH_BUTTON_HEIGHT_PX = 66;
export const TOUCH_BUTTON_GAP_PX = 18;
export const TOUCH_BUTTON_BORDER_PX = 4;
export const TAP_SLOP_PX = 10;
export const PLACE_LABEL = "Place gate";
export const REMOVE_LABEL = "Remove gate";
export const TOUCH_MARGIN_PX = 16;
export const TOUCH_DEAD_ZONE = 0.2;
export const TOUCH_AXIS_SLOPE = 0.38;

export const DEMO_WIDTH = 32;
export const DEMO_HEIGHT = DEMO_WIDTH;

export const STREAM_CELLS_PER_SECOND = 0.5;
export const STREAM_SPACING_CELLS = 0.75;

export const PATTERN_SIDE: number = 4;
export const PATTERN_PIXEL = 2;
export const INSIDE_PIXELS = PATTERN_SIDE * PATTERN_PIXEL;
export const TILE_PIXELS = INSIDE_PIXELS + 2;
export const FRAME_SHARE = 1 / TILE_PIXELS;
export const PATTERN_SHARE = INSIDE_PIXELS / TILE_PIXELS;
export const LINE_PIXELS = 2;
export const GATE_SCALE = 1;

export const INK_COLOR = 0x1b1b1b;
export const PAPER_COLOR = 0xffffff;
export const MID_TONE = 0x8c8c8c;
export const LIGHT_TONE = 0xc8c8c8;
export const BOUNDS_COLOR = 0xe4e4e4;
export const IDLE_GATE_COLOR = 0xdcdcdc;
export const LINE_COLOR = 0xe6e6e6;

export const POP_SECONDS = 0.15;
export const POP_GROWTH = 0.3;
export const FLASH_SECONDS = 0.25;
export const FILL_SECONDS = 0.3;
export const FACE_EASE_PER_SECOND = 14;
