use serde::{Deserialize, Serialize};
use smallvec::SmallVec;

use crate::{
    card::{CardId, Suit},
    deal::microsoft_deal_deck,
};

pub type Column = SmallVec<[CardId; 8]>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DealMode {
    Microsoft,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    pub seed: u32,
    pub deal_mode: DealMode,
    pub foundations: [u8; 4],
    pub freecells: [Option<CardId>; 4],
    pub tableau: [Column; 8],
}

impl GameState {
    pub fn new(seed: u32) -> Self {
        let mut state = Self::empty();
        state.seed = seed;
        state.deal_mode = DealMode::Microsoft;

        for (index, card) in microsoft_deal_deck(seed).into_iter().enumerate() {
            state.tableau[index % 8].push(card);
        }

        state
    }

    pub fn empty() -> Self {
        Self {
            seed: 0,
            deal_mode: DealMode::Microsoft,
            foundations: [0; 4],
            freecells: [None; 4],
            tableau: core::array::from_fn(|_| Column::new()),
        }
    }

    pub fn total_foundation_cards(&self) -> u8 {
        self.foundations.iter().sum()
    }

    pub fn is_won(&self) -> bool {
        self.foundations.iter().all(|count| *count == 13)
    }

    pub fn empty_freecell_count(&self) -> u8 {
        self.freecells.iter().filter(|slot| slot.is_none()).count() as u8
    }

    pub fn empty_tableau_count(&self) -> u8 {
        self.tableau
            .iter()
            .filter(|column| column.is_empty())
            .count() as u8
    }

    pub fn global_legal_move_capacity(&self) -> u8 {
        (self.empty_freecell_count() + 1) << self.empty_tableau_count()
    }

    pub fn foundation_top(&self, suit: Suit) -> Option<CardId> {
        let count = self.foundations[suit.index() as usize];
        CardId::from_rank_and_suit(count, suit)
    }

    pub fn movable_run_length(column: &[CardId]) -> u8 {
        if column.is_empty() {
            return 0;
        }

        let mut count = 1;
        for index in (1..column.len()).rev() {
            let upper = column[index];
            let lower = column[index - 1];
            if upper.rank() + 1 != lower.rank() || upper.color() == lower.color() {
                break;
            }
            count += 1;
        }

        count
    }

    pub fn sorted_run_length(column: &[CardId]) -> u8 {
        if column.is_empty() {
            return 0;
        }

        let mut count = 1;
        for index in (1..column.len()).rev() {
            let upper = column[index];
            let lower = column[index - 1];
            if upper.rank() + 1 != lower.rank() {
                break;
            }
            count += 1;
        }

        count
    }

    pub fn is_valid_movable_sequence(column: &[CardId]) -> bool {
        !column.is_empty() && Self::movable_run_length(column) as usize == column.len()
    }
}
