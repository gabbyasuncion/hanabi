import { cloneDeep } from "lodash";
import { emptyHint, joinGame, MaxHints, newGame } from "./actions";
import { chooseAction, gameStateToGameView, IDeduction, IGameView, IHiddenCard } from "./ai";
import IGameState, {
  GameMode,
  GameVariant,
  ICard,
  IColor,
  IGameHintsLevel,
  IGameOptions,
  IGameStatus,
  IHintAction,
  INumber,
  IPlayer,
  ITurn,
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
 * Build an IGameView by running gameStateToGameView() on a freshly built IGameState.
 * Tests then mutate gameViews / players / tokens / turnsHistory etc. to set up
 * the precise precondition for each priority branch of chooseAction.
 */
function makeView(overrides: Partial<IGameOptions> = {}): IGameView {
  return gameStateToGameView(makeGame(overrides));
}

function makeCard(state: IGameState, color: IColor, number: INumber, id = 9999): ICard {
  return { color, number, id, hint: emptyHint(state.options) };
}

function makeDeduction(color: IColor, number: INumber, deductionLevel = 0): IDeduction {
  return { color, number, deductionLevel } as IDeduction;
}

function makeHiddenCard(state: IGameState, deductions: IDeduction[], optimist = false): IHiddenCard {
  return {
    hint: emptyHint(state.options),
    deductions,
    optimist,
  };
}

/**
 * A hand of 5 single-deduction cards that are neither playable (numbers > 1
 * with empty playedCards) nor "definitely playable" (every deduction must be
 * playable; a single non-playable deduction breaks that).
 *
 * Each individual card is also discardable (its single deduction is not
 * dangerous in the default empty discardPile), which keeps `priority 4`
 * naturally available when we need it.
 */
function makeBenignHand(state: IGameState): IHiddenCard[] {
  return [
    makeHiddenCard(state, [makeDeduction(IColor.RED, 2)]),
    makeHiddenCard(state, [makeDeduction(IColor.GREEN, 3)]),
    makeHiddenCard(state, [makeDeduction(IColor.BLUE, 4)]),
    makeHiddenCard(state, [makeDeduction(IColor.WHITE, 2)]),
    makeHiddenCard(state, [makeDeduction(IColor.YELLOW, 3)]),
  ];
}

/**
 * A non-empty turnsHistory entry used to disable the first-turn-hint branch
 * (priority 5) for tests that target lower-priority paths.
 */
function nonEmptyTurnsHistory(): ITurn[] {
  return [{ action: { action: "discard", from: 0, cardIndex: 0 } } as ITurn];
}

describe("chooseAction", () => {
  describe("priority 1: definitely playable card", () => {
    it("returns a play action for the first card whose every deduction is playable", () => {
      const view = makeView();
      view.playedCards = [];
      view.gameViews[0].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 1)]),
        makeHiddenCard(view, [makeDeduction(IColor.BLUE, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 3)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 4)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 2)]),
      ];

      const action = chooseAction(view);

      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });

    it("returns the first definitely-playable card when multiple cards qualify", () => {
      const view = makeView();
      view.playedCards = [];
      view.gameViews[0].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 2)]),
        makeHiddenCard(view, [makeDeduction(IColor.RED, 1)]),
        makeHiddenCard(view, [makeDeduction(IColor.BLUE, 1)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 4)]),
      ];

      const action = chooseAction(view);

      expect(action).toEqual({ action: "play", from: 0, cardIndex: 1 });
    });

    it("considers a multi-deduction card definitely playable only when every deduction is playable", () => {
      const view = makeView();
      view.playedCards = [];
      // Stack RED 1 onto playedCards so RED 2 is also playable -> a card with
      // deductions [RED 1, RED 2]... wait, RED 1 is no longer playable after it's
      // already played. Use [RED 2, BLUE 1] vs played [RED 1]: RED 2 playable
      // (RED 1 stacked), but BLUE 1 is also playable (number=1) -> both playable.
      view.playedCards = [makeCard(view, IColor.RED, 1, 100)];
      view.gameViews[0].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 2), makeDeduction(IColor.BLUE, 1)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 4)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 3)]),
        makeHiddenCard(view, [makeDeduction(IColor.BLUE, 5)]),
      ];

      const action = chooseAction(view);

      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });

    it("does not consider a card definitely playable when any deduction is not playable", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2; // disable optimist path so we cleanly test priority 1 skip
      view.tokens.hints = MaxHints; // disable discard path
      view.turnsHistory = nonEmptyTurnsHistory(); // disable first-turn-hint
      view.gameViews[0].hand = [
        // RED 1 playable, RED 2 NOT playable -> every() is false
        makeHiddenCard(view, [makeDeduction(IColor.RED, 1), makeDeduction(IColor.RED, 2)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.BLUE, 3)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 4)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 2)]),
      ];
      // Player 1 has a playable card -> findGivableHint will return a hint,
      // so the action we observe is "hint", not "play".
      view.players[1].hand = [
        makeCard(view, IColor.RED, 1, 200),
        makeCard(view, IColor.BLUE, 3, 201),
        makeCard(view, IColor.GREEN, 4, 202),
        makeCard(view, IColor.WHITE, 2, 203),
        makeCard(view, IColor.YELLOW, 3, 204),
      ];

      const action = chooseAction(view);

      expect(action.action).toBe("hint");
    });
  });

  describe("priority 2: optimist card play (strikes < 2)", () => {
    it("plays the most recent optimist card when one deduction is playable and it is not the last discardable card", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 0;
      view.gameViews[0].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 2)]),
        makeHiddenCard(view, [makeDeduction(IColor.RED, 1), makeDeduction(IColor.BLUE, 3)], true),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 2)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 3)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 4)]),
      ];

      const action = chooseAction(view);

      expect(action).toEqual({ action: "play", from: 0, cardIndex: 1 });
    });

    it("skips the optimist path when strikes >= 2", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = MaxHints; // skip discard
      view.turnsHistory = nonEmptyTurnsHistory(); // skip first-turn-hint
      view.gameViews[0].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 1), makeDeduction(IColor.BLUE, 5)], true),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 2)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 3)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 4)]),
        makeHiddenCard(view, [makeDeduction(IColor.RED, 5)]),
      ];
      view.players[1].hand = [
        makeCard(view, IColor.RED, 1, 300),
        makeCard(view, IColor.BLUE, 3, 301),
        makeCard(view, IColor.GREEN, 4, 302),
        makeCard(view, IColor.WHITE, 2, 303),
        makeCard(view, IColor.YELLOW, 3, 304),
      ];

      const action = chooseAction(view);

      // Priority 2 skipped -> priority 3 (hint) takes over since hints == MaxHints.
      expect(action.action).toBe("hint");
      expect(action).not.toEqual({ action: "play", from: 0, cardIndex: 0 });
    });

    it("does not play the optimist card when none of its deductions are playable", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 0;
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory();
      view.gameViews[0].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 2)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 3), makeDeduction(IColor.BLUE, 4)], true),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 2)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 3)]),
        makeHiddenCard(view, [makeDeduction(IColor.RED, 4)]),
      ];
      view.players[1].hand = [
        makeCard(view, IColor.RED, 1, 400),
        makeCard(view, IColor.BLUE, 3, 401),
        makeCard(view, IColor.GREEN, 4, 402),
        makeCard(view, IColor.WHITE, 2, 403),
        makeCard(view, IColor.YELLOW, 3, 404),
      ];

      const action = chooseAction(view);

      expect(action.action).not.toBe("play");
    });

    it("does not play the optimist card when it is the last discardable card in the hand", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 0;
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory();
      // optimist at index 1, all cards after it have only-5 deductions
      // (every deduction dangerous -> not discardable). So index 1 IS the
      // last discardable card and priority 2 is skipped.
      view.gameViews[0].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 2)]),
        makeHiddenCard(view, [makeDeduction(IColor.RED, 1), makeDeduction(IColor.BLUE, 2)], true),
        makeHiddenCard(view, [makeDeduction(IColor.RED, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.BLUE, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 5)]),
      ];
      view.players[1].hand = [
        makeCard(view, IColor.RED, 1, 500),
        makeCard(view, IColor.BLUE, 3, 501),
        makeCard(view, IColor.GREEN, 4, 502),
        makeCard(view, IColor.WHITE, 2, 503),
        makeCard(view, IColor.YELLOW, 3, 504),
      ];

      const action = chooseAction(view);

      expect(action).not.toEqual({ action: "play", from: 0, cardIndex: 1 });
      expect(action.action).toBe("hint");
    });
  });

  describe("priority 3: give hint (hints > 0)", () => {
    it("returns a hint targeting the next player who doesn't know what to play", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2; // skip priority 2
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory(); // skip priority 5
      view.gameViews[0].hand = makeBenignHand(view);
      view.players[1].hand = [
        makeCard(view, IColor.RED, 1, 600),
        makeCard(view, IColor.BLUE, 3, 601),
        makeCard(view, IColor.GREEN, 4, 602),
        makeCard(view, IColor.WHITE, 2, 603),
        makeCard(view, IColor.YELLOW, 3, 604),
      ];
      // ensure player 1 doesn't already "know what to play"
      view.gameViews[1].hand.forEach((c) => (c.optimist = false));

      const action = chooseAction(view);

      expect(action.action).toBe("hint");
      const hint = action as IHintAction;
      expect(hint.from).toBe(0);
      expect(hint.to).toBe(1);
      // RED 1 is the first playable card in player 1's hand and is unhinted
      // (color=1, number=1 -> both < 2). findGivableHint prefers the color
      // hint when no earlier same-color card exists.
      expect(hint.type).toBe("color");
      expect(hint.value).toBe(IColor.RED);
    });

    it("skips the hint path when hints === 0 (forces discard or fallback)", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = 0;
      view.turnsHistory = nonEmptyTurnsHistory();
      view.gameViews[0].hand = makeBenignHand(view);
      view.players[1].hand = [
        makeCard(view, IColor.RED, 1, 700),
        makeCard(view, IColor.BLUE, 3, 701),
        makeCard(view, IColor.GREEN, 4, 702),
        makeCard(view, IColor.WHITE, 2, 703),
        makeCard(view, IColor.YELLOW, 3, 704),
      ];

      const action = chooseAction(view);

      // hints === 0 disables priority 3. hints < 8 so priority 4 takes over
      // and discards the right-most discardable card (none of the benign hand
      // cards are dangerous).
      expect(action.action).toBe("discard");
      expect(action.from).toBe(0);
    });

    it("skips the hint path when all other players already know what to play (have an optimist playable card)", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory();
      view.gameViews[0].hand = makeBenignHand(view);
      // Player 1 knows what to play: gameViews[1].hand[0].optimist=true AND
      // players[1].hand[0] is playable (RED 1 with empty playedCards).
      view.players[1].hand = [
        makeCard(view, IColor.RED, 1, 800),
        makeCard(view, IColor.BLUE, 3, 801),
        makeCard(view, IColor.GREEN, 4, 802),
        makeCard(view, IColor.WHITE, 2, 803),
        makeCard(view, IColor.YELLOW, 3, 804),
      ];
      view.gameViews[1].hand.forEach((c, i) => (c.optimist = i === 0));

      const action = chooseAction(view);

      // All higher priorities skipped, priority 4 also skipped (hints==MaxHints),
      // priority 5 skipped (non-empty turnsHistory), so fallback play kicks in.
      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });

    it("continues to lower priorities when findGivableHint returns undefined (no playable card and last card not dangerous)", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory();
      view.gameViews[0].hand = makeBenignHand(view);
      // Player 1: no 1s anywhere (nothing playable) AND last card is a 4
      // (identicalCount=2, no discards -> not dangerous). findGivableHint
      // returns undefined.
      view.players[1].hand = [
        makeCard(view, IColor.RED, 2, 900),
        makeCard(view, IColor.BLUE, 3, 901),
        makeCard(view, IColor.GREEN, 3, 902),
        makeCard(view, IColor.WHITE, 2, 903),
        makeCard(view, IColor.YELLOW, 4, 904),
      ];
      view.gameViews[1].hand.forEach((c) => (c.optimist = false));

      const action = chooseAction(view);

      // priority 3 falls through, priority 4 skipped (hints==MaxHints),
      // priority 5 skipped (non-empty history), priority 6 fallback play.
      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });
  });

  describe("priority 4: discard (hints < MaxHints)", () => {
    it("returns a discard action when hints < MaxHints and a discardable card exists", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = 0; // also skips priority 3
      view.turnsHistory = nonEmptyTurnsHistory();
      view.gameViews[0].hand = makeBenignHand(view);

      const action = chooseAction(view);

      expect(action.action).toBe("discard");
      expect(action.from).toBe(0);
      expect(action.cardIndex).toBeGreaterThanOrEqual(0);
    });

    it("skips the discard path when hints === MaxHints", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory();
      view.gameViews[0].hand = makeBenignHand(view);
      // make priority 3 fall through (no playable in player 1's hand, last card not dangerous)
      view.players[1].hand = [
        makeCard(view, IColor.RED, 2, 1000),
        makeCard(view, IColor.BLUE, 3, 1001),
        makeCard(view, IColor.GREEN, 3, 1002),
        makeCard(view, IColor.WHITE, 2, 1003),
        makeCard(view, IColor.YELLOW, 4, 1004),
      ];
      view.gameViews[1].hand.forEach((c) => (c.optimist = false));

      const action = chooseAction(view);

      expect(action.action).not.toBe("discard");
      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });

    it("does not discard when findBestDiscardIndex returns -1 (every deduction in every card is dangerous)", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = 0; // skip priority 3
      view.turnsHistory = nonEmptyTurnsHistory(); // skip priority 5
      // Every card has only-5 deductions -> all dangerous -> not discardable.
      view.gameViews[0].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.BLUE, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 5)]),
      ];

      const action = chooseAction(view);

      expect(action.action).not.toBe("discard");
      // Priority 4 fails -> priority 5 skipped (history non-empty) -> fallback play.
      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });
  });

  describe("priority 5: first-turn hint (turnsHistory empty)", () => {
    it("hints number=5 to the next player when their hand contains a 5", () => {
      const view = makeView();
      view.playedCards = [];
      // turnsHistory is [] by default from newGame; hints == MaxHints by default
      view.gameViews[0].hand = makeBenignHand(view);
      // player 1 hand: no 1s (no playable card), has a 5 somewhere, last card
      // is a 4 (not dangerous) so findGivableHint returns undefined.
      view.players[1].hand = [
        makeCard(view, IColor.RED, 2, 1100),
        makeCard(view, IColor.GREEN, 5, 1101),
        makeCard(view, IColor.BLUE, 3, 1102),
        makeCard(view, IColor.WHITE, 2, 1103),
        makeCard(view, IColor.YELLOW, 4, 1104),
      ];
      view.gameViews[1].hand.forEach((c) => (c.optimist = false));

      const action = chooseAction(view);

      expect(action.action).toBe("hint");
      const hint = action as IHintAction;
      expect(hint.from).toBe(0);
      expect(hint.to).toBe(1);
      expect(hint.type).toBe("number");
      expect(hint.value).toBe(5);
    });

    it("hints number=2 to the next player when their hand has no 5", () => {
      const view = makeView();
      view.playedCards = [];
      view.gameViews[0].hand = makeBenignHand(view);
      view.players[1].hand = [
        makeCard(view, IColor.RED, 2, 1200),
        makeCard(view, IColor.GREEN, 3, 1201),
        makeCard(view, IColor.BLUE, 3, 1202),
        makeCard(view, IColor.WHITE, 2, 1203),
        makeCard(view, IColor.YELLOW, 4, 1204), // last card not dangerous (4 with no discards)
      ];
      view.gameViews[1].hand.forEach((c) => (c.optimist = false));

      const action = chooseAction(view);

      expect(action.action).toBe("hint");
      const hint = action as IHintAction;
      expect(hint.from).toBe(0);
      expect(hint.to).toBe(1);
      expect(hint.type).toBe("number");
      expect(hint.value).toBe(2);
    });

    it("does not give a first-turn hint when turnsHistory is non-empty", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory();
      view.gameViews[0].hand = makeBenignHand(view);
      view.players[1].hand = [
        makeCard(view, IColor.RED, 2, 1300),
        makeCard(view, IColor.GREEN, 5, 1301),
        makeCard(view, IColor.BLUE, 3, 1302),
        makeCard(view, IColor.WHITE, 2, 1303),
        makeCard(view, IColor.YELLOW, 4, 1304),
      ];
      view.gameViews[1].hand.forEach((c) => (c.optimist = false));

      const action = chooseAction(view);

      // Priority 5 skipped, fallback play returned.
      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });
  });

  describe("priority 6: fallback play", () => {
    it("plays cardIndex 0 when all higher priorities are skipped", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory();
      view.gameViews[0].hand = makeBenignHand(view);
      // player 1 has no playable card and last card is not dangerous
      view.players[1].hand = [
        makeCard(view, IColor.RED, 2, 1400),
        makeCard(view, IColor.GREEN, 3, 1401),
        makeCard(view, IColor.BLUE, 3, 1402),
        makeCard(view, IColor.WHITE, 2, 1403),
        makeCard(view, IColor.YELLOW, 4, 1404),
      ];
      view.gameViews[1].hand.forEach((c) => (c.optimist = false));

      const action = chooseAction(view);

      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });

    it("plays cardIndex 0 even when card 0 is not actually playable (fallback risk)", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory();
      // Card 0 deduction is RED 2 -> NOT playable with empty playedCards.
      // chooseAction still blindly returns play on cardIndex 0.
      view.gameViews[0].hand = makeBenignHand(view);
      view.players[1].hand = [
        makeCard(view, IColor.RED, 2, 1500),
        makeCard(view, IColor.GREEN, 3, 1501),
        makeCard(view, IColor.BLUE, 3, 1502),
        makeCard(view, IColor.WHITE, 2, 1503),
        makeCard(view, IColor.YELLOW, 4, 1504),
      ];
      view.gameViews[1].hand.forEach((c) => (c.optimist = false));

      const action = chooseAction(view);

      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });
  });

  describe("edge cases and failure modes", () => {
    it("treats a card with empty deductions as definitely playable (vacuously true)", () => {
      const view = makeView();
      view.playedCards = [];
      view.gameViews[0].hand = [
        // Empty deductions -> .every() returns true regardless of playedCards.
        makeHiddenCard(view, []),
        makeHiddenCard(view, [makeDeduction(IColor.BLUE, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 3)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 4)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 2)]),
      ];

      const action = chooseAction(view);

      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });

    it("returns a fallback play (priority 6) when the current player's hand is empty", () => {
      const view = makeView();
      view.playedCards = [];
      view.tokens.strikes = 2;
      view.tokens.hints = MaxHints;
      view.turnsHistory = nonEmptyTurnsHistory();
      view.gameViews[0].hand = []; // empty hand -> priorities 1, 2, 4 all no-op
      view.players[1].hand = [
        makeCard(view, IColor.RED, 2, 1600),
        makeCard(view, IColor.GREEN, 3, 1601),
        makeCard(view, IColor.BLUE, 3, 1602),
        makeCard(view, IColor.WHITE, 2, 1603),
        makeCard(view, IColor.YELLOW, 4, 1604),
      ];
      view.gameViews[1].hand.forEach((c) => (c.optimist = false));

      const action = chooseAction(view);

      expect(action).toEqual({ action: "play", from: 0, cardIndex: 0 });
    });

    it("returns an action whose `from` is equal to state.currentPlayer", () => {
      const view = makeView({ playersCount: 3 });
      view.currentPlayer = 2;
      view.playedCards = [];
      view.gameViews[2].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 1)]),
        makeHiddenCard(view, [makeDeduction(IColor.BLUE, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 3)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 4)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 2)]),
      ];

      const action = chooseAction(view);

      expect(action.action).toBe("play");
      expect((action as { from: number }).from).toBe(2);
    });

    it("is pure: the input view's gameViews and players are not mutated", () => {
      const view = makeView();
      view.playedCards = [];
      view.gameViews[0].hand = [
        makeHiddenCard(view, [makeDeduction(IColor.RED, 1)]),
        makeHiddenCard(view, [makeDeduction(IColor.BLUE, 5)]),
        makeHiddenCard(view, [makeDeduction(IColor.GREEN, 3)]),
        makeHiddenCard(view, [makeDeduction(IColor.WHITE, 4)]),
        makeHiddenCard(view, [makeDeduction(IColor.YELLOW, 2)]),
      ];
      const snapshot = cloneDeep(view);

      chooseAction(view);

      expect(view).toEqual(snapshot);
    });
  });
});
