// The turn number players SEE ("Turn 3"). Both engines count every individual player's turn (a 4-player round is turns 1-4, an extra turn is one more),
// and the legacy game shows ceil(count / seats at the table) (see useTurnFlow.ts): the seat count includes eliminated players and the count is not
// rewound when someone is eliminated, so the same formula is used for kernel games to show the same number the legacy game would for the same moment.
export function displayTurnNumber(globalTurn: number, seatCount: number): number {
  return Math.max(1, Math.ceil(globalTurn / Math.max(1, seatCount)));
}
