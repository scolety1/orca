// REAL PILOT DATA -- NFL-specific, not generic engine code. Expected
// universe: every player selected to the 2002 Pro Bowl (honoring the 2001
// NFL regular season) at QB/RB/WR/TE, per Wikipedia's "2002 Pro Bowl"
// article -- a real, independent, citable enumeration oracle, distinct
// from whatever source populates each player's actual season statistics
// below (exactly the "do not use 'all rows returned by our chosen
// source' as the expected universe" requirement).
//
// Season statistics were gathered via real WebFetch calls against each
// player's individual Wikipedia article's career-statistics table for the
// 2001 season row, during this session, on 2026-09-04. Two players
// (Brady, Favre) had a table-rendering gap in that fetch (the 2001 row did
// not render in the converted markdown) -- those two are deliberately left
// as `null` here and resolved via real, targeted, paid provider dispatch
// in the pilot script instead of being backfilled by hand, exactly the
// "targeted research only for genuine gaps" policy this mission requires.
export const EXPECTED_UNIVERSE_SOURCE = Object.freeze({
  locator: 'https://en.wikipedia.org/wiki/2002_Pro_Bowl',
  description: '2002 Pro Bowl selections (honoring the 2001 NFL regular season) -- the independent universe-enumeration oracle for this pilot.',
  retrievedAt: '2026-09-04T00:00:00.000Z',
  license: 'CC-BY-SA (Wikipedia)'
})

export const STATS_SOURCE_LOCATOR_TEMPLATE = 'https://en.wikipedia.org/wiki/<Player_Page>'
export const STATS_RETRIEVED_AT = '2026-09-04T00:00:00.000Z'

