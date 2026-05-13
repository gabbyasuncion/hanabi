import { cloneDeep } from "lodash";
import { commitAction, emptyHint, joinGame, MaxHints, newGame } from "./actions";
import IGameState, {
  GameMode,
  GameVariant,
  ICard,
  IColor,
  IDiscardAction,
  IGameHintsLevel,
  IGameOptions,
  IGameStatus,
  IHintAction,
  IHintLevel,
  IHintType,
  INumber,
  IPlayAction,
  IPlayer,
} from "./state";

/**
 * Test helpers
 */

function makeOptions(overrides: Partial<IGameOptions> = {}): IGameOptions {
  return {
    id: "test-game",
    playersCount: 2,
    variant: GameVariant.CLASSIC,
    allowRollback: false,
    preventLoss: false,
    seed: "test-seed",
    private: false,
    hintsLevel: IGameHintsLevel.ALL,
    turnsHistory: false,
    botsWait: 0,
    gameMode: GameMode.NETWORK,
    colorBlindMode: false,
    ...overrides,
  };
}

function makePlayer(id: string, name: string): IPlayer {
  return { id, name, bot: false };
}

/**
 * Build a minimal valid IGameState via newGame() + joinGame().
 * The state is normalized so tests are deterministic:
 *   - currentPlayer is forced to 0
 *   - status is ONGOING
 */
function makeGame(overrides: Partial<IGameOptions> = {}): IGameState {
  let state = newGame(makeOptions(overrides));
  const playersCount = state.options.playersCount;
  for (let i = 0; i < playersCount; i++) {
    state = joinGame(state, makePlayer(`p${i}`, `Player ${i}`));
  }
  state.currentPlayer = 0;
  state.status = IGameStatus.ONGOING;
  return state;
}

/**
 * Build a card with a fresh empty hint matching the game's options.
 */
function makeCard(state: IGameState, color: IColor, number: INumber, id = 9999): ICard {
  return { color, number, id, hint: emptyHint(state.options) };
}

function playActionFor(from: number, cardIndex: number): IPlayAction {
  return { action: "play", from, cardIndex };
}

function discardActionFor(from: number, cardIndex: number): IDiscardAction {
  return { action: "discard", from, cardIndex };
}

function hintActionFor(from: number, to: number, type: IHintType, value: IColor | INumber): IHintAction {
  return { action: "hint", from, to, type, value };
}

