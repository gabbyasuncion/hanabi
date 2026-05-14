import assert from "assert";
import { cloneDeep, flatMap, range, shuffle } from "lodash";
import { shuffle as shuffleSeed } from "shuffle-seed";
import { generateShuffleSeed, nextGameId } from "./id";
import { emptyHint } from "./hint-system";
import IGameState, { GameVariant, IColor, IGameOptions, IGameStatus, IPlayer } from "./state";

export const startingHandSize = { 2: 5, 3: 5, 4: 4, 5: 4 };
export const MaxHints = 8;

export function joinGame(state: IGameState, player: IPlayer): IGameState {
  const game = cloneDeep(state) as IGameState;
  const hand = game.drawPile.splice(0, startingHandSize[game.options.playersCount]);

  game.players = game.players || [];
  game.players.push({ ...player, hand, index: game.players.length });

  hand.forEach((card) => (card.hint = emptyHint(state.options)));

  return game;
}

export function newGame(options: IGameOptions): IGameState {
  assert(options.playersCount > 1 && options.playersCount < 6);

  // All base cards
  const baseColors = [IColor.WHITE, IColor.BLUE, IColor.RED, IColor.GREEN, IColor.YELLOW];
  let cards = flatMap(baseColors, (color) => [
    { number: 1, color },
    { number: 1, color },
    { number: 1, color },
    { number: 2, color },
    { number: 2, color },
    { number: 3, color },
    { number: 3, color },
    { number: 4, color },
    { number: 4, color },
    { number: 5, color },
  ]);

  // Add multicolor cards when applicable
  if (options.variant === GameVariant.MULTICOLOR) {
    cards.push(
      { number: 1, color: IColor.MULTICOLOR },
      { number: 2, color: IColor.MULTICOLOR },
      { number: 3, color: IColor.MULTICOLOR },
      { number: 4, color: IColor.MULTICOLOR },
      { number: 5, color: IColor.MULTICOLOR }
    );
  }

  // Add orange cards when applicable
  if (options.variant === GameVariant.ORANGE) {
    cards.push(
      { number: 1, color: IColor.ORANGE },
      { number: 1, color: IColor.ORANGE },
      { number: 1, color: IColor.ORANGE },
      { number: 2, color: IColor.ORANGE },
      { number: 2, color: IColor.ORANGE },
      { number: 3, color: IColor.ORANGE },
      { number: 3, color: IColor.ORANGE },
      { number: 4, color: IColor.ORANGE },
      { number: 4, color: IColor.ORANGE },
      { number: 5, color: IColor.ORANGE }
    );
  }

  // Add rainbow cards when applicable
  if (options.variant === GameVariant.RAINBOW) {
    cards.push(
      { number: 1, color: IColor.RAINBOW },
      { number: 1, color: IColor.RAINBOW },
      { number: 1, color: IColor.RAINBOW },
      { number: 2, color: IColor.RAINBOW },
      { number: 2, color: IColor.RAINBOW },
      { number: 3, color: IColor.RAINBOW },
      { number: 3, color: IColor.RAINBOW },
      { number: 4, color: IColor.RAINBOW },
      { number: 4, color: IColor.RAINBOW },
      { number: 5, color: IColor.RAINBOW }
    );
  }

  // Add rainbow cards when applicable
  if (options.variant === GameVariant.CRITICAL_RAINBOW) {
    cards.push(
      { number: 1, color: IColor.RAINBOW },
      { number: 2, color: IColor.RAINBOW },
      { number: 3, color: IColor.RAINBOW },
      { number: 4, color: IColor.RAINBOW },
      { number: 5, color: IColor.RAINBOW }
    );
  }

  cards = cards.map((c, i) => {
    return {
      ...c,
      id: i,
    };
  });

  const deck = shuffleSeed(cards, options.seed);

  const currentPlayer = shuffleSeed(range(options.playersCount), options.seed)[0];

  return {
    id: options.id,
    status: IGameStatus.LOBBY,
    playedCards: [],
    drawPile: deck,
    discardPile: [],
    players: [],
    tokens: {
      hints: MaxHints,
      strikes: 0,
    },
    currentPlayer,
    options,
    actionsLeft: options.playersCount + 1, // this will be decreased when the draw pile is empty
    turnsHistory: [],
    messages: [],
    createdAt: Date.now(),
    synced: false,
    reviewComments: [],
  };
}

export function recreateGame(game: IGameState) {
  let nextGame = newGame({
    ...game.options,
    id: game.nextGameId || nextGameId(),
    seed: generateShuffleSeed(),
  });

  shuffle(game.players).forEach((player) => {
    nextGame = joinGame(nextGame, player);
  });

  return nextGame;
}
