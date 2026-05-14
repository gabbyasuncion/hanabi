import IGameState, { GameVariant, IColor } from "./state";

export function getColors(variant: GameVariant) {
  switch (variant) {
    case GameVariant.MULTICOLOR:
      return [IColor.BLUE, IColor.GREEN, IColor.RED, IColor.WHITE, IColor.YELLOW, IColor.MULTICOLOR];
    case GameVariant.RAINBOW:
    case GameVariant.CRITICAL_RAINBOW:
      return [IColor.BLUE, IColor.GREEN, IColor.RED, IColor.WHITE, IColor.YELLOW, IColor.RAINBOW];
    case GameVariant.ORANGE:
      return [IColor.BLUE, IColor.GREEN, IColor.RED, IColor.WHITE, IColor.YELLOW, IColor.ORANGE];
    case GameVariant.CLASSIC:
    default:
      return [IColor.BLUE, IColor.GREEN, IColor.RED, IColor.WHITE, IColor.YELLOW];
  }
}

export function getHintableColors(state: IGameState) {
  return getColors(state.options.variant).filter((color) => color !== IColor.RAINBOW);
}