describe("commitAction", () => {
  describe("play action", () => {
    describe("success (card is playable)", () => {
      it("adds the card to playedCards, removes it from the hand, draws a new card, and advances the turn", () => {
        const state = makeGame();
        const playable = makeCard(state, IColor.RED, 1, 1001);
        state.players[0].hand[0] = playable;
        const initialHandSize = state.players[0].hand.length;
        const initialDrawPileSize = state.drawPile.length;
        const topOfDraw = state.drawPile[state.drawPile.length - 1];

        const action = playActionFor(0, 0);
        const next = commitAction(state, action);

        // card added to playedCards
        expect(next.playedCards).toHaveLength(1);
        expect(next.playedCards[0]).toMatchObject({ color: IColor.RED, number: 1, id: 1001 });

        // original card removed from the hand
        expect(next.players[0].hand.find((c) => c.id === 1001)).toBeUndefined();

        // new card drawn from drawPile, hand size preserved
        expect(next.players[0].hand).toHaveLength(initialHandSize);
        expect(next.drawPile).toHaveLength(initialDrawPileSize - 1);
        // newly drawn card was inserted at the front of the hand and matches the popped draw card
        expect(next.players[0].hand[0].id).toBe(topOfDraw.id);

        // currentPlayer incremented
        expect(next.currentPlayer).toBe(1);

        // turn recorded with failed: false
        expect(next.turnsHistory).toHaveLength(1);
        expect(next.turnsHistory[0].failed).toBe(false);
        expect(next.turnsHistory[0].action).toBe(action);
        expect(next.turnsHistory[0].card?.id).toBe(topOfDraw.id);
      });

      it("does not award a hint token when the played card is not a 5", () => {
        const state = makeGame();
        state.tokens.hints = 4;
        state.players[0].hand[0] = makeCard(state, IColor.RED, 1, 1002);

        const next = commitAction(state, playActionFor(0, 0));

        expect(next.tokens.hints).toBe(4);
      });

      it("awards a hint token when a 5 is successfully played (and hints < MaxHints)", () => {
        const state = makeGame();
        // Pre-stack the playedCards with red 1..4 so red 5 is playable
        state.playedCards = [
          makeCard(state, IColor.RED, 1, 2001),
          makeCard(state, IColor.RED, 2, 2002),
          makeCard(state, IColor.RED, 3, 2003),
          makeCard(state, IColor.RED, 4, 2004),
        ];
        state.tokens.hints = 5;
        state.players[0].hand[0] = makeCard(state, IColor.RED, 5, 2005);

        const next = commitAction(state, playActionFor(0, 0));

        expect(next.tokens.hints).toBe(6);
      });

      it("does not exceed MaxHints when a 5 is played while hints are already at MaxHints", () => {
        const state = makeGame();
        state.playedCards = [
          makeCard(state, IColor.BLUE, 1, 2101),
          makeCard(state, IColor.BLUE, 2, 2102),
          makeCard(state, IColor.BLUE, 3, 2103),
          makeCard(state, IColor.BLUE, 4, 2104),
        ];
        state.tokens.hints = MaxHints;
        state.players[0].hand[0] = makeCard(state, IColor.BLUE, 5, 2105);

        const next = commitAction(state, playActionFor(0, 0));

        expect(next.tokens.hints).toBe(MaxHints);
      });
    });

    describe("failure (card is not playable)", () => {
      it("increments strikes, adds the card to discardPile, removes it from the hand, draws, and records a failed turn", () => {
        const state = makeGame();
        // Empty playedCards -> only number=1 is playable; using number=5 forces a strike
        const unplayable = makeCard(state, IColor.RED, 5, 3001);
        state.players[0].hand[0] = unplayable;
        const initialHandSize = state.players[0].hand.length;
        const initialDrawPileSize = state.drawPile.length;
        const initialStrikes = state.tokens.strikes;
        const topOfDraw = state.drawPile[state.drawPile.length - 1];

        const action = playActionFor(0, 0);
        const next = commitAction(state, action);

        // strike incremented
        expect(next.tokens.strikes).toBe(initialStrikes + 1);
        // playedCards untouched on failed plays
        expect(next.playedCards).toHaveLength(0);
        // card was added to the discardPile
        expect(next.discardPile).toHaveLength(1);
        expect(next.discardPile[0]).toMatchObject({ color: IColor.RED, number: 5, id: 3001 });

        // original card removed from hand
        expect(next.players[0].hand.find((c) => c.id === 3001)).toBeUndefined();

        // hand size preserved by drawing a new card
        expect(next.players[0].hand).toHaveLength(initialHandSize);
        expect(next.drawPile).toHaveLength(initialDrawPileSize - 1);
        expect(next.players[0].hand[0].id).toBe(topOfDraw.id);

        // failed turn recorded
        expect(next.turnsHistory).toHaveLength(1);
        expect(next.turnsHistory[0].failed).toBe(true);
        expect(next.turnsHistory[0].action).toBe(action);
      });
    });
  });

  describe("discard action", () => {
    describe("success (hints < MaxHints)", () => {
      it("adds the card to discardPile, increments hints, draws a new card, and advances the turn", () => {
        const state = makeGame();
        state.tokens.hints = 4;
        const toDiscard = makeCard(state, IColor.YELLOW, 3, 4001);
        state.players[0].hand[0] = toDiscard;
        const initialHandSize = state.players[0].hand.length;
        const initialDrawPileSize = state.drawPile.length;
        const topOfDraw = state.drawPile[state.drawPile.length - 1];

        const action = discardActionFor(0, 0);
        const next = commitAction(state, action);

        // card added to discardPile
        expect(next.discardPile).toHaveLength(1);
        expect(next.discardPile[0]).toMatchObject({ color: IColor.YELLOW, number: 3, id: 4001 });

        // hint token incremented
        expect(next.tokens.hints).toBe(5);

        // original card removed from hand and replaced by a freshly drawn one
        expect(next.players[0].hand.find((c) => c.id === 4001)).toBeUndefined();
        expect(next.players[0].hand).toHaveLength(initialHandSize);
        expect(next.drawPile).toHaveLength(initialDrawPileSize - 1);
        expect(next.players[0].hand[0].id).toBe(topOfDraw.id);

        // currentPlayer incremented
        expect(next.currentPlayer).toBe(1);

        // turn recorded
        expect(next.turnsHistory).toHaveLength(1);
        expect(next.turnsHistory[0].action).toBe(action);
        expect(next.turnsHistory[0].card?.id).toBe(topOfDraw.id);
        // discard turns are not marked failed
        expect(next.turnsHistory[0].failed).toBeNull();
      });
    });

    describe("failure (hints === MaxHints)", () => {
      it("throws an Error with the expected message when discarding at MaxHints", () => {
        const state = makeGame();
        state.tokens.hints = MaxHints;
        state.players[0].hand[0] = makeCard(state, IColor.GREEN, 2, 4101);

        expect(() => commitAction(state, discardActionFor(0, 0))).toThrow(
          "Invalid action, cannot discard when the hints are maxed out!"
        );
      });
    });
  });

  describe("hint action", () => {
    describe("success", () => {
      it("decrements hints, populates cardsIndex on matching cards, advances the turn, and records history", () => {
        const state = makeGame();
        state.tokens.hints = 5;
        // Stage a known hand for the receiver so we can predict matching indexes
        state.players[1].hand = [
          makeCard(state, IColor.RED, 1, 5001),
          makeCard(state, IColor.BLUE, 2, 5002),
          makeCard(state, IColor.RED, 3, 5003),
          makeCard(state, IColor.GREEN, 4, 5004),
          makeCard(state, IColor.RED, 5, 5005),
        ];

        const action = hintActionFor(0, 1, "color", IColor.RED);
        const next = commitAction(state, action);

        // hint token decremented
        expect(next.tokens.hints).toBe(4);

        // cardsIndex populated with every RED position in the hand
        expect(action.cardsIndex).toEqual([0, 2, 4]);
        expect(next.turnsHistory[0].action).toBe(action);
        expect((next.turnsHistory[0].action as IHintAction).cardsIndex).toEqual([0, 2, 4]);

        // matched cards have their color resolved to SURE on red
        const targetHand = next.players[1].hand;
        expect(targetHand[0].hint?.color.red).toBe(IHintLevel.SURE);
        expect(targetHand[2].hint?.color.red).toBe(IHintLevel.SURE);
        expect(targetHand[4].hint?.color.red).toBe(IHintLevel.SURE);
        // non-matching cards have red marked impossible
        expect(targetHand[1].hint?.color.red).toBe(IHintLevel.IMPOSSIBLE);
        expect(targetHand[3].hint?.color.red).toBe(IHintLevel.IMPOSSIBLE);

        // currentPlayer incremented
        expect(next.currentPlayer).toBe(1);
        // turn recorded
        expect(next.turnsHistory).toHaveLength(1);
      });
    });

    describe("failure (early return without state change)", () => {
      it("returns the same state reference when action.from !== state.currentPlayer", () => {
        const state = makeGame();
        const snapshot = cloneDeep(state);

        const next = commitAction(state, hintActionFor(1, 0, "color", IColor.RED));

        expect(next).toBe(state);
        expect(state).toEqual(snapshot);
      });

      it("returns the same state reference when action.from === action.to (self-hinting)", () => {
        const state = makeGame();
        const snapshot = cloneDeep(state);

        const next = commitAction(state, hintActionFor(0, 0, "color", IColor.RED));

        expect(next).toBe(state);
        expect(state).toEqual(snapshot);
      });

      it("returns the same state reference when state.tokens.hints === 0", () => {
        const state = makeGame();
        state.tokens.hints = 0;
        const snapshot = cloneDeep(state);

        const next = commitAction(state, hintActionFor(0, 1, "color", IColor.RED));

        expect(next).toBe(state);
        expect(state).toEqual(snapshot);
      });
    });
  });

  describe("general validation", () => {
    it("is pure: the original state object is not mutated for play actions", () => {
      const state = makeGame();
      state.players[0].hand[0] = makeCard(state, IColor.RED, 1, 6001);
      const snapshot = cloneDeep(state);

      const next = commitAction(state, playActionFor(0, 0));

      expect(next).not.toBe(state);
      expect(state).toEqual(snapshot);
    });

    it("is pure: the original state object is not mutated for discard actions", () => {
      const state = makeGame();
      state.tokens.hints = 3;
      state.players[0].hand[0] = makeCard(state, IColor.RED, 2, 6101);
      const snapshot = cloneDeep(state);

      const next = commitAction(state, discardActionFor(0, 0));

      expect(next).not.toBe(state);
      expect(state).toEqual(snapshot);
    });

    it("is pure: the original state object is not mutated for hint actions", () => {
      const state = makeGame();
      state.tokens.hints = 3;
      // Snapshot only the parts of state that should be preserved by commitAction.
      // Note: hint actions mutate the action object (cardsIndex), not the state.
      const stateSnapshot = cloneDeep(state);

      commitAction(state, hintActionFor(0, 1, "color", IColor.RED));

      expect(state).toEqual(stateSnapshot);
    });

    it("decrements actionsLeft when the drawPile is empty", () => {
      const state = makeGame();
      state.drawPile = [];
      const initialActionsLeft = state.actionsLeft;
      state.tokens.hints = 4;
      state.players[0].hand[0] = makeCard(state, IColor.RED, 2, 7001);

      const next = commitAction(state, discardActionFor(0, 0));

      expect(next.actionsLeft).toBe(initialActionsLeft - 1);
      // No new card drawn -> the discarded card is not replaced
      expect(next.players[0].hand.find((c) => c.id === 7001)).toBeUndefined();
    });

    it("does not decrement actionsLeft while drawPile still has cards", () => {
      const state = makeGame();
      const initialActionsLeft = state.actionsLeft;
      state.tokens.hints = 4;
      state.players[0].hand[0] = makeCard(state, IColor.RED, 2, 7101);

      const next = commitAction(state, discardActionFor(0, 0));

      expect(next.actionsLeft).toBe(initialActionsLeft);
    });

    it("sets game status to OVER when isGameOver returns true (third strike)", () => {
      const state = makeGame();
      state.tokens.strikes = 2;
      state.players[0].hand[0] = makeCard(state, IColor.RED, 5, 8001);

      const next = commitAction(state, playActionFor(0, 0));

      expect(next.tokens.strikes).toBe(3);
      expect(next.status).toBe(IGameStatus.OVER);
      expect(typeof next.endedAt).toBe("number");
    });

    it("does not set status to OVER on an ongoing game", () => {
      const state = makeGame();
      state.players[0].hand[0] = makeCard(state, IColor.RED, 1, 8101);

      const next = commitAction(state, playActionFor(0, 0));

      expect(next.status).toBe(IGameStatus.ONGOING);
      expect(next.endedAt).toBeUndefined();
    });
  });
});
