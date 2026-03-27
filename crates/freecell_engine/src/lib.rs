mod action;
mod card;
mod deal;
mod env;
mod error;
mod game;
mod snapshot;
mod state;

pub use action::{
    ACTION_COUNT_OPTIONS, ACTION_SPACE_SIZE, Action, SlotRef, decode_action, encode_action,
};
pub use card::{CardId, CardView, Color, Suit};
pub use deal::microsoft_deal_deck;
pub use env::{FreecellEnvironment, RewardConfig};
pub use error::MoveError;
pub use game::Game;
pub use snapshot::{
    AutoPlayPolicy, ColumnView, EngineStatus, FoundationView, FreeCellView, GameSnapshot,
    ReplayExport, StepResult, TurnRecord,
};
pub use state::{Column, DealMode, GameState};

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn card(rank: u8, suit: Suit) -> CardId {
        CardId::from_rank_and_suit(rank, suit).expect("valid test card")
    }

    #[test]
    fn microsoft_seed_one_matches_reference_deck() {
        let labels = microsoft_deal_deck(1)
            .into_iter()
            .map(CardId::short_label)
            .collect::<Vec<_>>()
            .join(" ");

        assert_eq!(
            labels,
            "JH 2H 9D JS 5H 7D 7S 5D KH KS 9C 5C AH QS KD 3D 2C KC 9H QH JC AC AD 3S 4S 5S TC QD 4D AS 4H 7C 3C TH 4C TD 8D 2S JD 7H 6H 8C 8H QC 6S 3H 8S TS 6C 9S 2D 6D"
        );
    }

    #[test]
    fn multi_move_uses_available_capacity() {
        let mut state = GameState::empty();
        state.tableau[0].extend([
            card(7, Suit::Spades),
            card(6, Suit::Hearts),
            card(5, Suit::Clubs),
            card(4, Suit::Diamonds),
        ]);
        state.tableau[1].push(card(8, Suit::Hearts));
        state.freecells[0] = Some(card(1, Suit::Clubs));
        state.freecells[1] = Some(card(1, Suit::Diamonds));

        let game = Game::from_state(state, AutoPlayPolicy::Off);
        let action = Action::new(
            SlotRef::Tableau { index: 0 },
            SlotRef::Tableau { index: 1 },
            4,
        );

        assert!(game.validate_action(action).is_ok());
    }

    #[test]
    fn undo_and_redo_round_trip_the_state_hash() {
        let mut game = Game::with_policy(1, AutoPlayPolicy::Off);
        let initial_hash = game.snapshot().state_hash;
        let action = game.legal_actions()[0];
        game.apply_action(action)
            .expect("first legal action should apply");
        let moved_hash = game.snapshot().state_hash;

        assert_ne!(initial_hash, moved_hash);

        game.undo().expect("undo should exist");
        assert_eq!(game.snapshot().state_hash, initial_hash);

        game.redo().expect("redo should exist");
        assert_eq!(game.snapshot().state_hash, moved_hash);
    }

    #[test]
    fn safe_autoplay_requires_opposite_color_progress() {
        let mut state = GameState::empty();
        state.foundations = [2, 2, 2, 2];
        state.freecells[0] = Some(card(3, Suit::Hearts));

        let mut game = Game::from_state(state, AutoPlayPolicy::Safe);
        let turn = game
            .run_auto_play()
            .expect("safe autoplay should find a move");

        assert_eq!(turn.executed.len(), 1);
        assert_eq!(game.state().foundations[Suit::Hearts.index() as usize], 3);
        assert!(game.state().freecells[0].is_none());
    }

    #[test]
    fn replay_export_reproduces_the_final_state() {
        let mut game = Game::with_policy(1, AutoPlayPolicy::Off);
        for _ in 0..3 {
            let action = game.legal_actions()[0];
            game.apply_action(action)
                .expect("legal action should apply");
        }

        let replay = game.replay_export();
        let restored = Game::from_replay(&replay).expect("replay must restore");

        assert_eq!(restored.snapshot().state_hash, replay.final_state_hash);
    }

    #[test]
    fn legal_action_mask_matches_validation() {
        let game = Game::with_policy(1, AutoPlayPolicy::Off);
        let legal_actions = game.legal_actions();
        let mask = game.legal_action_mask();

        for action in legal_actions {
            let index = action.action_index.expect("legal actions should encode");
            assert_eq!(mask[index as usize], 1);
        }
    }

    proptest! {
        #[test]
        fn undoing_all_turns_returns_to_the_initial_hash(seed in 1u32..10000, picks in proptest::collection::vec(0usize..32, 0..16)) {
            let mut game = Game::with_policy(seed, AutoPlayPolicy::Off);
            let initial_hash = game.snapshot().state_hash;

            for pick in picks {
                let legal = game.legal_actions();
                if legal.is_empty() {
                    break;
                }
                let action = legal[pick % legal.len()];
                let _ = game.apply_action(action);
            }

            while game.can_undo() {
                let _ = game.undo();
            }

            prop_assert_eq!(game.snapshot().state_hash, initial_hash);
        }
    }
}
