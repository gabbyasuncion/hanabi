import { range } from "lodash";
import IGameState, {
  GameVariant,
  ICard,
  ICardHint,
  IColor,
  IGameOptions,
  IHand,
  IHintAction,
  IHintLevel,
  INumber,
} from "./state";

/**
 * Side effect function that applies the given hint on a given hand's cards
 */
export function applyHint(hand: IHand, hint: IHintAction, game: IGameState) {
  const isRainbowVariant =
    game.options.variant === GameVariant.RAINBOW || game.options.variant === GameVariant.CRITICAL_RAINBOW;
  const isSequenceVariant = game.options.variant === GameVariant.SEQUENCE;

  hint.cardsIndex = [];

  hand.forEach((card, index) => {
    if (matchHint(game, hint, card)) {
      hint.cardsIndex.push(index);

      if (!card.receivedHints) {
        card.receivedHints = [];
      }
      card.receivedHints.push({ action: hint });

      // positive hint on card - mark all other values as impossible (except rainbow)
      Object.keys(card.hint[hint.type])
        .filter((value) => {
          return isRainbowVariant ? value !== IColor.RAINBOW : true;
        })
        .filter((value) => {
          if (hint.type === "number" && isSequenceVariant) {
            return value < hint.value;
          }
          return value != hint.value;
        })
        .forEach((value) => {
          card.hint[hint.type][value] = IHintLevel.IMPOSSIBLE;
        });
    } else {
      // negative hint on card - mark as impossible
      card.hint[hint.type][hint.value] = IHintLevel.IMPOSSIBLE;

      if (hint.type === "number" && isSequenceVariant) {
        range(hint.value as INumber, 6).forEach((n) => {
          card.hint.number[n] = IHintLevel.IMPOSSIBLE;
        });
      }

      // for color hints, also mark rainbow as impossible
      if (hint.type === "color") {
        card.hint.color.rainbow = IHintLevel.IMPOSSIBLE;
      }
    }

    // if there's only one possible color, make it sure
    const onlyPossibleColors = Object.keys(card.hint.color).filter(
      (color) => card.hint.color[color] === IHintLevel.POSSIBLE
    );
    if (onlyPossibleColors.length === 1) {
      card.hint.color[onlyPossibleColors[0]] = IHintLevel.SURE;
    }

    // if there's only one possible number, make it sure
    const onlyPossibleNumbers = Object.keys(card.hint.number).filter(
      (number) => card.hint.number[number] === IHintLevel.POSSIBLE
    );
    if (onlyPossibleNumbers.length === 1) {
      card.hint.number[onlyPossibleNumbers[0]] = IHintLevel.SURE;
    }
  });
}

export function emptyHint(options: IGameOptions): ICardHint {
  return {
    color: {
      [IColor.BLUE]: 1,
      [IColor.RED]: 1,
      [IColor.GREEN]: 1,
      [IColor.YELLOW]: 1,
      [IColor.WHITE]: 1,
      [IColor.MULTICOLOR]: options.variant === GameVariant.MULTICOLOR ? 1 : 0,
      [IColor.RAINBOW]: 1, // Should never be used directly
      [IColor.ORANGE]: options.variant === GameVariant.ORANGE ? 1 : 0,
    },
    number: { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
  };
}

export function matchColor(colorA: IColor, colorB: IColor) {
  return colorA === colorB || colorA === IColor.RAINBOW || colorB === IColor.RAINBOW;
}

export function matchNumber(game: IGameState, numberA: INumber, numberB: INumber) {
  if (game.options.variant === GameVariant.SEQUENCE) {
    return numberA >= numberB;
  }

  return numberA === numberB;
}

export function matchHint(game: IGameState, hint: IHintAction, card: ICard) {
  return hint.type === "color"
    ? matchColor(card.color, hint.value as IColor)
    : matchNumber(game, card.number, hint.value as INumber);
}