// entityId convention: nfl:2001:<position>:<slug>
export const PILOT_PLAYERS = Object.freeze([
  // ---- QB ----
  { entityId: 'nfl:2001:qb:rich-gannon', name: 'Rich Gannon', team: 'OAK', position: 'QB', wikiTitle: 'Rich_Gannon', proBowlStatus: 'STARTER_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, passCompletions: 361, passAttempts: 549, passingYards: 3828, passingTouchdowns: 27, interceptions: 9 } },
  { entityId: 'nfl:2001:qb:tom-brady', name: 'Tom Brady', team: 'NE', position: 'QB', wikiTitle: 'Tom_Brady', proBowlStatus: 'RESERVE_AFC', stats: null }, // genuine gap -> real dispatch
  { entityId: 'nfl:2001:qb:kordell-stewart', name: 'Kordell Stewart', team: 'PIT', position: 'QB', wikiTitle: 'Kordell_Stewart', proBowlStatus: 'RESERVE_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, passCompletions: 266, passAttempts: 442, passingYards: 3109, passingTouchdowns: 14, interceptions: 11 } },
  { entityId: 'nfl:2001:qb:kurt-warner', name: 'Kurt Warner', team: 'STL', position: 'QB', wikiTitle: 'Kurt_Warner', proBowlStatus: 'STARTER_NFC', stats: { gamesPlayed: 16, gamesStarted: 16, passCompletions: 375, passAttempts: 546, passingYards: 4830, passingTouchdowns: 36, interceptions: 22 } },
  { entityId: 'nfl:2001:qb:jeff-garcia', name: 'Jeff Garcia', team: 'SF', position: 'QB', wikiTitle: 'Jeff_Garcia', proBowlStatus: 'RESERVE_NFC', stats: { gamesPlayed: 16, gamesStarted: 16, passCompletions: 316, passAttempts: 504, passingYards: 3538, passingTouchdowns: 32, interceptions: 12 } },
  { entityId: 'nfl:2001:qb:donovan-mcnabb', name: 'Donovan McNabb', team: 'PHI', position: 'QB', wikiTitle: 'Donovan_McNabb', proBowlStatus: 'ALTERNATE_NFC', stats: { gamesPlayed: 16, gamesStarted: 16, passCompletions: 285, passAttempts: 493, passingYards: 3233, passingTouchdowns: 25, interceptions: 12 } },
  { entityId: 'nfl:2001:qb:brett-favre', name: 'Brett Favre', team: 'GB', position: 'QB', wikiTitle: 'Brett_Favre', proBowlStatus: 'SELECTED_INJURED_NFC', stats: null }, // genuine gap -> real dispatch

  // ---- RB ----
  { entityId: 'nfl:2001:rb:curtis-martin', name: 'Curtis Martin', team: 'NYJ', position: 'RB', wikiTitle: 'Curtis_Martin', proBowlStatus: 'STARTER_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, rushingAttempts: 333, rushingYards: 1513, rushingTouchdowns: 10, receptions: 53, receivingYards: 320, receivingTouchdowns: 0 } },
  { entityId: 'nfl:2001:rb:priest-holmes', name: 'Priest Holmes', team: 'KC', position: 'RB', wikiTitle: 'Priest_Holmes', proBowlStatus: 'RESERVE_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, rushingAttempts: 327, rushingYards: 1555, rushingTouchdowns: 8, receptions: 62, receivingYards: 614, receivingTouchdowns: 2 } },
  { entityId: 'nfl:2001:rb:jerome-bettis', name: 'Jerome Bettis', team: 'PIT', position: 'RB', wikiTitle: 'Jerome_Bettis', proBowlStatus: 'RESERVE_INJURED_AFC', stats: { gamesPlayed: 11, gamesStarted: 11, rushingAttempts: 225, rushingYards: 1072, rushingTouchdowns: 4, receptions: 8, receivingYards: 48, receivingTouchdowns: 0 } },
  { entityId: 'nfl:2001:rb:corey-dillon', name: 'Corey Dillon', team: 'CIN', position: 'RB', wikiTitle: 'Corey_Dillon', proBowlStatus: 'ALTERNATE_AFC', stats: { gamesPlayed: 16, gamesStarted: null, rushingAttempts: 340, rushingYards: 1315, rushingTouchdowns: 10, receptions: 34, receivingYards: 228, receivingTouchdowns: 3 } },
  { entityId: 'nfl:2001:rb:marshall-faulk', name: 'Marshall Faulk', team: 'STL', position: 'RB', wikiTitle: 'Marshall_Faulk', proBowlStatus: 'STARTER_NFC', stats: { gamesPlayed: 14, gamesStarted: 14, rushingAttempts: 260, rushingYards: 1382, rushingTouchdowns: 12, receptions: 83, receivingYards: 765, receivingTouchdowns: 9 } },
  { entityId: 'nfl:2001:rb:ahman-green', name: 'Ahman Green', team: 'GB', position: 'RB', wikiTitle: 'Ahman_Green', proBowlStatus: 'RESERVE_NFC', stats: { gamesPlayed: 16, gamesStarted: null, rushingAttempts: 304, rushingYards: 1387, rushingTouchdowns: 9, receptions: 62, receivingYards: 594, receivingTouchdowns: 2 } },
  { entityId: 'nfl:2001:rb:garrison-hearst', name: 'Garrison Hearst', team: 'SF', position: 'RB', wikiTitle: 'Garrison_Hearst', proBowlStatus: 'RESERVE_NFC', stats: { gamesPlayed: 16, gamesStarted: null, rushingAttempts: 252, rushingYards: 1206, rushingTouchdowns: 4, receptions: 41, receivingYards: 347, receivingTouchdowns: 1 } },

  // ---- WR ----
  { entityId: 'nfl:2001:wr:marvin-harrison', name: 'Marvin Harrison', team: 'IND', position: 'WR', wikiTitle: 'Marvin_Harrison', proBowlStatus: 'STARTER_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 109, receivingYards: 1524, receivingTouchdowns: 15 } },
  { entityId: 'nfl:2001:wr:rod-smith', name: 'Rod Smith', team: 'DEN', position: 'WR', wikiTitle: 'Rod_Smith_(wide_receiver)', proBowlStatus: 'STARTER_INJURED_AFC', stats: { gamesPlayed: 15, gamesStarted: 14, receptions: 113, receivingYards: 1343, receivingTouchdowns: 11 } },
  { entityId: 'nfl:2001:wr:tim-brown', name: 'Tim Brown', team: 'OAK', position: 'WR', wikiTitle: 'Tim_Brown_(wide_receiver)', proBowlStatus: 'ALTERNATE_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 91, receivingYards: 1165, receivingTouchdowns: 9 } },
  { entityId: 'nfl:2001:wr:jimmy-smith', name: 'Jimmy Smith', team: 'JAX', position: 'WR', wikiTitle: 'Jimmy_Smith_(wide_receiver)', proBowlStatus: 'ALTERNATE_INJURED_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 112, receivingYards: 1373, receivingTouchdowns: 8 } },
  { entityId: 'nfl:2001:wr:troy-brown', name: 'Troy Brown', team: 'NE', position: 'WR', wikiTitle: 'Troy_Brown', proBowlStatus: 'ALTERNATE_AFC', stats: { gamesPlayed: 16, gamesStarted: 13, receptions: 101, receivingYards: 1199, receivingTouchdowns: 5 } },
  { entityId: 'nfl:2001:wr:hines-ward', name: 'Hines Ward', team: 'PIT', position: 'WR', wikiTitle: 'Hines_Ward', proBowlStatus: 'ALTERNATE_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 94, receivingYards: 1003, receivingTouchdowns: 4 } },
  { entityId: 'nfl:2001:wr:david-boston', name: 'David Boston', team: 'ARI', position: 'WR', wikiTitle: 'David_Boston', proBowlStatus: 'STARTER_NFC', stats: { gamesPlayed: 16, gamesStarted: 15, receptions: 98, receivingYards: 1598, receivingTouchdowns: 8 } },
  { entityId: 'nfl:2001:wr:terrell-owens', name: 'Terrell Owens', team: 'SF', position: 'WR', wikiTitle: 'Terrell_Owens', proBowlStatus: 'STARTER_NFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 93, receivingYards: 1412, receivingTouchdowns: 16 } },
  { entityId: 'nfl:2001:wr:keyshawn-johnson', name: 'Keyshawn Johnson', team: 'TB', position: 'WR', wikiTitle: 'Keyshawn_Johnson', proBowlStatus: 'RESERVE_NFC', stats: { gamesPlayed: 15, gamesStarted: null, receptions: 106, receivingYards: 1266, receivingTouchdowns: 1 } },
  { entityId: 'nfl:2001:wr:isaac-bruce', name: 'Isaac Bruce', team: 'STL', position: 'WR', wikiTitle: 'Isaac_Bruce', proBowlStatus: 'RESERVE_INJURED_NFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 64, receivingYards: 1106, receivingTouchdowns: 6 } },
  { entityId: 'nfl:2001:wr:joe-horn', name: 'Joe Horn', team: 'NO', position: 'WR', wikiTitle: 'Joe_Horn', proBowlStatus: 'ALTERNATE_INJURED_NFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 83, receivingYards: 1265, receivingTouchdowns: 9 } },
  { entityId: 'nfl:2001:wr:torry-holt', name: 'Torry Holt', team: 'STL', position: 'WR', wikiTitle: 'Torry_Holt', proBowlStatus: 'ALTERNATE_NFC', stats: { gamesPlayed: 16, gamesStarted: 14, receptions: 81, receivingYards: 1363, receivingTouchdowns: 7 } },

  // ---- TE ----
  { entityId: 'nfl:2001:te:tony-gonzalez', name: 'Tony Gonzalez', team: 'KC', position: 'TE', wikiTitle: 'Tony_Gonzalez', proBowlStatus: 'STARTER_INJURED_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 73, receivingYards: 917, receivingTouchdowns: 6 } },
  { entityId: 'nfl:2001:te:shannon-sharpe', name: 'Shannon Sharpe', team: 'BAL', position: 'TE', wikiTitle: 'Shannon_Sharpe', proBowlStatus: 'RESERVE_AFC', stats: { gamesPlayed: 16, gamesStarted: null, receptions: 73, receivingYards: 811, receivingTouchdowns: 2 } },
  { entityId: 'nfl:2001:te:ken-dilger', name: 'Ken Dilger', team: 'IND', position: 'TE', wikiTitle: 'Ken_Dilger', proBowlStatus: 'ALTERNATE_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 32, receivingYards: 343, receivingTouchdowns: 1 } },
  { entityId: 'nfl:2001:te:dwayne-carswell', name: 'Dwayne Carswell', team: 'DEN', position: 'TE', wikiTitle: 'Dwayne_Carswell', proBowlStatus: 'ALTERNATE_AFC', stats: { gamesPlayed: 16, gamesStarted: 16, receptions: 34, receivingYards: 299, receivingTouchdowns: 4 } },
  { entityId: 'nfl:2001:te:bubba-franks', name: 'Bubba Franks', team: 'GB', position: 'TE', wikiTitle: 'Bubba_Franks', proBowlStatus: 'STARTER_NFC', stats: { gamesPlayed: 16, gamesStarted: null, receptions: 36, receivingYards: 322, receivingTouchdowns: 9 } },
  { entityId: 'nfl:2001:te:byron-chamberlain', name: 'Byron Chamberlain', team: 'MIN', position: 'TE', wikiTitle: 'Byron_Chamberlain', proBowlStatus: 'ALTERNATE_NFC', stats: { gamesPlayed: 16, gamesStarted: null, receptions: 57, receivingYards: 666, receivingTouchdowns: 3 } },
  { entityId: 'nfl:2001:te:wesley-walls', name: 'Wesley Walls', team: 'CAR', position: 'TE', wikiTitle: 'Wesley_Walls', proBowlStatus: 'RESERVE_INJURED_NFC', stats: { gamesPlayed: 14, gamesStarted: null, receptions: 43, receivingYards: 452, receivingTouchdowns: 5 } }
])

export const FIELD_TYPES = Object.freeze({
  gamesPlayed: 'number', gamesStarted: 'number',
  passCompletions: 'number', passAttempts: 'number', passingYards: 'number', passingTouchdowns: 'number', interceptions: 'number',
  rushingAttempts: 'number', rushingYards: 'number', rushingTouchdowns: 'number',
  receptions: 'number', receivingYards: 'number', receivingTouchdowns: 'number'
})

// Real-API finding (2026-09-04, from the real pilot run itself): Parallel
// now rejects any output_schema lacking a real `properties` key ("Root
// object schema must have a 'properties' key", HTTP 422) -- a bare
// `{type:'object'}` placeholder (previously only ever exercised against
// the deterministic fake worker, which ignores schema content entirely)
// is not accepted by the real API. Mirrors nfl-2001-qb-research-fixture.mjs's
// own fieldsSchema() helper.
export function requestedOutputSchemaForPosition(position) {
  const fieldNames = requestedFieldsForPosition(position).map((f) => f.fieldName)
  return { type: 'object', properties: Object.fromEntries(fieldNames.map((f) => [f, { type: FIELD_TYPES[f] ?? 'string' }])) }
}

export function requestedFieldsForPosition(position) {
  const common = [
    { fieldName: 'gamesPlayed', valueType: 'number', required: true },
    { fieldName: 'gamesStarted', valueType: 'number', required: false }
  ]
  if (position === 'QB') {
    return [...common,
      { fieldName: 'passCompletions', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
      { fieldName: 'passAttempts', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
      { fieldName: 'passingYards', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
      { fieldName: 'passingTouchdowns', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
      { fieldName: 'interceptions', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] }
    ]
  }
  if (position === 'RB') {
    return [...common,
      { fieldName: 'rushingAttempts', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
      { fieldName: 'rushingYards', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
      { fieldName: 'rushingTouchdowns', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
      { fieldName: 'receptions', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
      { fieldName: 'receivingYards', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
      { fieldName: 'receivingTouchdowns', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] }
    ]
  }
  // WR / TE
  return [...common,
    { fieldName: 'receptions', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
    { fieldName: 'receivingYards', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] },
    { fieldName: 'receivingTouchdowns', valueType: 'number', required: true, requiredTemporalScopes: ['2001-regular-season'] }
  ]
}
