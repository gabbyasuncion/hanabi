import { flatMap, last, zipObject } from "lodash";
import IGameState, { GameVariant, IColor, INumber } from "./state";
import { getColors } from "./variant-utils";

export function getScore(state: IGameState) {
  return state.playedCards.length;
}

export function getMaximumScore(state: IGameState) {
  switch (state.options.variant) {
    case GameVariant.MULTICOLOR:
    case GameVariant.RAINBOW:
    case GameVariant.CRITICAL_RAINBOW:
    case GameVariant.ORANGE:
      return 30;
    case GameVariant.CLASSIC:
    default:
      return 25;
  }
}

export function getPlayedCardsPile(state: IGameState): { [key in IColor]: INumber } {
  const colors = getColors(state.options.variant);

  return zipObject(
    colors,
    colors.map((color) => {
      const topCard = last(state.playedCards.filter((card) => card.color === color));

      return topCard ? topCard.number : 0;
    })
  ) as { [key in IColor]: INumber };
}

/**
 * Compute the max possible score with remaining cards in hand & deck
 * Doesn't take in account remaining turns
 */
export function getMaximumPossibleScore(state: IGameState): number {
  const playableCards = [...state.drawPile, ...flatMap(state.players, (p) => p.hand)];
  const playedCardsPile = getPlayedCardsPile(state);

  let maxScore = getMaximumScore(state);

  Object.keys(playedCardsPile).forEach((color) => {
    let value = playedCardsPile[color];

    while (value < 5) {
      const nextCard = playableCards.find((card) => card.color === color && card.number === value + 1);

      if (!nextCard) {
        maxScore -= 5 - value;
        break;
      }
      value += 1;
    }
  });

  return maxScore;
}
