import { findIndex } from "lodash";
import IGameState, { ICard } from "./state";
import { getMaximumPossibleScore } from "./scoring";

export function isPlayable(card: ICard, playedCards: ICard[]): boolean {
  const isPreviousHere =
    card.number === 1 || findIndex(playedCards, (c) => card.number === c.number + 1 && card.color === c.color) > -1; // first card on the pile // previous card belongs to the playedCards

  const isSameNotHere = findIndex(playedCards, (c) => c.number === card.number && c.color === card.color) === -1;

  return isPreviousHere && isSameNotHere;
}

export function isGameOver(state: IGameState) {
  return (
    state.actionsLeft <= 0 ||
    state.tokens.strikes >= 3 ||
    getMaximumPossibleScore(state) === (state.playedCards || []).length
  );
}
