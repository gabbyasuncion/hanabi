import { cloneDeep } from "lodash";
import mem from "mem";

// Re-export extracted modules for backward compatibility
export { getColors, getHintableColors } from "./variant-utils";
export { getScore, getMaximumScore, getPlayedCardsPile, getMaximumPossibleScore } from "./scoring";
export { applyHint, emptyHint, matchColor, matchNumber, matchHint } from "./hint-system";
export { isPlayable, isGameOver } from "./game-rules";
export { joinGame, newGame, recreateGame, startingHandSize, MaxHints } from "./game-creation";

// Import from extracted modules for internal use
import { isPlayable, isGameOver } from "./game-rules";
import { joinGame, newGame, MaxHints } from "./game-creation";
import { applyHint } from "./hint-system";
import { emptyHint } from "./hint-system";

import IGameState, { IAction, ICard, IGameStatus, IMessage, INumber, isCardAction, isHintAction } from "./state";

export const numbers: INumber[] = [1, 2, 3, 4, 5];

export function commitAction<A extends IAction>(state: IGameState, action: A): IGameState {
  const actionIsntFromCurrentPlayer = action.from !== state.currentPlayer;
  const isSelfHinting = isHintAction(action) && action.from == action.to;
  const isHintingWithoutTokens = action.action === "hint" && state.tokens.hints === 0;

  if (actionIsntFromCurrentPlayer || isHintingWithoutTokens || isSelfHinting) {
    return state;
  }

  // the function should be pure
  const s = cloneDeep(state) as IGameState;
  let playFailed: boolean = null;

  const player = s.players[action.from];

  let newCard = null as ICard;
  if (isCardAction(action)) {
    // remove the card from hand
    const [card] = player.hand.splice(action.cardIndex, 1);
    action.card = card;
    /** PLAY */
    if (action.action === "play") {
      if (isPlayable(card, s.playedCards)) {
        playFailed = false;
        s.playedCards.push(card);
        if (card.number === 5) {
          // play a 5, win a hint
          if (s.tokens.hints < MaxHints) s.tokens.hints += 1;
        }
      } else {
        // strike !
        playFailed = true;
        s.tokens.strikes += 1;
        s.discardPile.push(card);
      }
    } else {
      /** DISCARD */
      if (s.tokens.hints < MaxHints) {
        s.discardPile.push(card);
        s.tokens.hints += 1;
      } else {
        throw new Error("Invalid action, cannot discard when the hints are maxed out!");
      }
    }

    // in both cases (play, discard) we need to remove a card from the hand and get a new one
    if (s.drawPile && s.drawPile.length) {
      newCard = s.drawPile.pop();
      newCard.hint = emptyHint(state.options);
      player.hand.unshift(newCard);
    }
  }

  /** HINT */
  if (isHintAction(action)) {
    s.tokens.hints -= 1;

    const hand = s.players[action.to].hand;
    applyHint(hand, action, s);
  }

  // there's no card in the pile (or the last card was just drawn)
  // decrease the actionsLeft counter.
  // The game ends when it reaches 0.
  if (!s.drawPile || s.drawPile.length === 0) {
    s.actionsLeft -= 1;
  }

  // update player
  s.currentPlayer = (s.currentPlayer + 1) % s.options.playersCount;

  // update history
  s.turnsHistory.push({ action: action, card: newCard, failed: playFailed });

  if (isGameOver(s)) {
    s.status = IGameStatus.OVER;
    s.endedAt = Date.now();
  }

  return s;
}

export function sendMessage(state: IGameState, message: IMessage) {
  const newGame = cloneDeep(state);

  newGame.messages.push(message);

  return newGame;
}

/**
 * Rollback the state for the given amount of turns
 */
export const getStateAtTurn = mem(
  (state: IGameState, turnIndex: number) => {
    let newState = newGame(state.options);

    state.players.forEach((player) => {
      newState = joinGame(newState, player);
    });

    state.turnsHistory.slice(0, turnIndex).forEach((turn) => {
      newState = commitAction(newState, turn.action);
    });

    newState.messages = state.messages;
    newState.status = IGameStatus.ONGOING;
    newState.createdAt = state.createdAt;

    return newState;
  },
  {
    cacheKey: ([state, turn]) => `${state.id}-${turn}`,
  }
);
