use std::fmt::Write;

use sha2::{Digest, Sha256};

use crate::{
    action::{ACTION_SPACE_SIZE, Action, SlotRef, decode_action, encode_action},
    card::{CardId, Suit},
    error::MoveError,
    snapshot::{
        AutoPlayPolicy, ColumnView, EngineStatus, FoundationView, FreeCellView, GameSnapshot,
        ReplayExport, StepResult, TurnRecord,
    },
    state::{Column, DealMode, GameState},
};

pub struct Game {
    state: GameState,
    auto_play_policy: AutoPlayPolicy,
    history: Vec<TurnRecord>,
    redo_stack: Vec<TurnRecord>,
}

impl Game {
    pub fn new(seed: u32) -> Self {
        Self::with_policy(seed, AutoPlayPolicy::Off)
    }

    pub fn with_policy(seed: u32, auto_play_policy: AutoPlayPolicy) -> Self {
        Self {
            state: GameState::new(seed),
            auto_play_policy,
            history: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn from_state(state: GameState, auto_play_policy: AutoPlayPolicy) -> Self {
        Self {
            state,
            auto_play_policy,
            history: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn from_replay(replay: &ReplayExport) -> Result<Self, MoveError> {
        let mut game = Self::with_policy(replay.seed, replay.auto_play_policy);
        for turn in &replay.turns {
            for action in &turn.executed {
                let validated = game.validate_action(*action)?;
                game.apply_action_unchecked(validated);
            }
            game.history.push(turn.clone());
        }
        Ok(game)
    }

    pub fn seed(&self) -> u32 {
        self.state.seed
    }

    pub fn state(&self) -> &GameState {
        &self.state
    }

    pub fn auto_play_policy(&self) -> AutoPlayPolicy {
        self.auto_play_policy
    }

    pub fn set_auto_play_policy(&mut self, policy: AutoPlayPolicy) {
        self.auto_play_policy = policy;
    }

    pub fn reset(&mut self, seed: u32) {
        self.state = GameState::new(seed);
        self.history.clear();
        self.redo_stack.clear();
    }

    pub fn is_terminal(&self) -> bool {
        self.state.is_won()
    }

    pub fn score(&self) -> u16 {
        self.state.total_foundation_cards() as u16
    }

    pub fn can_undo(&self) -> bool {
        !self.history.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn snapshot(&self) -> GameSnapshot {
        GameSnapshot {
            version: 1,
            seed: self.state.seed,
            deal_mode: self.state.deal_mode,
            status: if self.state.is_won() {
                EngineStatus::Won
            } else {
                EngineStatus::Playing
            },
            auto_play_policy: self.auto_play_policy,
            move_count: self.history.len() as u32,
            turn_index: self.history.len() as u32,
            score: self.score(),
            legal_move_capacity: self.state.global_legal_move_capacity(),
            state_hash: self.state_hash(),
            foundations: Suit::ALL
                .into_iter()
                .map(|suit| FoundationView {
                    index: suit.index(),
                    suit,
                    count: self.state.foundations[suit.index() as usize],
                    next_rank: self.state.foundations[suit.index() as usize] + 1,
                    top_card: self.state.foundation_top(suit).map(Into::into),
                })
                .collect(),
            freecells: self
                .state
                .freecells
                .iter()
                .enumerate()
                .map(|(index, card)| FreeCellView {
                    index: index as u8,
                    card: card.map(Into::into),
                })
                .collect(),
            tableau: self
                .state
                .tableau
                .iter()
                .enumerate()
                .map(|(index, column)| ColumnView {
                    index: index as u8,
                    cards: column.iter().copied().map(Into::into).collect(),
                    movable_run_length: GameState::movable_run_length(column),
                    sorted_run_length: GameState::sorted_run_length(column),
                })
                .collect(),
        }
    }

    pub fn snapshot_json(&self) -> String {
        serde_json::to_string_pretty(&self.snapshot()).expect("snapshot must serialize")
    }

    pub fn snapshot_binary(&self) -> Vec<u8> {
        postcard::to_allocvec(&self.snapshot()).expect("snapshot must serialize")
    }

    pub fn replay_export(&self) -> ReplayExport {
        ReplayExport {
            version: 1,
            seed: self.state.seed,
            deal_mode: DealMode::Microsoft,
            auto_play_policy: self.auto_play_policy,
            turns: self.history.clone(),
            final_state_hash: self.state_hash(),
        }
    }

    pub fn replay_json(&self) -> String {
        serde_json::to_string_pretty(&self.replay_export()).expect("replay must serialize")
    }

    pub fn replay_binary(&self) -> Vec<u8> {
        postcard::to_allocvec(&self.replay_export()).expect("replay must serialize")
    }

    pub fn legal_actions(&self) -> Vec<Action> {
        (0..ACTION_SPACE_SIZE as u16)
            .filter_map(decode_action)
            .filter_map(|action| self.validate_action(action).ok())
            .collect()
    }

    pub fn legal_action_mask(&self) -> Vec<u8> {
        (0..ACTION_SPACE_SIZE as u16)
            .map(|index| {
                decode_action(index)
                    .and_then(|action| self.validate_action(action).ok())
                    .map(|_| 1u8)
                    .unwrap_or(0)
            })
            .collect()
    }

    pub fn step(&mut self, action: Action) -> StepResult {
        match self.apply_action(action) {
            Ok(turn) => StepResult {
                applied: true,
                reward: turn.foundation_delta as f32,
                terminal: self.is_terminal(),
                turn: Some(turn),
                state: self.snapshot(),
                illegal_reason: None,
            },
            Err(error) => StepResult {
                applied: false,
                reward: 0.0,
                terminal: self.is_terminal(),
                turn: None,
                state: self.snapshot(),
                illegal_reason: Some(error.to_string()),
            },
        }
    }

    pub fn apply_action(&mut self, action: Action) -> Result<TurnRecord, MoveError> {
        let validated = self.validate_action(action)?;
        let foundation_before = self.state.total_foundation_cards();
        self.apply_action_unchecked(validated);

        let mut executed = vec![validated];
        executed.extend(self.execute_auto_play(self.auto_play_policy));

        Ok(self.commit_turn(Some(validated), executed, foundation_before))
    }

    pub fn run_auto_play(&mut self) -> Option<TurnRecord> {
        let foundation_before = self.state.total_foundation_cards();
        let executed = self.execute_auto_play(self.auto_play_policy);
        (!executed.is_empty()).then(|| self.commit_turn(None, executed, foundation_before))
    }

    pub fn undo(&mut self) -> Option<TurnRecord> {
        let turn = self.history.pop()?;
        for action in turn.executed.iter().rev().copied() {
            self.apply_action_unchecked(action.inverse());
        }
        self.redo_stack.push(turn.clone());
        Some(turn)
    }

    pub fn redo(&mut self) -> Option<TurnRecord> {
        let mut turn = self.redo_stack.pop()?;
        for action in turn.executed.iter().copied() {
            self.apply_action_unchecked(action);
        }
        turn.turn_index = self.history.len() as u32 + 1;
        self.history.push(turn.clone());
        Some(turn)
    }

    pub fn validate_action(&self, action: Action) -> Result<Action, MoveError> {
        if self.state.is_won() {
            return Err(MoveError::GameAlreadyWon);
        }
        if !(1..=13).contains(&action.count) {
            return Err(MoveError::InvalidCount);
        }
        if action.source == action.destination {
            return Err(MoveError::SameSlot);
        }

        self.ensure_slot(action.source)?;
        self.ensure_slot(action.destination)?;

        let normalized = Action {
            action_index: encode_action(action),
            ..action
        };

        match (normalized.source, normalized.destination) {
            (SlotRef::Foundation { .. }, SlotRef::Foundation { .. }) => {
                Err(MoveError::FoundationToFoundationUnsupported)
            }
            (SlotRef::Tableau { index: source }, SlotRef::Tableau { index: destination }) => {
                self.validate_tableau_to_tableau(source, destination, normalized.count)?;
                Ok(normalized)
            }
            (SlotRef::Tableau { index }, SlotRef::Freecell { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_tableau_to_freecell(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Tableau { index }, SlotRef::Foundation { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_tableau_to_foundation(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Freecell { index }, SlotRef::Tableau { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_freecell_to_tableau(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Freecell { index }, SlotRef::Freecell { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_freecell_to_freecell(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Freecell { index }, SlotRef::Foundation { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_freecell_to_foundation(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Foundation { index }, SlotRef::Tableau { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_foundation_to_tableau(index, destination)?;
                Ok(normalized)
            }
            (SlotRef::Foundation { index }, SlotRef::Freecell { index: destination }) => {
                if normalized.count != 1 {
                    return Err(MoveError::SingleCardOnly);
                }
                self.validate_foundation_to_freecell(index, destination)?;
                Ok(normalized)
            }
        }
    }

    fn ensure_slot(&self, slot: SlotRef) -> Result<(), MoveError> {
        match slot {
            SlotRef::Tableau { index } if index < 8 => Ok(()),
            SlotRef::Freecell { index } if index < 4 => Ok(()),
            SlotRef::Foundation { index } if index < 4 => Ok(()),
            _ => Err(MoveError::InvalidIndex),
        }
    }

    fn validate_tableau_to_freecell(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        if self.state.tableau[source as usize].is_empty() {
            return Err(MoveError::EmptySource);
        }
        if self.state.freecells[destination as usize].is_some() {
            return Err(MoveError::DestinationOccupied);
        }
        Ok(())
    }

    fn validate_tableau_to_foundation(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        let Some(&card) = self.state.tableau[source as usize].last() else {
            return Err(MoveError::EmptySource);
        };
        self.validate_card_to_foundation(card, destination)
    }

    fn validate_freecell_to_foundation(
        &self,
        source: u8,
        destination: u8,
    ) -> Result<(), MoveError> {
        let Some(card) = self.state.freecells[source as usize] else {
            return Err(MoveError::EmptySource);
        };
        self.validate_card_to_foundation(card, destination)
    }

    fn validate_foundation_to_tableau(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        let card = self
            .state
            .foundation_top(Suit::from_index(source).ok_or(MoveError::InvalidIndex)?)
            .ok_or(MoveError::EmptySource)?;
        self.validate_card_to_tableau(card, destination)
    }

    fn validate_foundation_to_freecell(
        &self,
        source: u8,
        destination: u8,
    ) -> Result<(), MoveError> {
        let _card = self
            .state
            .foundation_top(Suit::from_index(source).ok_or(MoveError::InvalidIndex)?)
            .ok_or(MoveError::EmptySource)?;
        if self.state.freecells[destination as usize].is_some() {
            return Err(MoveError::DestinationOccupied);
        }
        Ok(())
    }

    fn validate_freecell_to_tableau(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        let Some(card) = self.state.freecells[source as usize] else {
            return Err(MoveError::EmptySource);
        };
        self.validate_card_to_tableau(card, destination)
    }

    fn validate_freecell_to_freecell(&self, source: u8, destination: u8) -> Result<(), MoveError> {
        if self.state.freecells[source as usize].is_none() {
            return Err(MoveError::EmptySource);
        }
        if self.state.freecells[destination as usize].is_some() {
            return Err(MoveError::DestinationOccupied);
        }
        Ok(())
    }

    fn validate_tableau_to_tableau(
        &self,
        source: u8,
        destination: u8,
        count: u8,
    ) -> Result<(), MoveError> {
        let source_column = &self.state.tableau[source as usize];
        if source_column.is_empty() || count as usize > source_column.len() {
            return Err(MoveError::EmptySource);
        }

        let slice = &source_column[source_column.len() - count as usize..];
        if !GameState::is_valid_movable_sequence(slice) {
            return Err(MoveError::SequenceBroken);
        }

        let available_capacity = self.transfer_capacity(source, destination);
        if count > available_capacity {
            return Err(MoveError::InsufficientCapacity);
        }

        self.validate_card_to_tableau(slice[0], destination)
    }

    fn validate_card_to_foundation(&self, card: CardId, destination: u8) -> Result<(), MoveError> {
        let suit = Suit::from_index(destination).ok_or(MoveError::InvalidIndex)?;
        if card.suit() != suit {
            return Err(MoveError::FoundationSuitMismatch);
        }
        if self.state.foundations[destination as usize] + 1 != card.rank() {
            return Err(MoveError::FoundationRankMismatch);
        }
        Ok(())
    }

    fn validate_card_to_tableau(&self, card: CardId, destination: u8) -> Result<(), MoveError> {
        let destination_column = &self.state.tableau[destination as usize];
        let Some(&top_card) = destination_column.last() else {
            return Ok(());
        };
        if card.color() == top_card.color() {
            return Err(MoveError::TableauColorMismatch);
        }
        if card.rank() + 1 != top_card.rank() {
            return Err(MoveError::TableauRankMismatch);
        }
        Ok(())
    }

    fn transfer_capacity(&self, source: u8, destination: u8) -> u8 {
        let empty_freecells = self.state.empty_freecell_count();
        let empty_columns = self
            .state
            .tableau
            .iter()
            .enumerate()
            .filter(|(index, column)| {
                *index != source as usize && *index != destination as usize && column.is_empty()
            })
            .count() as u8;

        (empty_freecells + 1) << empty_columns
    }

    fn apply_action_unchecked(&mut self, action: Action) {
        match (action.source, action.destination) {
            (SlotRef::Tableau { index: source }, SlotRef::Tableau { index: destination }) => {
                self.move_tableau_run(source, destination, action.count);
            }
            (SlotRef::Tableau { index: source }, SlotRef::Freecell { index: destination }) => {
                let card = self.state.tableau[source as usize]
                    .pop()
                    .expect("validated tableau source");
                self.state.freecells[destination as usize] = Some(card);
            }
            (SlotRef::Tableau { index: source }, SlotRef::Foundation { index: destination }) => {
                let card = self.state.tableau[source as usize]
                    .pop()
                    .expect("validated tableau source");
                self.state.foundations[destination as usize] = card.rank();
            }
            (SlotRef::Freecell { index: source }, SlotRef::Tableau { index: destination }) => {
                let card = self.state.freecells[source as usize]
                    .take()
                    .expect("validated freecell source");
                self.state.tableau[destination as usize].push(card);
            }
            (SlotRef::Freecell { index: source }, SlotRef::Freecell { index: destination }) => {
                let card = self.state.freecells[source as usize]
                    .take()
                    .expect("validated freecell source");
                self.state.freecells[destination as usize] = Some(card);
            }
            (SlotRef::Freecell { index: source }, SlotRef::Foundation { index: destination }) => {
                let card = self.state.freecells[source as usize]
                    .take()
                    .expect("validated freecell source");
                self.state.foundations[destination as usize] = card.rank();
            }
            (SlotRef::Foundation { index: source }, SlotRef::Tableau { index: destination }) => {
                let suit = Suit::from_index(source).expect("validated foundation index");
                let card = self
                    .state
                    .foundation_top(suit)
                    .expect("validated foundation source");
                self.state.foundations[source as usize] =
                    self.state.foundations[source as usize].saturating_sub(1);
                self.state.tableau[destination as usize].push(card);
            }
            (SlotRef::Foundation { index: source }, SlotRef::Freecell { index: destination }) => {
                let suit = Suit::from_index(source).expect("validated foundation index");
                let card = self
                    .state
                    .foundation_top(suit)
                    .expect("validated foundation source");
                self.state.foundations[source as usize] =
                    self.state.foundations[source as usize].saturating_sub(1);
                self.state.freecells[destination as usize] = Some(card);
            }
            _ => unreachable!("validated unsupported action"),
        }
    }

    fn move_tableau_run(&mut self, source: u8, destination: u8, count: u8) {
        let split_at = self.state.tableau[source as usize].len() - count as usize;
        let moved: Column = self.state.tableau[source as usize]
            .drain(split_at..)
            .collect();
        self.state.tableau[destination as usize].extend(moved);
    }

    fn execute_auto_play(&mut self, policy: AutoPlayPolicy) -> Vec<Action> {
        let mut actions = Vec::new();
        while let Some(action) = self.next_auto_play_action(policy) {
            self.apply_action_unchecked(action);
            actions.push(action);
        }
        actions
    }

    fn next_auto_play_action(&self, policy: AutoPlayPolicy) -> Option<Action> {
        if policy == AutoPlayPolicy::Off {
            return None;
        }

        for freecell_index in (0..4u8).rev() {
            if let Some(card) = self.state.freecells[freecell_index as usize]
                && self.is_safe_for_auto_play(card, policy)
            {
                return Some(Action::new(
                    SlotRef::Freecell {
                        index: freecell_index,
                    },
                    SlotRef::Foundation {
                        index: card.suit().index(),
                    },
                    1,
                ));
            }
        }

        for column_index in 0..8u8 {
            if let Some(&card) = self.state.tableau[column_index as usize].last()
                && self.is_safe_for_auto_play(card, policy)
            {
                return Some(Action::new(
                    SlotRef::Tableau {
                        index: column_index,
                    },
                    SlotRef::Foundation {
                        index: card.suit().index(),
                    },
                    1,
                ));
            }
        }

        None
    }

    fn is_safe_for_auto_play(&self, card: CardId, policy: AutoPlayPolicy) -> bool {
        if self
            .validate_card_to_foundation(card, card.suit().index())
            .is_err()
        {
            return false;
        }
        if matches!(policy, AutoPlayPolicy::Max) || card.rank() <= 2 {
            return true;
        }

        let required = card.rank() - 1;
        match card.suit() {
            Suit::Diamonds | Suit::Hearts => {
                self.state.foundations[Suit::Clubs.index() as usize] >= required
                    && self.state.foundations[Suit::Spades.index() as usize] >= required
            }
            Suit::Clubs | Suit::Spades => {
                self.state.foundations[Suit::Diamonds.index() as usize] >= required
                    && self.state.foundations[Suit::Hearts.index() as usize] >= required
            }
        }
    }

    fn commit_turn(
        &mut self,
        requested: Option<Action>,
        executed: Vec<Action>,
        foundation_before: u8,
    ) -> TurnRecord {
        self.redo_stack.clear();
        let record = TurnRecord {
            turn_index: self.history.len() as u32 + 1,
            requested,
            auto_played: requested.is_some_and(|_| executed.len() > 1) || requested.is_none(),
            foundation_delta: self.state.total_foundation_cards() as i16 - foundation_before as i16,
            executed,
        };
        self.history.push(record.clone());
        record
    }

    fn state_hash(&self) -> String {
        let mut canonical = String::new();
        write!(&mut canonical, "{}|", self.state.seed).expect("write to string");
        for foundation in self.state.foundations {
            write!(&mut canonical, "{foundation},").expect("write to string");
        }
        canonical.push('|');
        for slot in self.state.freecells {
            match slot {
                Some(card) => write!(&mut canonical, "{},", card.raw()).expect("write to string"),
                None => canonical.push_str("x,"),
            }
        }
        canonical.push('|');
        for column in &self.state.tableau {
            for card in column {
                write!(&mut canonical, "{},", card.raw()).expect("write to string");
            }
            canonical.push(';');
        }

        let hash = Sha256::digest(canonical.as_bytes());
        let mut encoded = String::with_capacity(hash.len() * 2);
        for byte in hash {
            write!(&mut encoded, "{byte:02x}").expect("write to string");
        }
        encoded
    }
}
