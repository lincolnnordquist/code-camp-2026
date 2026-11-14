/**
 * The Code Camp hall drawn as a floor layout: nine columns lettered A to I from left to right and
 * seven rows numbered 1 (the back row, by the kitchen) to 7 (the front row, by the stage), the
 * stage at the front, the kitchen and stairs in a recess at the back, and the entrance in the back
 * left corner. Doors are not drawn: FloorLayout has no field for them. Its own module, with no other
 * imports, so the map's stand-in (catalogExtras.ts) can bundle it without the sample booths.
 */
import type { FloorLayout } from './catalogExtras'

export const CODE_CAMP_LAYOUT: FloorLayout = {
  width: 1000,
  height: 850,
  walls: [[20, 20], [980, 20], [980, 700], [690, 700], [690, 830], [360, 830], [360, 700], [160, 700], [160, 840], [20, 840]],
  columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
  rows: 7,
  // Nine 80-wide tables on a 100 pitch span 60 to 940, centred between the walls; the column
  // letters sit in the band between the stage and the front row, row 7.
  firstTable: { x: 60, y: 170 },
  tableSize: { width: 80, height: 50 },
  pitch: { x: 100, y: 74 },
  areas: [
    { kind: 'stage', label: 'Stage', x: 300, y: 20, width: 400, height: 90 },
    { kind: 'kitchen', label: 'Kitchen', x: 360, y: 700, width: 280, height: 130 },
    { kind: 'other', label: 'Stairs', x: 640, y: 700, width: 50, height: 130 },
    { kind: 'other', label: 'Entrance', x: 20, y: 700, width: 140, height: 140 },
  ],
}
