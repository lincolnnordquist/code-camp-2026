/**
 * The Code Camp hall drawn as a floor layout: nine columns lettered A to I from left to right and
 * seven rows numbered 1 (the back row, by the kitchen) to 7 (the front row, by the stage), the
 * stage at the front and the kitchen in a recess at the back. Its own module, with no other
 * imports, so the map's stand-in (catalogExtras.ts) can bundle it without the sample booths.
 */
import type { FloorLayout } from './catalogExtras'

export const CODE_CAMP_LAYOUT: FloorLayout = {
  width: 1000,
  height: 840,
  walls: [[20, 20], [980, 20], [980, 700], [565, 700], [565, 830], [435, 830], [435, 700], [20, 700]],
  columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
  rows: 7,
  // Nine 80-wide tables on a 100 pitch span 60 to 940, centred between the walls; the column
  // letters sit in the band between the stage and the front row, row 7.
  firstTable: { x: 60, y: 170 },
  tableSize: { width: 80, height: 50 },
  pitch: { x: 100, y: 74 },
  areas: [
    { kind: 'stage', label: 'Stage', x: 370, y: 20, width: 260, height: 90 },
    { kind: 'kitchen', label: 'Kitchen', x: 435, y: 700, width: 130, height: 130 },
  ],
}
