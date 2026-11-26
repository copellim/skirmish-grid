// The one source of visual tokens for both screens. Dark only, by decision (doc-008 §10), and
// system fonts. The palette is the tabletop's: a slate mat, parchment ink, cobalt and crimson
// miniatures for the two sides, and the gold of the initiative marker for whoever acts — the same
// gold is the one filled button on screen, because pressing it is what moves the fight along.
export const theme = {
  background: '#161b24',
  panel: '#212936',
  panelBorder: '#374252',
  text: '#ece5d3',
  textDim: '#98a2b0',
  sideA: '#5d9cf5',
  sideB: '#e5655c',
  active: '#f2c94c',
  accent: '#f2c94c',
  danger: '#e5655c',
  cell: '#1b212c',
  cellReachable: '#274859',
  cellFiveFootStep: '#2e6a57',
  cellDoubleMove: '#233552',
  cellThreatened: '#46303a',
  /** The hatching's stripes: the threat wash, lifted so a stripe still reads over a movement tint. */
  threatStripe: '#7d4a58',
  /** Behind a token, so the side colour of its rim reads against the mat. */
  tokenFill: '#0f131a',
};

/**
 * The token of whoever acts is drawn larger than the others and breathes between the two scales,
 * one half-period per direction — the gold ring alone was not enough to find the turn on the mat.
 * It is the one motion on the mat besides the damage numbers, a deliberate design choice: any other
 * animation should be weighed against keeping the mat calm.
 */
export const activeToken = {
  restScale: 1.12,
  breathScale: 1.26,
  breathHalfPeriodMs: 900,
} as const;

/**
 * The diagonal hatching a square gets when it is both a destination and threatened: stripes of the
 * threat colour this thick, this far apart, over the movement tint — so both areas stay readable
 * where they overlap instead of one hiding the other.
 */
export const threatHatch = {
  stripeInPixels: 3,
  periodInPixels: 8,
} as const;

/** Type scale: display for the banner, title for names and section heads, body, small, micro. */
export const typeScale = {
  display: 26,
  title: 17,
  body: 15,
  small: 13,
  micro: 11,
} as const;

/** Spacing steps; nothing on screen uses a value outside this list. */
export const space = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
} as const;

export const radius = {
  s: 6,
  m: 10,
} as const;

/** The width from which the arena lays the grid and the panels side by side instead of stacked. */
export const WIDE_LAYOUT_MIN_WIDTH = 880;

/** Content never grows past this on a wide screen; it stays left-aligned inside. */
export const CONTENT_MAX_WIDTH = 1100;

export const sideColor = (side: 'A' | 'B'): string => (side === 'A' ? theme.sideA : theme.sideB);
